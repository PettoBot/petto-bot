// i18n-ignore-file: internal request pacing (no text for members).
// Every request to Discord goes through here: the two-lane gate (utils/restGate.js), the optional Redis count shared by the processes that use the
// same Redis, and the measurements of utils/perf.js (latency by route family, our queue against the network, rate limits, invalid requests, the
// clock of the host against the `Date` header of Discord). Without Redis the gate and the limit of discord.js are all there is.
const { performance } = require('node:perf_hooks');
const redis = require('./redis');
const perf = require('./perf');
const { createGate, RestGateError } = require('./restGate');
const config = require('../config');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// A person waiting for an answer goes first; a bulk loop that makes many requests (a purge of reactions, a mass role) is not one for long.
const HIGH_LANE_MAX_REQUESTS = 25;

/** In critical mode only the essential work (utils/loadGuard.js) may send background requests: a job or a listener that is not essential is refused. */
function essentialRequest() {
  try {
    const loadGuard = require('./loadGuard');
    if (loadGuard.level() !== 'critical') return true;
    const context = perf.current();
    if (!context) return true;
    const base = String(context.name ?? '').split('/').pop().split('@')[0];
    return context.kind === 'job' ? loadGuard.allowsJob(base) : loadGuard.essentialEvent(base);
  } catch { return true; }
}

/** The lane of a request: `high` for the answers a person waits for, `normal` for the rest. */
function priorityOf(options) {
  if (/^\/interactions\//.test(String(options?.fullRoute ?? ''))) return 'high';
  const context = perf.current();
  return context?.interactive && context.rest.n < HIGH_LANE_MAX_REQUESTS ? 'high' : 'normal';
}

function header(response, name) {
  try { return response?.headers?.get?.(name) ?? null; } catch { return null; }
}

/** The HTTP call of discord.js, measured: time inside the call, status, the `Date` header and the 429s of Discord (or of what stands in front of it). */
function wrapMakeRequest(rest) {
  const options = rest.options;
  if (!options || typeof options.makeRequest !== 'function' || options.makeRequest.__measured) return;
  const original = options.makeRequest;
  const measured = async function measuredMakeRequest(url, init) {
    const request = perf.requestStore.getStore();
    const started = performance.now();
    try {
      const response = await original.call(this, url, init);
      const status = Number(response?.status) || 0;
      if (request) { request.net += performance.now() - started; request.attempts += 1; request.status = status; }
      try {
        const family = perf.routeFamily(init?.method, url);
        perf.recordResponse({ family, status, dateHeader: header(response, 'date') });
        if (status === 429) {
          const html = /text\/html/i.test(String(header(response, 'content-type') ?? ''));
          perf.recordRateLimit({
            family,
            waitMs: (Number(header(response, 'retry-after')) || 0) * 1000,
            global: header(response, 'x-ratelimit-global') === 'true',
            // A 429 with a web page and not JSON does not come from the API of Discord: it is the protection in front of it (Cloudflare).
            scope: html ? 'cloudflare' : (header(response, 'x-ratelimit-scope') ?? 'route'),
            source: 'discord',
          });
        }
      } catch { /* measuring never breaks a request */ }
      return response;
    } catch (error) {
      if (request) { request.net += performance.now() - started; request.attempts += 1; request.failed = true; }
      throw error;
    }
  };
  measured.__measured = true;
  options.makeRequest = measured;
}

function attachSharedRestLimit(rest, perSecond) {
  if (!rest || typeof rest.request !== 'function' || rest.__sharedLimit) return null;
  rest.__sharedLimit = true;
  const gate = createGate({ perSecond, maxQueue: config.restMaxQueue, failFastMs: config.restMaxWaitSeconds * 1000, maxInFlight: config.restMaxInFlight });
  perf.setGateReader(() => gate.stats());
  wrapMakeRequest(rest);
  try {
    if (typeof rest.on === 'function') {
      rest.on('rateLimited', (info = {}) => perf.recordRateLimit({ family: perf.routeFamily(info.method, info.route ?? info.url), waitMs: Number(info.timeToReset ?? info.retryAfter) || 0, global: Boolean(info.global), scope: info.scope ?? 'route', source: 'client' }));
      rest.on('invalidRequestWarning', (info = {}) => perf.recordInvalidWarning(info.count));
      if (rest.options && !rest.options.invalidRequestWarningInterval) rest.options.invalidRequestWarningInterval = 100;
    }
  } catch { /* measuring never breaks the client */ }

  const original = rest.request.bind(rest);
  rest.request = async (options) => {
    const priority = priorityOf(options);
    const started = performance.now();
    const request = { net: 0, attempts: 0, status: 0, failed: false };
    perf.restStarted();
    let gateMs = 0;
    let acquired = false;
    try {
      // Critical: only the essential work still asks Discord for anything (utils/loadGuard.js); the rest fails at once instead of waiting in the line.
      if (priority !== 'high' && !essentialRequest()) throw new RestGateError('PETTO_REST_SHED', 'The bot is under pressure and this background request to Discord was not sent.'); // i18n-ignore: internal
      // A request with a deadline (utils/perf.js `withDeadline`) leaves the line when the time is up.
      const signal = options?.signal ?? perf.currentSignal();
      if (signal && !options?.signal) options = { ...options, signal };
      await gate.acquire(priority, { signal });
      acquired = true;
      if (redis.enabled()) {
        if (priority === 'high') redis.countThisSecond('rest').catch(() => {}); // counted, never waited for
        else {
          // One look is enough: the gate already paces this process, so a count above the limit comes from another process, and waiting
          // for the next second once is what gives it room. (Counting again every second made every waiting request wait for five.)
          const used = await redis.countThisSecond('rest');
          if (used > perSecond) await sleep(1_005 - (Date.now() % 1_000));
        }
      }
      gateMs = performance.now() - started; // our queue: the gate and the Redis count
      return await perf.requestStore.run(request, () => original(options));
    } catch (error) {
      request.failed = true;
      throw error;
    } finally {
      if (acquired) gate.done();
      perf.restEnded();
      perf.recordRest({ family: perf.routeFamily(options?.method, options?.fullRoute), totalMs: performance.now() - started, gateMs, netMs: request.net, status: request.status, attempts: Math.max(1, request.attempts), failed: request.failed });
    }
  };
  return gate;
}

module.exports = { attachSharedRestLimit, priorityOf, wrapMakeRequest };
