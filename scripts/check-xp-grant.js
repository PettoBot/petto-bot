// Checks how an award of XP is put together: an XP event multiplies it, the first activity of a day adds the daily and
// streak bonus once, and the XP of the week and month is recorded. The database and Discord are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const calls = { addXp: [], addVoiceXp: [], period: [], touch: 0 };
let events = [];
let streakAnswer = { newDay: true, streak: 1 };
const users = { u1: { xp: 0, level: 0, voice_xp: 0, voice_level: 0 } };
stub('src/db/levelUsers.js', {
  ensureUser: async (g, id) => users[id],
  addXp: async (g, id, { xpGain }) => { calls.addXp.push(xpGain); users[id].xp += xpGain; return users[id]; },
  addVoiceXp: async (g, id, { xpGain }) => { calls.addVoiceXp.push(xpGain); users[id].voice_xp += xpGain; return users[id]; },
  touchStreak: async () => { calls.touch += 1; return streakAnswer; },
  setLevel: async () => {}, setVoiceLevel: async () => {}, getUser: async (g, id) => users[id], getRank: async () => 1, getVoiceRank: async () => 1,
});
stub('src/db/levelRewards.js', { listRewards: async () => [] });
stub('src/db/levelMultipliers.js', { listMultipliers: async () => [] });
stub('src/db/xpEvents.js', { listEvents: async () => events });
stub('src/db/levelPeriods.js', { addPeriodXp: async (g, id, amount) => { calls.period.push(amount); } });
stub('src/db/embedTemplates.js', {});
stub('src/utils/embedBuilder.js', { build: async () => ({}) });
stub('src/utils/embedVariables.js', { resolve: async (text) => text });
stub('src/utils/messageFlags.js', { extractReactReplies: (text) => ({ text, emojis: [] }), applyReactReplies: async () => {} });
stub('src/utils/cardService.js', { renderRankCard: async () => null, CARD_FILE_NAME: 'card.png' });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
const { grantXp, grantVoiceXp } = require('../src/utils/levelActions');

const guild = { id: '9' };
const member = { id: 'u1' };
const config = { notify_mode: 'off', max_level: 100, daily_bonus_xp: 50, streak_bonus_xp: 10, streak_max_days: 7 };

(async () => {
  let result = await grantXp({ guild, member, config, xpGain: 20, messageInc: 1 });
  assert.equal(calls.addXp.at(-1), 70, 'the first activity of the day adds the daily bonus');
  assert.equal(result.bonusXp, 50);
  assert.deepEqual(calls.period.at(-1), { textXp: 70 }, 'the week and month get the whole award');

  result = await grantXp({ guild, member, config, xpGain: 20, messageInc: 1 });
  assert.equal(calls.addXp.at(-1), 20, 'the same day again is not asked about the streak again and has no bonus');
  assert.equal(calls.touch, 1, 'the streak is touched once a day, not on every message');

  events = [{ source: 'text', multiplier: '2', starts_at: new Date(Date.now() - 1000), ends_at: new Date(Date.now() + 60_000) }];
  await grantXp({ guild, member, config, xpGain: 20, messageInc: 1 });
  assert.equal(calls.addXp.at(-1), 40, 'a running event doubles it');
  await grantVoiceXp({ guild, member, config, xpGain: 5, vcInc: 1 });
  assert.equal(calls.addVoiceXp.at(-1), 5, 'an event for text does not touch voice');
  assert.deepEqual(calls.period.at(-1), { voiceXp: 5 });

  // A new day with a streak of 4: 50 + 10 x 3.
  streakAnswer = { newDay: true, streak: 4 };
  const other = { id: 'u2' };
  users.u2 = { xp: 0, level: 0 };
  events = [];
  await grantXp({ guild, member: other, config, xpGain: 20, messageInc: 1 });
  assert.equal(calls.addXp.at(-1), 100, 'the streak bonus grows with the days in a row');

  // Reading the events failing must not stop the award.
  stub('src/db/xpEvents.js', { listEvents: async () => { throw new Error('db down'); } });
  delete require.cache[require.resolve('../src/utils/levelActions')];
  const fresh = require('../src/utils/levelActions');
  users.u3 = { xp: 0, level: 0 };
  streakAnswer = { newDay: false, streak: 2 };
  await fresh.grantXp({ guild, member: { id: 'u3' }, config, xpGain: 20, messageInc: 1 });
  assert.equal(calls.addXp.at(-1), 20, 'when the events cannot be read the plain XP is still given');
  console.log('Checked how XP is awarded: events, daily and streak bonus, and the weekly record.');
})().catch((error) => { console.error(error); process.exit(1); });
