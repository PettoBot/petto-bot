// i18n-ignore-file: internal measurements for the Petto team (logs and the private `!perf` tool).
// Always-on measurements that cost almost nothing, all in memory, read by the private `!perf` tool of the team:
//   - a timing record for every command (total, time to the first answer, database, Discord REST and Redis: number of calls and time);
//   - the latency of the last 200 database queries and of the last 200 REST requests (average, p95), by route family for REST, with the
//     split of every request into "waited in our own queue", "waited inside discord.js" and "network";
//   - the rate limits that were hit, the invalid requests (401, 403, 429), the requests of each minute by route family and by cause,
//     and the difference between the clock of the host and the `Date` header of Discord;
//   - the lag of the event loop (p50, p99, max), the CPU use and the memory, sampled every 10 seconds for the last hour;
//   - every listener of a gateway event (calls, time that blocked the loop, time until it finished) and the events per second by type;
//   - every interval job (runs, time, queries and requests per run).
// Nothing here changes what a command does: the code only looks, and every hook is wrapped so that a mistake in it never reaches a member.
const { AsyncLocalStorage } = require('node:async_hooks');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const logger = require('./logger');

const SLOW_COMMAND_MS = 2_000;
const SLOW_REST_MS = 2_000;
const BLOCKING_LISTENER_MS = 150;
const WARN_EVERY_MS = 60_000;
// Discord blocks the address at 10,000 invalid requests (401, 403, 429) in 10 minutes; the team is told (once every 30 minutes) from a fifth of that.
const INVALID_ALERT_AT = 2_000;
const INVALID_ALERT_EVERY_MS = 30 * 60_000;
const RING_SIZE = 600;
const WINDOW_SIZE = 200;
const HOUR_MS = 60 * 60_000;

const store = new AsyncLocalStorage(); // the context of whatever is running: a listener, a command, a job
const requestStore = new AsyncLocalStorage(); // the request that is being made (to split queue and network time)
const startedAt = Date.now();

const nowMs = () => performance.now();

// ---------------------------------------------------------------------------------------------------------------------------------
// Small tools

/** The last `size` numbers, with the average, the percentiles and the maximum computed only when somebody asks. */
function createWindow(size = WINDOW_SIZE) {
  const values = [];
  let next = 0;
  let total = 0;
  return {
    push(value) {
      if (!Number.isFinite(value)) return;
      total += 1;
      if (values.length < size) values.push(value);
      else { values[next] = value; next = (next + 1) % size; }
    },
    stats() {
      if (!values.length) return { count: 0, total, avg: 0, p50: 0, p95: 0, max: 0 };
      const sorted = [...values].sort((a, b) => a - b);
      const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
      return { count: values.length, total, avg: sorted.reduce((sum, value) => sum + value, 0) / sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
    },
  };
}

/** Counts of the last `minutes` minutes: `add(key)` and `sum(minutes)` -> Map key -> count. */
function createMinuteCounter(minutes = 70) {
  const buckets = new Map(); // minute index -> Map(key -> count)
  const prune = (minute) => { for (const index of buckets.keys()) if (index <= minute - minutes) buckets.delete(index); };
  return {
    add(key, amount = 1) {
      const minute = Math.floor(Date.now() / 60_000);
      let bucket = buckets.get(minute);
      if (!bucket) { bucket = new Map(); buckets.set(minute, bucket); prune(minute); }
      bucket.set(key, (bucket.get(key) ?? 0) + amount);
    },
    sum(lastMinutes = 10) {
      const minute = Math.floor(Date.now() / 60_000);
      const total = new Map();
      for (const [index, bucket] of buckets) {
        if (index <= minute - lastMinutes) continue;
        for (const [key, count] of bucket) total.set(key, (total.get(key) ?? 0) + count);
      }
      return total;
    },
  };
}

/**
 * One warning at most every `WARN_EVERY_MS` for each key, so a measurement never becomes the flood it reports. A measurement goes to the console of the host and
 * to `!perf`, never to a channel of Discord: every message sent there is one more request, and on a loaded bot those messages were a good part of the noise they
 * told about. `toChannel` is only for the few things that need a person (see `INVALID_ALERT_AT`).
 */
const lastWarn = new Map();
function warnThrottled(key, message, { toChannel = false, everyMs = WARN_EVERY_MS } = {}) {
  const now = Date.now();
  if (now - (lastWarn.get(key) ?? 0) < everyMs) return;
  lastWarn.set(key, now);
  if (lastWarn.size > 500) for (const [stale, at] of lastWarn) if (now - at > everyMs) lastWarn.delete(stale);
  try { (toChannel ? logger.warn : logger.localWarn)(message); } catch { /* a log that fails is not worth a failure */ }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Contexts: what is running now (a gateway listener, a command, an interval job), with the work it has asked for

/** A new context. `interactive`: the work of a person waiting for an answer (its Discord requests go first, see utils/restGate.js). */
function newContext({ kind, name, interactive = false } = {}) {
  return {
    kind: kind ?? 'other',
    name: name ?? kind ?? 'other',
    interactive,
    command: null,
    startedAt: nowMs(),
    firstReplyMs: null,
    db: { n: 0, ms: 0, wait: 0 },
    rest: { n: 0, ms: 0, gate: 0, net: 0, retries: 0 },
    redis: { n: 0, ms: 0 },
    error: null,
  };
}

const current = () => store.getStore() ?? null;

// A deadline for the Discord requests made inside a function: `await withDeadline(4000, () => somethingThatAsksDiscord())` makes a request that waits (in our line or in
// discord.js) leave when the time is up, instead of sitting there for minutes. The signal is read where the request enters the queue (utils/sharedRestLimit.js).
const signalStore = new AsyncLocalStorage();
const withDeadline = (ms, callback) => signalStore.run(AbortSignal.timeout(ms), callback);
const currentSignal = () => signalStore.getStore() ?? null;
const runWith = (context, callback) => store.run(context, callback);

/** Names the command that a listener is running (`/mod mute`, `!mute`), so its timing is kept in the list of commands. */
function setCommand(label) {
  const context = current();
  if (context) context.command = String(label);
}

const records = []; // the last commands, newest last
const slowCommandCounter = { total: 0 };

/** Closes a context: a command is kept in the ring (and warned about when it was slow), a job in its own totals. */
function finishContext(context, error = null) {
  if (!context) return;
  const total = nowMs() - context.startedAt;
  if (error) context.error = String(error.message ?? error).slice(0, 120);
  if (!context.command) return;
  const record = {
    at: Date.now(),
    name: context.command,
    total,
    ack: context.firstReplyMs,
    db: { ...context.db },
    rest: { ...context.rest },
    redis: { ...context.redis },
    error: context.error,
  };
  records.push(record);
  if (records.length > RING_SIZE) records.shift();
  if (total > SLOW_COMMAND_MS) {
    slowCommandCounter.total += 1;
    warnThrottled(`slow:${record.name}`, `Slow command ${record.name}: ${Math.round(total)} ms in total (first answer ${record.ack == null ? 'n/a' : `${Math.round(record.ack)} ms`}); ${describeRecord(record)}.`);
  }
}

function describeRecord(record) {
  return `database ${record.db.n} queries ${Math.round(record.db.ms)} ms, `
    + `Discord ${record.rest.n} requests ${Math.round(record.rest.ms)} ms (our queue ${Math.round(record.rest.gate)} ms, network ${Math.round(record.rest.net)} ms, retries ${record.rest.retries}), `
    + `Redis ${record.redis.n} calls ${Math.round(record.redis.ms)} ms`;
}

/** The slowest commands of the last hour, with their breakdown. */
function slowestCommands(limit = 10, sinceMs = HOUR_MS) {
  const since = Date.now() - sinceMs;
  return records.filter((record) => record.at >= since).sort((a, b) => b.total - a.total).slice(0, limit);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Database

const dbWindow = createWindow();
const dbWaitWindow = createWindow();
const dbMinute = createMinuteCounter();
let dbErrors = 0;
let dbSlow = 0;
const poolInfo = { read: null };

/** One query finished: `ms` is all of it (waiting for a connection included), `waitMs` the part spent waiting for one. */
function recordDb(ms, waitMs = 0, ok = true) {
  dbWindow.push(ms);
  dbWaitWindow.push(waitMs);
  dbMinute.add('queries');
  if (!ok) dbErrors += 1;
  if (ms > 1_000) dbSlow += 1;
  const context = current();
  if (context) { context.db.n += 1; context.db.ms += ms; context.db.wait += waitMs; }
}

function databaseStats() {
  return { latency: dbWindow.stats(), wait: dbWaitWindow.stats(), errors: dbErrors, slow: dbSlow, lastMinute: dbMinute.sum(1).get('queries') ?? 0, pool: safe(() => poolInfo.read?.()) };
}

/** The pool tells how many connections it has, how many are idle and how many queries wait for one. */
function setPoolReader(reader) { poolInfo.read = reader; }

// ---------------------------------------------------------------------------------------------------------------------------------
// Redis

const redisWindow = createWindow();
function recordRedis(ms) {
  redisWindow.push(ms);
  const context = current();
  if (context) { context.redis.n += 1; context.redis.ms += ms; }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Discord REST

/** `/channels/123/messages/456?x=1` -> `/channels/:id/messages/:id`: the route family a request belongs to. */
function routeFamily(method, path) {
  let route = String(path ?? '').split('?')[0].replace(/^https?:\/\/[^/]+/i, '').replace(/^\/api(\/v\d+)?/, '');
  route = route
    .replace(/\/(webhooks|interactions)\/(\d+)\/[\w-]{20,}/g, '/$1/:id/:token')
    .replace(/\/reactions\/[^/]+/g, '/reactions/:emoji')
    .replace(/\/\d{15,25}(?=\/|$)/g, '/:id');
  return `${String(method ?? 'GET').toUpperCase()} ${route || '/'}`;
}

const restTotal = createWindow();
const restGateWindow = createWindow();
const restNetWindow = createWindow();
const restFamilies = new Map(); // family -> { count, errors, rateLimited, window, queueWait, lastAt }
const restMinute = createMinuteCounter();
const restCauseMinute = createMinuteCounter();
const causeOfFamily = new Map(); // family -> { cause, at } (read from the stack at most once a minute for a family)
const rateLimitEvents = []; // the last rate limits: { at, family, waitMs, global, scope, source }
const invalidMinute = createMinuteCounter();
const invalidTotals = { 401: 0, 403: 0, 429: 0 };
const invalidWarnings = { count: 0, last: 0 };
const restLive = { inFlight: 0, gateQueued: () => 0, gateStats: () => null };
const skewWindow = createWindow(30);
let longestWait = { ms: 0, family: null, at: 0 };

function familyEntry(family) {
  let entry = restFamilies.get(family);
  if (!entry) {
    entry = { count: 0, errors: 0, rateLimited: 0, window: createWindow(), longest: 0, lastAt: 0 };
    restFamilies.set(family, entry);
  }
  return entry;
}

/** Who made a request that has no context: the first frame of the stack that is not this file or the library, found once a minute per family. */
function causeFromStack(family) {
  const known = causeOfFamily.get(family);
  if (known && Date.now() - known.at < 60_000) return known.cause;
  let cause = 'unknown';
  try {
    const lines = String(new Error().stack ?? '').split('\n').slice(1);
    for (const line of lines) {
      if (/node_modules|node:internal|utils[\\/](perf|restGate)\.js/.test(line)) continue;
      const match = /[\\/](src[\\/][\w./\\-]+|index)\.js:(\d+)/.exec(line);
      if (match) { cause = `${match[1].replace(/\\/g, '/')}.js`; break; }
    }
  } catch { /* the stack is only a hint */ }
  causeOfFamily.set(family, { cause, at: Date.now() });
  return cause;
}

/**
 * A REST request finished. `gateMs`: waited in our own queue (utils/restGate.js); `netMs`: time inside the HTTP call (all attempts); `status`:
 * the last status seen. What is left of `totalMs` after both is the wait inside discord.js (its buckets and rate limits) and the retries.
 */
function recordRest({ family, totalMs, gateMs = 0, netMs = 0, status = 0, attempts = 1, failed = false }) {
  const entry = familyEntry(family);
  entry.count += 1;
  entry.lastAt = Date.now();
  entry.window.push(totalMs);
  entry.longest = Math.max(entry.longest, totalMs);
  if (failed || status >= 400) entry.errors += 1;
  restTotal.push(totalMs);
  restGateWindow.push(gateMs);
  restNetWindow.push(netMs);
  restMinute.add(family);
  const context = current();
  const cause = context?.name && context.kind !== 'other' ? `${context.kind}:${context.name}` : causeFromStack(family);
  restCauseMinute.add(`${family} <- ${cause}`);
  if (totalMs > longestWait.ms) longestWait = { ms: totalMs, family, at: Date.now() };
  if (context) {
    context.rest.n += 1;
    context.rest.ms += totalMs;
    context.rest.gate += gateMs;
    context.rest.net += netMs;
    context.rest.retries += Math.max(0, attempts - 1);
    if (context.firstReplyMs == null && context.command && /\/interactions\/:id\/:token\/callback|^(POST|PATCH) \/webhooks\/|^(POST|PATCH) \/channels\/:id\/messages/.test(family)) {
      context.firstReplyMs = nowMs() - context.startedAt;
    }
  }
  if (totalMs > SLOW_REST_MS) {
    warnThrottled(`rest:${family}`, `Slow Discord request ${family}: ${Math.round(totalMs)} ms (our queue ${Math.round(gateMs)} ms, network ${Math.round(netMs)} ms, rest waiting inside the REST client or retrying ${Math.round(Math.max(0, totalMs - gateMs - netMs))} ms, ${attempts} attempt(s), status ${status || 'none'}).`);
  }
}

/** A response arrived: counts the invalid ones (Discord counts 401, 403 and 429 towards the limit that gets an address blocked) and the clock difference. */
function recordResponse({ family, status, dateHeader, receivedAt = Date.now() }) {
  if (status === 401 || status === 403 || status === 429) {
    invalidTotals[status] += 1;
    invalidMinute.add(String(status));
    invalidMinute.add(`${status} ${family}`);
  }
  if (dateHeader) {
    const server = Date.parse(dateHeader);
    // The header has whole seconds (it is cut down), so the difference is exact to about a second.
    if (Number.isFinite(server)) skewWindow.push(server - receivedAt);
  }
}

function recordRateLimit({ family, waitMs, global = false, scope = 'route', source = 'client' }) {
  const entry = familyEntry(family);
  entry.rateLimited += 1;
  rateLimitEvents.push({ at: Date.now(), family, waitMs: Math.round(waitMs), global, scope, source });
  if (rateLimitEvents.length > 200) rateLimitEvents.shift();
  if (waitMs > SLOW_REST_MS || global) {
    warnThrottled(`rl:${family}:${global}`, `Discord rate limit (${global ? 'global' : scope}, ${source}) on ${family}: waiting ${Math.round(waitMs)} ms.`);
  }
}

function recordInvalidWarning(count) {
  invalidWarnings.count = Number(count) || invalidWarnings.count + 1;
  invalidWarnings.last = Date.now();
  // Discord says it at every 100: that is a count for `!perf`, not an alert. The team is told only when it gets close to the block.
  warnThrottled('invalid-requests', `Discord warns about invalid requests: ${invalidWarnings.count} in the last 10 minutes (401, 403 and 429 count; at 10,000 Discord blocks the address for a while).`);
  if (invalidWarnings.count >= INVALID_ALERT_AT) {
    warnThrottled('invalid-requests-close', `Discord counts ${invalidWarnings.count} invalid requests (401, 403, 429) in the last 10 minutes; at 10,000 it blocks the address. \`!perf limits\` shows which route and which cause.`, { toChannel: true, everyMs: INVALID_ALERT_EVERY_MS });
  }
}

const restStarted = () => { restLive.inFlight += 1; };
const restEnded = () => { restLive.inFlight = Math.max(0, restLive.inFlight - 1); };
const setGateReader = (reader) => { restLive.gateStats = reader; };

function restStats() {
  const families = [...restFamilies.entries()].map(([family, entry]) => ({ family, count: entry.count, errors: entry.errors, rateLimited: entry.rateLimited, longest: entry.longest, ...entry.window.stats() }));
  const lastHour = Date.now() - HOUR_MS;
  const skew = skewWindow.stats();
  return {
    total: restTotal.stats(),
    gate: restGateWindow.stats(),
    net: restNetWindow.stats(),
    families,
    inFlight: restLive.inFlight,
    gateState: safe(() => restLive.gateStats()),
    rateLimits: rateLimitEvents.filter((event) => event.at >= lastHour),
    invalid: { totals: { ...invalidTotals }, lastTenMinutes: Object.fromEntries([...invalidMinute.sum(10)].filter(([key]) => /^\d+$/.test(key))), byRoute: [...invalidMinute.sum(10)].filter(([key]) => / /.test(key)).sort((a, b) => b[1] - a[1]).slice(0, 5), warnings: { ...invalidWarnings } },
    topRoutes: [...restMinute.sum(10)].sort((a, b) => b[1] - a[1]).slice(0, 10),
    topCauses: [...restCauseMinute.sum(10)].sort((a, b) => b[1] - a[1]).slice(0, 10),
    perMinute: [...restMinute.sum(1)].reduce((sum, [, count]) => sum + count, 0),
    longest: longestWait,
    // Positive: the clock of Discord is ahead of the one of this host.
    clockSkewMs: skew.count ? Math.round(skew.p50 + 500) : null,
    clockSamples: skew.count,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Event loop, CPU and memory: one sample every 10 seconds, kept for an hour

const SAMPLE_EVERY_MS = 10_000;
const samples = []; // { at, p50, p99, max, mean, cpu, elu, rss, heap }
let loopMonitor = null;
let lastCpu = null;
let lastElu = null;
let sampler = null;

function takeSample() {
  const snapshot = loopMonitor ? { p50: loopMonitor.percentile(50) / 1e6, p99: loopMonitor.percentile(99) / 1e6, max: loopMonitor.max / 1e6, mean: loopMonitor.mean / 1e6 } : { p50: 0, p99: 0, max: 0, mean: 0 };
  if (loopMonitor) loopMonitor.reset();
  const cpu = process.cpuUsage();
  const wall = nowMs();
  let cpuPct = null;
  if (lastCpu) cpuPct = ((cpu.user - lastCpu.cpu.user + (cpu.system - lastCpu.cpu.system)) / 1000) / Math.max(1, wall - lastCpu.wall) * 100;
  lastCpu = { cpu, wall };
  const elu = performance.eventLoopUtilization();
  const utilization = lastElu ? performance.eventLoopUtilization(elu, lastElu).utilization : elu.utilization;
  lastElu = elu;
  const memory = process.memoryUsage();
  samples.push({ at: Date.now(), ...snapshot, cpu: cpuPct, elu: utilization, rss: memory.rss, heap: memory.heapUsed });
  if (samples.length > HOUR_MS / SAMPLE_EVERY_MS) samples.shift();
  if (snapshot.p99 > 1_000) warnThrottled('loop-lag', `The event loop was blocked: p99 ${Math.round(snapshot.p99)} ms, max ${Math.round(snapshot.max)} ms in the last 10 seconds.`);
}

function startSampler() {
  if (sampler) return;
  try {
    loopMonitor = monitorEventLoopDelay({ resolution: 20 });
    loopMonitor.enable();
  } catch { loopMonitor = null; }
  lastCpu = { cpu: process.cpuUsage(), wall: nowMs() };
  lastElu = performance.eventLoopUtilization();
  sampler = setInterval(() => { try { takeSample(); } catch { /* a sample that fails is skipped */ } }, SAMPLE_EVERY_MS);
  sampler.unref?.();
}

function stopSampler() {
  if (sampler) clearInterval(sampler);
  sampler = null;
  try { loopMonitor?.disable(); } catch { /* nothing to stop */ }
  loopMonitor = null;
}

function loopStats() {
  const now = Date.now();
  const worst = (list) => list.reduce((acc, sample) => ({ p99: Math.max(acc.p99, sample.p99), max: Math.max(acc.max, sample.max) }), { p99: 0, max: 0 });
  const mean = (list, key) => (list.length ? list.reduce((sum, sample) => sum + (sample[key] ?? 0), 0) / list.length : 0);
  const median = (list, key) => { const sorted = list.map((sample) => sample[key]).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };
  const minute = samples.filter((sample) => sample.at >= now - 60_000);
  const hour = samples.filter((sample) => sample.at >= now - HOUR_MS);
  const live = loopMonitor ? { p50: loopMonitor.percentile(50) / 1e6, p99: loopMonitor.percentile(99) / 1e6, max: loopMonitor.max / 1e6 } : null;
  const summary = (list) => ({ samples: list.length, p50: median(list, 'p50'), p99: worst(list).p99, max: worst(list).max, cpu: mean(list.filter((sample) => sample.cpu != null), 'cpu'), elu: mean(list, 'elu') });
  return { live, minute: summary(minute), hour: summary(hour), memory: process.memoryUsage(), uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), series: samples.slice(-6) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Gateway listeners and events

const listeners = new Map(); // `event / file` -> { event, file, calls, syncTotal, syncMax, wallTotal, wallMax, errors, window }
const eventRate = new Map(); // event name -> { total, perSecond: Float64Array(60), stamps: Int32Array(60) }
const blockedCalls = { total: 0 };

function listenerEntry(event, file) {
  const key = `${event} / ${file}`;
  let entry = listeners.get(key);
  if (!entry) {
    entry = { key, event, file, calls: 0, syncTotal: 0, syncMax: 0, wallTotal: 0, wallMax: 0, errors: 0, pending: 0 };
    listeners.set(key, entry);
  }
  return entry;
}

/** One gateway event of a type arrived (counted once for the type, not once for each of its listeners). */
function countEvent(name) {
  let entry = eventRate.get(name);
  if (!entry) { entry = { total: 0, counts: new Array(60).fill(0), stamps: new Array(60).fill(0) }; eventRate.set(name, entry); }
  const second = Math.floor(Date.now() / 1000);
  const slot = second % 60;
  if (entry.stamps[slot] !== second) { entry.stamps[slot] = second; entry.counts[slot] = 0; }
  entry.counts[slot] += 1;
  entry.total += 1;
}

/**
 * Runs one listener of an event: `call()` starts it (its synchronous part runs inside), the returned promise is waited by the caller. The time
 * until the first `await` is the time that blocked the loop for everybody else; the time until it finishes is how long the work took.
 */
function measureListener(entry, call) {
  const started = nowMs();
  entry.calls += 1;
  entry.pending += 1;
  let result;
  try {
    result = call();
  } catch (error) {
    entry.errors += 1;
    entry.pending -= 1;
    throw error;
  } finally {
    const sync = nowMs() - started;
    entry.syncTotal += sync;
    if (sync > entry.syncMax) entry.syncMax = sync;
    if (sync > BLOCKING_LISTENER_MS) {
      blockedCalls.total += 1;
      warnThrottled(`block:${entry.key}`, `The listener ${entry.key} blocked the event loop for ${Math.round(sync)} ms in one call.`);
    }
  }
  const done = () => {
    entry.pending = Math.max(0, entry.pending - 1);
    const wall = nowMs() - started;
    entry.wallTotal += wall;
    if (wall > entry.wallMax) entry.wallMax = wall;
  };
  if (result && typeof result.then === 'function') return result.then((value) => { done(); return value; }, (error) => { done(); entry.errors += 1; throw error; });
  done();
  return result;
}

function listenerStats() {
  const now = Math.floor(Date.now() / 1000);
  const perSecond = [...eventRate.entries()].map(([name, entry]) => {
    let last60 = 0;
    for (let slot = 0; slot < 60; slot += 1) if (now - entry.stamps[slot] < 60 && entry.stamps[slot] <= now) last60 += entry.counts[slot];
    return { name, total: entry.total, perSecond: last60 / 60 };
  }).sort((a, b) => b.perSecond - a.perSecond || b.total - a.total);
  const all = [...listeners.values()];
  return { events: perSecond, byTotal: [...all].sort((a, b) => b.syncTotal - a.syncTotal).slice(0, 10), byMax: [...all].sort((a, b) => b.syncMax - a.syncMax).slice(0, 10), byWall: [...all].sort((a, b) => b.wallTotal - a.wallTotal).slice(0, 5), blocked: blockedCalls.total, count: all.length };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Interval jobs

const jobs = new Map(); // name -> { name, everyMs, runs, errors, totalMs, maxMs, lastMs, lastAt, db, rest, running }
let intervalsTracked = false;
let originalSetInterval = null;

function jobEntry(name, everyMs) {
  let entry = jobs.get(name);
  if (!entry) {
    entry = { name, everyMs, runs: 0, errors: 0, totalMs: 0, maxMs: 0, lastMs: 0, lastAt: 0, dbQueries: 0, restRequests: 0, running: 0 };
    jobs.set(name, entry);
  }
  return entry;
}

/** Runs one tick of a job inside its own context, so the queries and requests it makes are counted for it. Errors still reach the caller. */
function runJob(entry, task) {
  const context = newContext({ kind: 'job', name: entry.name });
  const started = nowMs();
  entry.running += 1;
  const finish = (error) => {
    const took = nowMs() - started;
    entry.running = Math.max(0, entry.running - 1);
    entry.runs += 1;
    entry.totalMs += took;
    entry.lastMs = took;
    entry.maxMs = Math.max(entry.maxMs, took);
    entry.lastAt = Date.now();
    entry.dbQueries += context.db.n;
    entry.restRequests += context.rest.n;
    if (error) entry.errors += 1;
  };
  let result;
  try {
    result = store.run(context, task);
  } catch (error) { finish(error); throw error; }
  if (result && typeof result.then === 'function') return result.then((value) => { finish(null); return value; }, (error) => { finish(error); throw error; });
  finish(null);
  return result;
}

/** Runs a loop of `setTimeout`s as a tracked job: `track('statusHeartbeatJob', 10_000, tick)` returns the function to call on every tick. */
function trackJob(name, everyMs, task) {
  const entry = jobEntry(name, everyMs);
  return (...args) => runJob(entry, () => task(...args));
}

function jobAllowed(name) {
  try { return require('./loadGuard').allowsJob(name); } catch { return true; }
}

function jobNameFromStack(stack) {
  for (const line of String(stack ?? '').split('\n').slice(1)) {
    if (/utils[\\/]perf\.js/.test(line)) continue;
    // The first frame that is not this file is who started the interval: a library (left alone) or Petto's own code.
    if (/node_modules|node:internal/.test(line)) return null;
    const match = /[\\/]([\w.-]+)\.js:\d+/.exec(line);
    return match ? match[1] : null;
  }
  return null;
}

/**
 * Every `setInterval` started by Petto's own code is measured (runs, time, queries and requests of each tick) without touching the jobs: the
 * global function is wrapped once, and an interval started by a library is left as it was.
 */
function trackIntervals() {
  if (intervalsTracked) return;
  intervalsTracked = true;
  originalSetInterval = global.setInterval;
  const original = originalSetInterval;
  global.setInterval = function trackedSetInterval(callback, delay, ...args) {
    if (typeof callback !== 'function') return original(callback, delay, ...args);
    let name = null;
    try { name = jobNameFromStack(new Error().stack); } catch { name = null; }
    if (!name) return original(callback, delay, ...args);
    const every = Number(delay) || 1;
    let entry = jobs.get(name);
    if (entry && entry.everyMs !== every) entry = jobEntry(`${name}@${Math.round(every / 1000)}s`, every);
    entry ??= jobEntry(name, every);
    const bound = entry;
    const base = bound.name.split('@')[0];
    return original(function trackedTick(...tickArgs) {
      // Under pressure the load guard pauses the jobs that can wait (utils/loadGuard.js): the tick is skipped and the next one catches up.
      if (!jobAllowed(base)) return undefined;
      return runJob(bound, () => callback.apply(this, tickArgs));
    }, delay, ...args);
  };
}

const jobStats = () => [...jobs.values()].map((entry) => ({ ...entry, avgMs: entry.runs ? entry.totalMs / entry.runs : 0, dbPerRun: entry.runs ? entry.dbQueries / entry.runs : 0, restPerRun: entry.runs ? entry.restRequests / entry.runs : 0, perMinute: entry.everyMs ? 60_000 / entry.everyMs : 0 }));

// ---------------------------------------------------------------------------------------------------------------------------------

function safe(callback) { try { return callback(); } catch { return null; } }

/** Everything, for the `!perf` tool and the checks. */
function snapshot() {
  return { database: databaseStats(), redis: redisWindow.stats(), rest: restStats(), loop: loopStats(), listeners: listenerStats(), jobs: jobStats(), slowest: slowestCommands(10), recent: records.length, slowCommands: slowCommandCounter.total };
}

/** For the checks: forgets everything measured. */
function reset() {
  records.length = 0;
  listeners.clear();
  eventRate.clear();
  jobs.clear();
  restFamilies.clear();
  rateLimitEvents.length = 0;
  samples.length = 0;
  lastWarn.clear();
  slowCommandCounter.total = 0;
  blockedCalls.total = 0;
}

module.exports = {
  SLOW_COMMAND_MS, BLOCKING_LISTENER_MS,
  createWindow, createMinuteCounter, warnThrottled, nowMs,
  newContext, current, runWith, withDeadline, currentSignal, setCommand, finishContext, slowestCommands, describeRecord,
  requestStore,
  recordDb, databaseStats, setPoolReader,
  recordRedis,
  routeFamily, recordRest, recordResponse, recordRateLimit, recordInvalidWarning, restStarted, restEnded, setGateReader, restStats,
  startSampler, stopSampler, takeSample, loopStats,
  listenerEntry, countEvent, measureListener, listenerStats,
  trackIntervals, trackJob, jobStats, runJob, jobEntry, jobNameFromStack,
  snapshot, reset,
};
