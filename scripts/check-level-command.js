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
const sentTests = [];
let testConfig = { notify_mode: 'channel', notify_channel_id: '777', notify_every: 5, notify_delete_after: 60, max_level: 1000, voice_notify_mode: 'dm' };
let testUser = { level: 4, voice_level: 9 };
stub('src/db/guilds.js', { ensureGuild: async () => ({}) });
stub('src/db/levelConfig.js', { ensureConfig: async () => testConfig });
stub('src/db/levelUsers.js', { getUser: async () => testUser });
stub('src/utils/levelActions.js', { notifyLevelUp: async (options) => { sentTests.push(options); } });
stub('src/utils/caseCard.js', { textCard: (text) => ({ text }) });
stub('src/utils/emojis.js', { EMOJI: {} });
stub('src/utils/roleResolve.js', { resolveRole: (guild, token) => ({ id: String(token).replace(/\D/g, '') || '1' }) });
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

  // The new options of the second round, as they are typed with the prefix (the ones that are not the first go with --).
  i = await parse('notify reply --delete_after 30 --ping false');
  assert.equal(i.options.getSubcommand(), 'notify'); assert.equal(i.options.getString('mode'), 'reply');
  assert.equal(i.options.getInteger('delete_after'), 30); assert.equal(i.options.getBoolean('ping'), false);
  i = await parse('notify reply --milestone 50 --message "Level 50, {user}!"');
  assert.equal(i.options.getInteger('milestone'), 50); assert.equal(i.options.getString('message'), 'Level 50, {user}!');
  i = await parse('reward add 5 <@&123456789012345678> --type voice');
  assert.equal(i.options.getSubcommandGroup(), 'reward'); assert.equal(i.options.getString('type'), 'voice'); assert.equal(i.options.getInteger('level'), 5);
  i = await parse('rules xp_multiplier 1.5');
  assert.equal(i.options.getString('setting'), 'xp_multiplier'); assert.equal(i.options.getString('value'), '1.5');

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
  assert.deepEqual(notify, ['mode', 'channel', 'embed', 'embed_template', 'every', 'message', 'card', 'reply', 'delete_after', 'ping', 'milestone']);
  const voiceNotify = command.data.toJSON().options.find((option) => option.name === 'voice-notify').options.map((option) => option.name);
  assert.deepEqual(voiceNotify, ['mode', 'channel', 'embed', 'embed_template', 'every', 'message', 'card', 'delete_after', 'ping', 'milestone']);

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
  // A choice that does not exist is told with the valid ones (it used to reach the database as it was: `!xpn test` saved "test" as the mode and ended in a generic error).
  for (const bad of ['notify tets', 'voice-notify maybe', 'rank-style fancy']) {
    await assert.rejects(() => parse(bad), (error) => error.userFacing === true && /not one of the choices/.test(error.message) && /`/.test(error.message), `${bad} is refused with the valid choices`);
  }
  await assert.rejects(() => parse('notify tets'), (error) => /`off`, `reply`, `channel`, `dm`, `test`/.test(error.message), 'and says which ones');
  i = await parse('notify OFF');
  assert.equal(i.options.getString('mode'), 'off', 'the case does not count and the value is what the command gets');
  i = await parse('rank-style Both');
  assert.equal(i.options.getString('style'), 'both');
  i = await parse('notify test');
  assert.equal(i.options.getString('mode'), 'test', 'test is one of the modes of notify');
  assert.equal(parse('voice-notify test') instanceof Promise, true);

  // `notify test` sends the announcement of the next level to the member as the settings say, saves nothing and is not hidden by "every N levels".
  const answers = [];
  const fakeInteraction = (mode, sub = 'notify') => ({
    guild: { id: '1' }, user: { id: '2' }, member: { id: '2', user: { id: '2' } }, channel: { id: '3' }, client: { c: 1 }, options: {
      getSubcommand: () => sub, getSubcommandGroup: () => null, getString: (name) => (name === 'mode' ? mode : null), getChannel: () => null, getBoolean: () => null, getInteger: () => null,
    },
    deferReply: async () => {}, editReply: async (payload) => { answers.push(payload); }, reply: async (payload) => { answers.push(payload); },
  });
  await command.execute({ ...fakeInteraction('test'), pettoLang: 'en' });
  assert.equal(sentTests.length, 1, 'one test announcement');
  assert.equal(sentTests[0].level, 5, 'the next level of the member');
  assert.equal(sentTests[0].config.notify_every, 1, 'every N levels does not hide it');
  assert.equal(sentTests[0].config.notify_delete_after, 0, 'and it is not deleted');
  assert.equal(sentTests[0].source, 'text');
  assert.match(JSON.stringify(answers.at(-1)), /level \*\*5\*\*/);
  assert.match(JSON.stringify(answers.at(-1)), /<#777>/, 'it says where it went');
  await command.execute({ ...fakeInteraction('test', 'voice-notify'), pettoLang: 'en' });
  assert.equal(sentTests.at(-1).level, 10, 'the voice level is the voice one');
  assert.equal(sentTests.at(-1).source, 'voice');
  assert.match(JSON.stringify(answers.at(-1)), /direct messages/, 'a DM setting says so');
  testConfig = { ...testConfig, notify_mode: 'off' };
  const before = sentTests.length;
  await command.execute({ ...fakeInteraction('test'), pettoLang: 'en' });
  assert.equal(sentTests.length, before, 'with the announcements off nothing is sent');
  assert.match(JSON.stringify(answers.at(-1)), /off, so there is nothing to test/);

  console.log('Checked that /level rules, rank-style and event work with the prefix, and the order of the notify options.');
})().catch((error) => { console.error(error); process.exit(1); });
