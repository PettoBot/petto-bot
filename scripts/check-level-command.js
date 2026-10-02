// Checks that the new /level options can be typed with the prefix as well (`!level rules min_chars 5`): the prefix reads
// the options by position, so their order matters, and the values of the rules are read and limited. The database and
// the modules the command pulls in are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
for (const file of ['src/db/guilds.js', 'src/db/levelConfig.js', 'src/db/levelUsers.js', 'src/db/levelRewards.js', 'src/db/levelMultipliers.js', 'src/utils/levelActions.js', 'src/utils/caseCard.js', 'src/utils/emojis.js', 'src/db/embedTemplates.js', 'src/db/imageCards.js', 'src/db/xpEvents.js', 'src/utils/roleResolve.js', 'src/utils/userResolve.js']) stub(file, {});
stub('src/utils/emojis.js', { EMOJI: {} });
const command = require('../src/commands/leveling/level.js');
const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');

const message = {
  guild: { id: '1', channels: { cache: new Collection() }, roles: { cache: new Collection() }, members: { cache: new Collection() } },
  author: { id: '2' }, member: { id: '2' }, channel: { id: '3' }, client: {}, content: '',
};
const parse = async (text) => buildInteractionFromMessage(message, command, text);

(async () => {
  assert.equal(command.data.toJSON().options.length <= 25, true, '/level stays within the 25 options Discord allows');

  let i = await parse('rank-style both myrank');
  assert.equal(i.options.getSubcommand(), 'rank-style'); assert.equal(i.options.getString('style'), 'both'); assert.equal(i.options.getString('card'), 'myrank');

  i = await parse('rules min_chars 5');
  assert.equal(i.options.getSubcommand(), 'rules'); assert.equal(i.options.getString('setting'), 'min_chars'); assert.equal(i.options.getString('value'), '5');
  i = await parse('rules anti_repeat off');
  assert.equal(i.options.getString('setting'), 'anti_repeat'); assert.equal(i.options.getString('value'), 'off');
  i = await parse('rules');
  assert.equal(i.options.getString('setting'), null, 'with nothing typed the rules are only shown');

  i = await parse('event add "Double XP" 2 2h voice 1h');
  assert.equal(i.options.getSubcommandGroup(), 'event'); assert.equal(i.options.getSubcommand(), 'add');
  assert.equal(i.options.getString('name'), 'Double XP'); assert.equal(i.options.getNumber('multiplier'), 2); assert.equal(i.options.getString('duration'), '2h');
  assert.equal(i.options.getString('applies_to'), 'voice'); assert.equal(i.options.getString('starts_in'), '1h');
  i = await parse('event remove 3');
  assert.equal(i.options.getInteger('id'), 3);
  i = await parse('event list');
  assert.equal(i.options.getSubcommand(), 'list');

  // The order of the options of notify did not change when `card` was added: message is still the sixth, card the seventh.
  const notify = command.data.toJSON().options.find((option) => option.name === 'notify').options.map((option) => option.name);
  assert.deepEqual(notify, ['mode', 'channel', 'embed', 'embed_template', 'every', 'message', 'card']);
  const voiceNotify = command.data.toJSON().options.find((option) => option.name === 'voice-notify').options.map((option) => option.name);
  assert.deepEqual(voiceNotify, ['mode', 'channel', 'embed', 'embed_template', 'every', 'message', 'card']);

  const { readRuleValue, RULE_SETTINGS } = command;
  assert.equal(readRuleValue(RULE_SETTINGS.min_chars, '5'), 5);
  assert.equal(readRuleValue(RULE_SETTINGS.min_chars, '0'), 0);
  assert.equal(readRuleValue(RULE_SETTINGS.min_chars, '201'), null, 'over the range');
  assert.equal(readRuleValue(RULE_SETTINGS.min_chars, '-1'), null);
  assert.equal(readRuleValue(RULE_SETTINGS.min_chars, '2.5'), null, 'whole numbers only');
  assert.equal(readRuleValue(RULE_SETTINGS.voice_min_members, '0'), null, 'at least one person');
  assert.equal(readRuleValue(RULE_SETTINGS.anti_repeat, 'OFF'), false);
  assert.equal(readRuleValue(RULE_SETTINGS.anti_repeat, 'on'), true);
  assert.equal(readRuleValue(RULE_SETTINGS.anti_repeat, 'maybe'), null);
  assert.equal(readRuleValue(RULE_SETTINGS.daily_bonus, ''), null);
  console.log('Checked that /level rules, rank-style and event work with the prefix, and the order of the notify options.');
})().catch((error) => { console.error(error); process.exit(1); });
