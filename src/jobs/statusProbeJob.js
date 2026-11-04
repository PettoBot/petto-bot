// i18n-ignore-file: status probes for the public status page (nothing here is shown to members).
// Every 2 minutes the bot checks, from where it runs, the things the website cannot honestly check about itself, and writes what it
// found to status_checks (source 'bot'):
//  - the website and the dashboard, asked through the public address (the way a visitor reaches them, behind Cloudflare),
//  - the database, with a real query and the time it took,
//  - itself: the gateway is ready and answers.
// The website writes its own rows (source 'web': the bot's heartbeat, the database and itself), so when one side is down the other
// still records what happened. A check the database could not take is kept here and saved when it can, with the time it belongs to.
const { Status } = require('discord.js');
const { getPrimaryPool } = require('../db/postgres');
const statusChecks = require('../db/statusChecks');
const logger = require('../utils/logger');

const SOURCE = 'bot';
const SITE_URL = () => String(process.env.PETTO_SITE_URL || 'https://petto.sbs').replace(/\/+$/, '');
const PROBE_TIMEOUT_MS = 8_000;
const RETRY_AFTER_MS = 3_000;
const SLOW_QUERY_MS = 4_000;
const OFFSET_MS = 20_000; // after the start of the window, so the website (which checks later) and the bot do not collide
const KEEP_PENDING = 720; // a day of windows

/** One request that counts as fine when it answers 2xx (or a redirect for the sign-in page) in time. */
async function ask(fetchFn, url) {
  const started = Date.now();
  try {
    const response = await fetchFn(url, { redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), headers: { 'user-agent': 'petto-status-probe' } });
    const ms = Date.now() - started;
    const ok = response.status >= 200 && response.status < 400;
    return { ok, ms, detail: ok ? null : `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, detail: String(error?.name === 'TimeoutError' ? 'timeout' : error?.cause?.code || error?.code || 'unreachable') };
  }
}

/** The website and the dashboard: the home page (served from files) and the light health route (served by the app). One quick retry, so a blip is not an interruption. */
async function probeSite(fetchFn = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const once = async () => {
    const [page, health] = await Promise.all([ask(fetchFn, `${SITE_URL()}/`), ask(fetchFn, `${SITE_URL()}/api/health`)]);
    return { ok: page.ok && health.ok, ms: Math.max(page.ms, health.ms), detail: page.ok ? health.detail : `home ${page.detail}` };
  };
  const first = await once();
  if (first.ok) return first;
  await sleep(RETRY_AFTER_MS);
  const second = await once();
  return second.ok ? { ...second, detail: null } : second;
}

/** The database: a real read and the time it took. Slower than a few seconds is not fine. */
async function probeDatabase(pool = getPrimaryPool()) {
  const started = Date.now();
  try {
    await pool.query('select updated_at from bot_host limit 1');
    const ms = Date.now() - started;
    return { ok: ms < SLOW_QUERY_MS, ms, detail: ms < SLOW_QUERY_MS ? null : 'slow' };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, detail: String(error?.code || error?.message || 'error').slice(0, 40) };
  }
}

/** The bot itself: every shard is ready. The latency is the gateway's. */
function probeSelf(client) {
  const shards = [...(client?.ws?.shards?.values?.() ?? [])];
  if (!shards.length) return { ok: false, ms: null, detail: 'no shards' };
  const ready = shards.filter((shard) => shard.status === Status.Ready).length;
  const pings = shards.map((shard) => shard.ping).filter((ping) => ping >= 0);
  return { ok: ready === shards.length, ms: pings.length ? Math.max(...pings) : null, detail: ready === shards.length ? null : `shards ${ready}/${shards.length}` };
}

const pending = [];

/** One round of checks. Exported so the check can run it with stand-ins for the network and the database. */
async function runProbeCycle({ client, now = Date.now(), fetchFn = fetch, pool, sleep, save = statusChecks.saveChecks } = {}) {
  const slot = statusChecks.slotOf(now);
  const [site, database] = await Promise.all([probeSite(fetchFn, sleep), probeDatabase(pool)]);
  const self = probeSelf(client);
  const fresh = [
    { slot, service: 'site', source: SOURCE, ok: site.ok, latencyMs: site.ms, detail: site.detail },
    { slot, service: 'database', source: SOURCE, ok: database.ok, latencyMs: database.ms, detail: database.detail },
    { slot, service: 'bot', source: SOURCE, ok: self.ok, latencyMs: self.ms, detail: self.detail },
  ];
  const batch = [...pending.splice(0), ...fresh];
  try {
    await save(batch);
    return { saved: batch.length, kept: 0 };
  } catch (error) {
    // The database did not take them: they wait (the oldest go first when there are too many) and go in with the next round.
    pending.push(...batch);
    if (pending.length > KEEP_PENDING) pending.splice(0, pending.length - KEEP_PENDING);
    logger.warn(`Status probe could not save its checks (${pending.length} waiting):`, error?.message ?? error);
    return { saved: 0, kept: pending.length };
  }
}

function startStatusProbeJob(client) {
  const schedule = () => {
    const now = Date.now();
    const next = statusChecks.slotOf(now) + statusChecks.SLOT_MS + OFFSET_MS;
    setTimeout(() => {
      runProbeCycle({ client }).catch((error) => logger.error('Status probe failed:', error)).finally(schedule);
    }, Math.max(1_000, next - now)).unref?.();
  };
  schedule();
  logger.info('Status probe job started (every 2 minutes).');
}

module.exports = { startStatusProbeJob, runProbeCycle, probeSite, probeDatabase, probeSelf, pendingChecks: pending };
