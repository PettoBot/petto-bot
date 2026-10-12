// Checks the giveaways with levels: the extra entries from levels (the best step of each kind of level), the level needed to enter,
// the weights of the draw and the text of the preset. The database and Discord are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const levelRows = new Map([
  ['low', { user_id: 'low', level: 2, voice_level: 0 }],
  ['mid', { user_id: 'mid', level: 12, voice_level: 3 }],
  ['high', { user_id: 'high', level: 60, voice_level: 25 }],
]);
stub('src/db/levelUsers.js', { getUsers: async (guildId, ids) => new Map(ids.filter((id) => levelRows.has(id)).map((id) => [id, levelRows.get(id)])) });
stub('src/db/giveaways.js', {});
stub('src/db/giveawayPresets.js', {
  listRoles: async () => [{ role_id: 'r1', entries: 2, claim_time_ms: 0, entries_stack: false, claim_time_stack: false }],
  listLevels: async () => [
    { source: 'text', level: 10, entries: 1 }, { source: 'text', level: 50, entries: 4 }, { source: 'voice', level: 20, entries: 2 },
  ],
  getPresetById: async () => ({ id: 1, min_level: 5, min_voice_level: 0 }),
});
stub('src/utils/giveawayCard.js', {});
stub('src/utils/senderIdentity.js', { sendAs: async () => null });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/utils/emojis.js', { EMOJI: {} });
const { loadPreset, computeLevelBonus, entryProblem, buildPresetText, weightedDraw } = require('../src/utils/giveawayEngine');

(async () => {
  const preset = await loadPreset(1);
  assert.equal(preset.length, 1, 'the roles are the array');
  assert.equal(preset.levels.length, 3);
  assert.deepEqual([preset.minLevel, preset.minVoiceLevel], [5, 0]);

  // Extra entries: the best step reached of each kind of level, the two kinds added.
  assert.equal(computeLevelBonus(levelRows.get('low'), preset.levels), 0, 'below every step');
  assert.equal(computeLevelBonus(levelRows.get('mid'), preset.levels), 1, 'level 12 reached the step of 10, voice 3 reached none');
  assert.equal(computeLevelBonus(levelRows.get('high'), preset.levels), 6, 'level 60 gives the step of 50 (4, not 1 + 4) and voice 25 the step of 20 (2)');
  assert.equal(computeLevelBonus(null, preset.levels), 0, 'a member with no level row');
  assert.equal(computeLevelBonus(levelRows.get('high'), []), 0);

  // The level needed to enter.
  assert.match(await entryProblem('g', preset, 'low'), /message level \*\*5\*\* \(you are at 2\)/);
  assert.equal(await entryProblem('g', preset, 'mid'), null);
  assert.match(await entryProblem('g', preset, 'nobody'), /you are at 0/, 'a member with no row is at level 0');
  assert.equal(await entryProblem('g', { minLevel: 0, minVoiceLevel: 0 }, 'low'), null, 'a preset that asks for nothing');
  assert.match(await entryProblem('g', { minLevel: 0, minVoiceLevel: 5 }, 'mid'), /voice level \*\*5\*\* \(you are at 3\)/);

  // The text the giveaway shows.
  const text = buildPresetText(preset);
  assert.ok(text.includes('<@&r1> — +2 entries') && text.includes('Needs message level 5') && text.includes('Level 50+ — +4 entries') && text.includes('Voice level 20+ — +2 entries'));
  assert.equal(buildPresetText([]), '');

  // A bigger weight wins more often.
  let highWins = 0;
  for (let i = 0; i < 2000; i += 1) if (weightedDraw([{ userId: 'high', weight: 7 }, { userId: 'low', weight: 1 }], 1)[0] === 'high') highWins += 1;
  assert.ok(highWins > 1500 && highWins < 1900, `a weight of 7 against 1 wins about 87% of the draws (${highWins})`);
  console.log('Checked the giveaways with levels: the extra entries, the level to enter and the weights.');
})().catch((error) => { console.error(error); process.exit(1); });
