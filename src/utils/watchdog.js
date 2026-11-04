// i18n-ignore-file: internal watchdog (logs and the private `!perf` tool).
// The last resort. When the bot cannot recover by itself the process stops cleanly and the host starts it again:
//   - it has been CRITICAL (utils/loadGuard.js) for `watchdogCriticalMinutes`;
//   - the event loop was blocked for `watchdogBlockedSeconds` (a thread apart watches a beat of the main thread and, if the loop is stuck, ends the process);
//   - rss passes `watchdogRssPercent` of BOT_MEMORY_LIMIT_MB even after the caches were dropped.
// It never restarts in a loop: no more than `watchdogMaxRestartsPerHour` restarts in an hour (the times are kept in the database and in a file); past
// that the bot stays in critical mode and tells the team instead of exiting. Every exit tells the priority channel first.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const logger = require('./logger');

const HOUR_MS = 3_600_000;
const SETTING_KEY = 'watchdog_restarts';
const FILE = path.join(os.tmpdir(), 'petto-watchdog.json');

/**
 * What to do with the numbers of this moment. Pure: `state` is `{ level, criticalForMs, blockedForMs, rssMb, cachesDropped, restartsLastHour }` and
 * `limits` is `{ criticalMs, blockedMs, rssLimitMb, maxRestarts }`. Answers `{ action, reason }` where action is 'none', 'drop-caches', 'exit' or 'hold'
 * (a reason to exit with no restarts left: stay critical).
 */
function decide(state, limits) {
  let reason = null;
  if (state.level === 'critical' && state.criticalForMs >= limits.criticalMs) reason = `critical for ${Math.round(state.criticalForMs / 1000)} s (limit ${Math.round(limits.criticalMs / 1000)} s)`;
  else if (state.blockedForMs >= limits.blockedMs) reason = `the event loop was blocked for ${Math.round(state.blockedForMs / 1000)} s (limit ${Math.round(limits.blockedMs / 1000)} s)`;
  else if (state.rssMb >= limits.rssLimitMb) {
    if (!state.cachesDropped) return { action: 'drop-caches', reason: `memory ${Math.round(state.rssMb)} MB passed ${Math.round(limits.rssLimitMb)} MB` };
    reason = `memory ${Math.round(state.rssMb)} MB is still over ${Math.round(limits.rssLimitMb)} MB after the caches were dropped`;
  }
  if (!reason) return { action: 'none', reason: null };
  if (state.restartsLastHour >= limits.maxRestarts) return { action: 'hold', reason: `${reason}, but ${state.restartsLastHour} restarts already happened in the last hour` };
  return { action: 'exit', reason };
}

const recent = (times, now) => (Array.isArray(times) ? times : []).map(Number).filter((time) => Number.isFinite(time) && now - time < HOUR_MS && time <= now + 60_000);

function readFileTimes() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}

/** The restarts of the last hour: the union of the database and the file (either can be missing). */
async function loadRestarts({ now = Date.now(), db = null, file = true } = {}) {
  const found = [];
  try {
    const store = db ?? require('../db/botSettings');
    const raw = await Promise.race([store.getSetting(SETTING_KEY), new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 2_000).unref?.())]);
    found.push(...(typeof raw === 'string' ? JSON.parse(raw) : Array.isArray(raw) ? raw : []));
  } catch { /* the file still has them */ }
  if (file) found.push(...readFileTimes());
  return [...new Set(recent(found, now))].sort((a, b) => a - b);
}

async function saveRestarts(times, { db = null, file = true } = {}) {
  if (file) { try { fs.writeFileSync(FILE, JSON.stringify(times)); } catch { /* the database has them */ } }
  try {
    const store = db ?? require('../db/botSettings');
    await Promise.race([store.setSetting(SETTING_KEY, JSON.stringify(times)), new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 2_000).unref?.())]);
  } catch { /* the file has them */ }
}

const state = {
  running: false, restarts: [], lastDecision: null, lastCheckAt: 0, cachesDroppedAt: 0, criticalSince: null, holding: false, exiting: false, heartbeatLagMs: 0, worker: false,
};
let timer = null;
let beat = null; // Float64Array shared with the thread apart: [last beat of the main thread, restarts in the last hour, blocked limit ms]
let worker = null;

/** A thread apart that ends the process when the main thread stopped beating for `blockedMs` (a stuck loop cannot end itself). */
function startThread(blockedMs) {
  try {
    beat = new Float64Array(new SharedArrayBuffer(8 * 4));
    beat[0] = Date.now();
    beat[2] = blockedMs;
    beat[3] = 3;
    const code = `
      const { workerData } = require('node:worker_threads');
      const beat = new Float64Array(workerData.buffer);
      setInterval(() => {
        const silent = Date.now() - Atomics.load(beat, 0);
        if (silent >= Atomics.load(beat, 2) && Atomics.load(beat, 1) < Atomics.load(beat, 3)) process.kill(process.pid, 'SIGKILL');
      }, 2000);
    `;
    worker = new Worker(code, { eval: true, workerData: { buffer: beat.buffer }, resourceLimits: { maxOldGenerationSizeMb: 16 } });
    worker.unref();
    worker.on('error', () => { state.worker = false; });
    state.worker = true;
  } catch {
    state.worker = false;
  }
}

/** Starts watching. `exit(reason)` stops the process cleanly (set by index.js); `metrics()` gives `{ level, rssMb }` (the real ones by default). */
async function start({ exit, config = require('../config'), loadGuard = require('./loadGuard'), every = 5_000, now = () => Date.now(), thread = true } = {}) {
  if (state.running || !config.watchdogEnabled) return false;
  state.running = true;
  state.restarts = await loadRestarts({ now: now() });
  const limits = () => ({ criticalMs: config.watchdogCriticalMinutes * 60_000, blockedMs: config.watchdogBlockedSeconds * 1000, rssLimitMb: config.memoryLimitMb * config.watchdogRssPercent / 100, maxRestarts: config.watchdogMaxRestartsPerHour });
  if (thread) startThread(limits().blockedMs);
  let lastTick = now();
  timer = setInterval(async () => {
    const current = now();
    const lag = current - lastTick - every;
    lastTick = current;
    state.heartbeatLagMs = Math.max(0, lag);
    if (beat) { beat[0] = Date.now(); beat[1] = recent(state.restarts, current).length; }
    const level = loadGuard.level();
    state.criticalSince = level === 'critical' ? (state.criticalSince ?? current) : null;
    const decision = decide({
      level, criticalForMs: state.criticalSince ? current - state.criticalSince : 0, blockedForMs: Math.max(0, lag), rssMb: process.memoryUsage().rss / 1048576,
      cachesDropped: state.cachesDroppedAt > 0 && current - state.cachesDroppedAt < 10 * 60_000, restartsLastHour: recent(state.restarts, current).length,
    }, limits());
    state.lastDecision = { at: current, ...decision };
    state.lastCheckAt = current;
    if (decision.action === 'drop-caches') {
      state.cachesDroppedAt = current;
      const dropped = loadGuard.dropCaches();
      logger.warn(`[watchdog] ${decision.reason}: the caches were dropped (${dropped} entries).`);
    } else if (decision.action === 'hold' && !state.holding) {
      state.holding = true;
      try { loadGuard.force('critical'); } catch { /* it stays as it is */ }
      logger.error(`[watchdog] ${decision.reason}. The bot stays in critical mode and does not restart (\`!perf level auto\` gives the level back to the numbers).`);
    } else if (decision.action === 'exit' && !state.exiting) {
      state.exiting = true;
      state.restarts = [...recent(state.restarts, current), current];
      logger.error(`[watchdog] Restarting the bot: ${decision.reason}. This is restart ${state.restarts.length} of ${limits().maxRestarts} allowed in an hour.`);
      await saveRestarts(state.restarts);
      await new Promise((resolve) => setTimeout(resolve, 2_500)); // the alert reaches the priority channel before the process goes
      try { await exit(`watchdog: ${decision.reason}`); } catch { process.exit(1); }
    }
  }, every);
  timer.unref?.();
  return true;
}

function stop() { if (timer) clearInterval(timer); timer = null; try { worker?.terminate(); } catch { /* gone */ } worker = null; beat = null; state.running = false; state.exiting = false; }

function stats(now = Date.now()) {
  return { running: state.running, thread: state.worker, restartsLastHour: recent(state.restarts, now).length, restartTimes: recent(state.restarts, now), lastDecision: state.lastDecision, criticalSince: state.criticalSince, holding: state.holding, heartbeatLagMs: state.heartbeatLagMs, cachesDroppedAt: state.cachesDroppedAt };
}

module.exports = { decide, loadRestarts, saveRestarts, start, stop, stats, recent };
