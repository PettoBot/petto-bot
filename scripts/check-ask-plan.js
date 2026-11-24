// The questions a day of /ask follow the plan of a person: Bronze 20, Silver 60, Gold 150; never less than a free member; no plan, an ended plan or an unreadable one keep the free limit.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');
let row = null; let fails = false;
const dbPath = require.resolve(path.join('..', 'src', 'db', 'userPlans'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getPlan: async () => { if (fails) throw new Error('db down'); return row; } } };
process.env.ASK_FREE_DAILY = '10';
const askAi = require('../src/utils/askAi');
(async () => {
  assert.equal(await askAi.planLimit('1'), null, 'no plan: the free limit applies');
  row = { plan: 'bronze', active: true }; assert.equal(await askAi.planLimit('1'), 20);
  row = { plan: 'silver', active: true }; assert.equal(await askAi.planLimit('1'), 60);
  row = { plan: 'gold', active: true }; assert.equal(await askAi.planLimit('1'), 150);
  row = { plan: 'gold', active: false }; assert.equal(await askAi.planLimit('1'), null, 'an ended plan gives nothing');
  row = { plan: 'unknown', active: true }; assert.equal(await askAi.planLimit('1'), null);
  process.env.ASK_FREE_DAILY = '40'; row = { plan: 'bronze', active: true };
  assert.equal(await askAi.planLimit('1'), 40, 'never less than a free member');
  fails = true; assert.equal(await askAi.planLimit('1'), null, 'an unreadable plan keeps the free limit');
  // The limit is used when asking: a Gold member can ask 150, and the 151st is refused.
  fails = false; process.env.ASK_FREE_DAILY = '10'; row = { plan: 'gold', active: true };
  let used = 0;
  const store = { consume: async (_user, _day, limit) => (used < limit ? { ok: true, used: ++used } : { ok: false }), usedOn: async () => used };
  const base = { configured: () => true, chat: async () => 'answer', now: () => Date.parse('2026-11-25T12:00:00Z') };
  process.env.GROQ_API_KEY = 'x'; process.env.ASK_COOLDOWN_FREE_SECONDS = '0';
  const left = await askAi.remainingToday('9', { store, who: askAi.whoIs, now: base.now });
  assert.equal(left.limit, 150); assert.equal(left.left, 150);
  console.log('ask plan: ok');
})().catch((error) => { console.error(error); process.exit(1); });
