// Checks the status probes of the bot: the website probe retries a blip once and reports a real outage, the database probe times a real
// read, the bot probe reads the shards, and a round that the database refuses is kept and saved with the next one (with its own time).
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/db/postgres.js', { getPrimaryPool: () => { throw new Error('the check never opens the real database'); } });
const { runProbeCycle, probeSite, probeDatabase, probeSelf, pendingChecks } = require('../src/jobs/statusProbeJob');
const { slotOf, SLOT_MS } = require('../src/db/statusChecks');
const { Status } = require('discord.js');

const noSleep = async () => {};
const answers = (map) => async (url) => {
  const hit = map(url);
  if (hit instanceof Error) throw hit;
  return { status: hit };
};

(async () => {
  // The website: fine, a blip that passes on the retry, and a real outage.
  assert.equal((await probeSite(answers(() => 200), noSleep)).ok, true);
  let calls = 0;
  const blip = await probeSite(answers(() => (++calls <= 2 ? 502 : 200)), noSleep);
  assert.equal(blip.ok, true, 'one blip that is gone on the retry is not an interruption');
  const outage = await probeSite(answers((url) => (url.endsWith('/api/health') ? 503 : 200)), noSleep);
  assert.equal(outage.ok, false); assert.match(outage.detail, /503/);
  const unreachable = await probeSite(answers(() => Object.assign(new Error('down'), { cause: { code: 'ECONNREFUSED' } })), noSleep);
  assert.equal(unreachable.ok, false); assert.match(unreachable.detail, /ECONNREFUSED/);

  // The database: a real read, slow or failing is not fine.
  assert.equal((await probeDatabase({ query: async () => ({ rows: [] }) })).ok, true);
  const refused = await probeDatabase({ query: async () => { throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' }); } });
  assert.equal(refused.ok, false); assert.equal(refused.detail, 'ECONNREFUSED');

  // The bot itself.
  const shards = (...statuses) => ({ ws: { shards: new Map(statuses.map((status, id) => [id, { status, ping: 40 + id }])) } });
  assert.deepEqual(probeSelf(shards(Status.Ready, Status.Ready)), { ok: true, ms: 41, detail: null });
  assert.equal(probeSelf(shards(Status.Ready, Status.Reconnecting)).ok, false);
  assert.equal(probeSelf({ ws: { shards: new Map() } }).ok, false);

  // A round: three rows in the same window; a refused save is kept and goes in with the next round.
  const t1 = Date.UTC(2026, 10, 3, 12, 0, 30);
  const saved = [];
  let refuse = true;
  const save = async (rows) => { if (refuse) throw new Error('database down'); saved.push(...rows); };
  const first = await runProbeCycle({ client: shards(Status.Ready), now: t1, fetchFn: answers(() => 200), pool: { query: async () => ({}) }, sleep: noSleep, save });
  assert.deepEqual(first, { saved: 0, kept: 3 }); assert.equal(pendingChecks.length, 3);
  refuse = false;
  const t2 = t1 + SLOT_MS;
  const second = await runProbeCycle({ client: shards(Status.Ready), now: t2, fetchFn: answers(() => 200), pool: { query: async () => ({}) }, sleep: noSleep, save });
  assert.deepEqual(second, { saved: 6, kept: 0 });
  assert.deepEqual([...new Set(saved.map((row) => row.slot))], [slotOf(t1), slotOf(t2)], 'the kept checks go in with their own window');
  assert.deepEqual(saved.slice(0, 3).map((row) => row.service).sort(), ['bot', 'database', 'site']);
  assert.ok(saved.every((row) => row.source === 'bot'));
  console.log('Checked the status probes: the website retry, the database read, the shards, and the checks kept while the database is down.');
})().catch((error) => { console.error(error); process.exit(1); });
