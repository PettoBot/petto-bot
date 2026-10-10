// The default Components V2 look of a sanction: reply, member DM and log entry.
const assert = require('node:assert/strict');
const path = require('node:path');

const sent = [];
const enginePath = path.resolve(__dirname, '../src/logging/engine.js');
require.cache[enginePath] = { id: enginePath, filename: enginePath, loaded: true, exports: { sendLog: async (...args) => { sent.push(args); }, getAvatar: () => null } };
const templatesPath = path.resolve(__dirname, '../src/utils/sanctionTemplates.js');
require.cache[templatesPath] = { id: templatesPath, filename: templatesPath, loaded: true, exports: { sanctionLogEmbed: async () => null, previousSanctions: async () => 2 } };

const { buildSanctionCard, sanctionPayload } = require('../src/utils/sanctionDesign');
const { buildSanctionDM } = require('../src/utils/sanctionMessage');
const { logSanction } = require('../src/utils/caseLog');
const { TYPE_EMOJI } = require('../src/utils/emojis');

const user = { id: '111', username: 'rule_breaker', displayAvatarURL: () => 'https://cdn.example/a.png' };
const mod = { id: '222', username: 'mod' };
const guild = { id: '1', name: 'Test Server', memberCount: 42, iconURL: () => 'https://cdn.example/g.png' };
const text = (card) => JSON.stringify(card.toJSON());

(async () => {
  const types = ['ban', 'hardban', 'tempban', 'softban', 'unban', 'kick', 'mute', 'tempmute', 'unmute', 'warn', 'jail', 'unjail'];
  for (const type of types) {
    assert.match(TYPE_EMOJI[type], /^<:pe_(user_|ban_|tempban|mute|unmute)/, `${type} has its own person icon`);
    const json = buildSanctionCard({ type, caseNumber: 7, guild, target: user, moderator: mod, reason: 'spam', previous: 0 }).toJSON();
    assert.equal(json.type, 17, `${type} is a container`);
    assert.ok(JSON.stringify(json).includes('Case #7'));
  }

  const tempban = text(buildSanctionCard({ type: 'tempban', caseNumber: 8, guild, target: user, moderator: mod, reason: 'x', duration: '2 days', expiresAt: new Date(Date.now() + 172800000), previous: 3 }));
  assert.ok(tempban.includes('Ends') && tempban.includes('<t:'), 'a timed sanction shows when it ends');
  assert.ok(tempban.includes('3 earlier sanctions'));
  assert.ok(text(buildSanctionCard({ type: 'ban', caseNumber: 1, guild, target: user, moderator: mod })).includes('Permanent'), 'a ban is permanent');
  assert.ok(text(buildSanctionCard({ type: 'ban', caseNumber: 1, guild, target: user, moderator: mod, previous: 0 })).includes('First sanction'));
  assert.ok(text(buildSanctionCard({ type: 'ban', caseNumber: 1, guild, target: user, moderator: mod, reason: 'a'.repeat(5000) })).length < 4000, 'a long reason is cut');

  const dm = buildSanctionDM({ type: 'hardban', guild, moderator: mod, reason: 'evasion', caseNumber: 9 });
  assert.equal(dm.flags, 32768);
  const dmText = JSON.stringify(dm.components[0].toJSON());
  assert.ok(dmText.includes('permanently banned from') && dmText.includes('Test Server') && !dmText.includes('111'), 'the DM talks to the member and hides ids');
  assert.deepEqual(sanctionPayload({ type: 'warn', guild, target: user, moderator: mod }).allowedMentions, { parse: [] });

  await logSanction({}, guild, { modCase: { type: 'kick', case_number: 5, expires_at: null }, target: user, moderator: mod, reason: 'r' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][2], 'sanctions');
  assert.equal(sent[0][3], null, 'no embed');
  assert.equal(sent[0][4].v2.length, 1, 'the log entry is a V2 card');
  console.log('sanction design checks passed');
})();
