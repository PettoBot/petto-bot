// How many times each command was run (all servers together, since this started counting): the numbers behind `/topcommands`.
// Counting never slows a command down or breaks it: a run only adds one to a counter in memory, and the counters are written to the
// database together every few seconds; when a write fails the counts are kept and sent with the next one.
const getPrimaryPool = () => require('./postgres').getPrimaryPool();
const logger = require('../utils/logger');

const FLUSH_INTERVAL_MS = 5_000;
const MAX_NAMES_PER_WRITE = 500;
const pending = new Map();
let timer = null;
let flushing = null;
let lastErrorAt = 0;

/** Counts one run of a command (its top-level name: `remind`, `afk`...). */
function recordCommandUse(name) {
  const key = String(name ?? '').trim().toLowerCase();
  if (!key || key.length > 64) return;
  pending.set(key, (pending.get(key) ?? 0) + 1);
  if (!timer) {
    timer = setInterval(() => { flushCommandUsage().catch(() => {}); }, FLUSH_INTERVAL_MS);
    timer.unref?.();
  }
}

/** Writes what is waiting. A failed write puts the counts back, so nothing is lost and nothing is counted twice. */
function flushCommandUsage() {
  if (flushing) return flushing;
  if (!pending.size) return Promise.resolve();
  const batch = [...pending.entries()].slice(0, MAX_NAMES_PER_WRITE);
  for (const [name] of batch) pending.delete(name);
  flushing = (async () => {
    try {
      const names = batch.map(([name]) => name);
      const counts = batch.map(([, count]) => count);
      await getPrimaryPool().query(
        'insert into command_usage (command, uses) select * from unnest($1::text[], $2::bigint[]) on conflict (command) do update set uses = command_usage.uses + excluded.uses',
        [names, counts],
      );
    } catch (error) {
      for (const [name, count] of batch) pending.set(name, (pending.get(name) ?? 0) + count);
      if (Date.now() - lastErrorAt > 60_000) {
        lastErrorAt = Date.now();
        logger.warn('Command usage could not be saved, it will be tried again:', error.message);
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** What has been counted: a map from command name to runs (what is still waiting in memory included). */
async function readCommandUsage() {
  const counts = new Map();
  try {
    const { rows } = await getPrimaryPool().query('select command, uses from command_usage');
    for (const row of rows) counts.set(row.command, Number(row.uses));
  } catch (error) {
    logger.warn('Command usage could not be read:', error.message);
  }
  for (const [name, count] of pending) counts.set(name, (counts.get(name) ?? 0) + count);
  return counts;
}

module.exports = { recordCommandUse, flushCommandUsage, readCommandUsage };
