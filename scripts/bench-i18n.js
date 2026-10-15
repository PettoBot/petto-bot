// Measures what the languages cost on the hot path of Petto: `t()`, `runWithLanguage`, `guildLanguage` (cache warm and cold),
// and the time from Discord emitting messageCreate / interactionCreate to the first line of an event handler.
//   node scripts/bench-i18n.js                      this checkout
//   PETTO_ROOT=/path/to/other/checkout node scripts/bench-i18n.js   another commit (for example the one before #245)
// The database is replaced by a fake that answers after DB_MS milliseconds (default 3), so "cold" shows what a lookup would
// cost if the hot path waited for it. Nothing here talks to Discord or a real database.
process.env.DISCORD_TOKEN ||= 'bench-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://bench:bench@127.0.0.1:1/bench';
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const ROOT = path.resolve(process.env.PETTO_ROOT || path.join(__dirname, '..'));
const DB_MS = Number(process.env.DB_MS ?? 3);
const EVENTS = Number(process.env.EVENTS ?? 5000);
const file = (relative) => path.join(ROOT, relative);
const has = (relative) => fs.existsSync(file(relative));

function stub(relative, exports) {
  const resolved = require.resolve(file(relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

// The database: every lookup waits DB_MS and is counted.
let dbCalls = 0;
const wait = () => new Promise((resolve) => setTimeout(resolve, DB_MS));
const languageOfGuild = (id) => (Number(String(id).slice(-1)) % 2 ? 'es' : 'en');
stub('src/db/database.js', { from: () => ({}) });
if (has('src/db/guilds.js')) {
  stub('src/db/guilds.js', {
    ensureGuild: async (id) => { dbCalls += 1; await wait(); return { guild_id: id, prefix: '!', language: languageOfGuild(id) }; },
    findGuildLanguage: async (id) => { dbCalls += 1; await wait(); return languageOfGuild(id); },
    listGuildLanguages: async () => { dbCalls += 1; await wait(); return Array.from({ length: 2000 }, (_, i) => ({ guild_id: `9000${i}`, language: languageOfGuild(i) })); },
    createGuildIfMissing: async (id) => ({ row: { guild_id: id, language: 'en' }, created: false }),
    updateGuild: async (id, patch) => ({ guild_id: id, ...patch }),
  });
}
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const logger = require(file('src/utils/logger.js'));
Object.assign(logger, quiet);

const ns = () => Number(process.hrtime.bigint());
const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(3)} ms` : `${(n / 1e3).toFixed(2)} µs`);
function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  return { mean, p50: pick(0.5), p99: pick(0.99) };
}
const line = (name, s, extra = '') => console.log(`${name.padEnd(46)} mean ${fmt(s.mean).padStart(11)}  p50 ${fmt(s.p50).padStart(11)}  p99 ${fmt(s.p99).padStart(11)}${extra}`);

async function microbenchmarks() {
  if (!has('src/i18n/index.js')) {
    console.log('src/i18n is not in this checkout: no t(), runWithLanguage or guildLanguage to measure.');
    return;
  }
  const i18n = require(file('src/i18n/index.js'));
  const key = Object.keys(i18n.CATALOGS.en).find((k) => /\{/.test(i18n.CATALOGS.en[k])) ?? Object.keys(i18n.CATALOGS.en)[0];
  const many = (count, fn) => { const start = ns(); for (let i = 0; i < count; i += 1) fn(i); return (ns() - start) / count; };
  console.log(`t() with variables:                            ${fmt(many(200_000, () => i18n.t('es', key, { user: 'Ana', count: 3 })))} per call`);
  console.log(`runWithLanguage(lang, fn):                     ${fmt(many(200_000, () => i18n.runWithLanguage('es', () => i18n.currentLanguage())))} per call`);

  // Warm: the server is in the cache.
  if (typeof i18n.loadGuildLanguages === 'function') await i18n.loadGuildLanguages();
  if (typeof i18n.setCachedGuildLanguage === 'function') i18n.setCachedGuildLanguage('900001', 'es');
  await i18n.guildLanguage('900001');
  const before = dbCalls;
  const warm = [];
  for (let i = 0; i < 50_000; i += 1) { const start = ns(); await i18n.guildLanguage('900001'); warm.push(ns() - start); }
  line('guildLanguage, cache warm (await)', stats(warm), `  db calls: ${dbCalls - before}`);
  if (typeof i18n.peekGuildLanguage === 'function') {
    console.log(`peekGuildLanguage (no await):                  ${fmt(many(500_000, () => i18n.peekGuildLanguage('900001')))} per call`);
  }

  // Cold: a server never seen (or whose cache ran out).
  const cold = [];
  const coldBefore = dbCalls;
  for (let i = 0; i < 300; i += 1) { const start = ns(); await i18n.guildLanguage(`77${i}000000000000000`); cold.push(ns() - start); }
  line(`guildLanguage, cache cold (DB ${DB_MS} ms)`, stats(cold), `  db calls: ${dbCalls - coldBefore}`);
}

/** The time from `client.emit(name, ...)` to the first line of a handler, through the real event handler of this checkout. */
async function eventDispatch() {
  const eventsDir = file('src/events');
  const probePath = path.join(eventsDir, '__bench_probe.js');
  let reached = null;
  const probes = {
    messageCreate: { name: 'messageCreate', execute: () => reached?.() },
    interactionCreate: { name: 'interactionCreate', execute: () => reached?.() },
  };
  const realReaddir = fs.readdirSync;
  const results = {};
  for (const [eventName, probe] of Object.entries(probes)) {
    for (const key of Object.keys(require.cache)) if (key.endsWith(`${path.sep}eventHandler.js`) || key === probePath) delete require.cache[key];
    // A real file has to exist for require() to find it; it only hands over the probe and is deleted right after.
    global.__pettoBenchProbe = probe;
    fs.writeFileSync(probePath, 'module.exports = global.__pettoBenchProbe;\n');
    fs.readdirSync = (dir, ...rest) => (path.resolve(String(dir)) === eventsDir ? ['__bench_probe.js'] : realReaddir(dir, ...rest));
    const { loadEvents } = require(file('src/handlers/eventHandler.js'));
    const client = new EventEmitter();
    loadEvents(client);
    fs.readdirSync = realReaddir;
    fs.rmSync(probePath, { force: true });

    const emitOnce = (guildId) => new Promise((resolve) => {
      const start = ns();
      reached = () => resolve(ns() - start);
      const payload = eventName === 'messageCreate'
        ? { guildId, guild: { id: guildId }, channelId: '2', author: { id: '3' }, content: 'hi' }
        : { guildId, guild: { id: guildId }, channelId: '2', user: { id: '3' }, locale: 'es-ES', commandName: 'ping' };
      client.emit(eventName, payload);
    });
    // Warm: one server, many events (the usual case once the bot runs).
    await emitOnce('900001');
    const warm = [];
    const warmBefore = dbCalls;
    for (let i = 0; i < EVENTS; i += 1) warm.push(await emitOnce('900001'));
    const warmDb = dbCalls - warmBefore;
    // Cold: every event from a server whose language is not cached.
    const cold = [];
    const coldBefore = dbCalls;
    const prefix = eventName === 'messageCreate' ? '55' : '66';
    for (let i = 0; i < 300; i += 1) cold.push(await emitOnce(`${prefix}${i}000000000000000`));
    results[eventName] = { warm: stats(warm), warmDb, cold: stats(cold), coldDb: dbCalls - coldBefore };
  }
  delete require.cache[probePath];
  fs.rmSync(probePath, { force: true });
  for (const [eventName, r] of Object.entries(results)) {
    line(`${eventName} -> handler, server cached`, r.warm, `  db calls: ${r.warmDb}`);
    line(`${eventName} -> handler, server not cached`, r.cold, `  db calls: ${r.coldDb}`);
  }
}

(async () => {
  console.log(`Petto i18n benchmark — ${ROOT} — Node ${process.version}, fake DB ${DB_MS} ms`);
  await microbenchmarks();
  await eventDispatch();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
