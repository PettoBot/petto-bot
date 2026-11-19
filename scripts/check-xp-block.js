// Checks the members blocked from XP: the helpers, that a blocked member earns none (messages, voice, the starting bonus), that nobody can give them XP
// or a level by hand (`/levels manage xp` and `level`, also as the destination of a transfer), and the command that blocks and lets out. The database and
// Discord are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection } = require('discord.js');

process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCLOUD_DATABASE_URL ??= 'postgres://check:check@127.0.0.1:1/check'; // never connected to

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const saved = []; const written = []; const replies = [];
let config = { guild_id: '1', no_xp_user_ids: [] };
stub('src/db/guilds.js', { ensureGuild: async () => ({}) });
stub('src/db/levelConfig.js', { ensureConfig: async () => config, getConfig: async () => config, upsertConfig: async (guildId, patch) => { saved.push(patch); config = { ...config, ...patch }; return config; } });
stub('src/db/levelUsers.js', { ensureUser: async () => ({ xp: 100, level: 1 }), getUser: async () => null, setXpAndLevel: async (...args) => { written.push(args); } });
for (const file of ['src/db/levelRewards.js', 'src/db/levelMultipliers.js', 'src/db/embedTemplates.js', 'src/db/imageCards.js', 'src/db/xpEvents.js', 'src/utils/userResolve.js', 'src/utils/roleResolve.js']) stub(file, {});
stub('src/utils/levelActions.js', { stripRewardRoles: async () => {}, notifyLevelUp: async () => {} });
stub('src/utils/levelSync.js', { runSync: async () => ({}), kindsOf: () => ['roles'] });
stub('src/utils/caseCard.js', { textCard: (text) => ({ text }) });
stub('src/utils/emojis.js', { EMOJI: { APPROVE: 'OK', DENY: 'NO', ALERT: '!' } });

const { MAX_BLOCKED, blockedIds, isXpBlocked, firstBlocked, toggleBlocked } = require('../src/utils/xpBlock');
const command = require('../src/commands/leveling/level.js');

(async () => {
  // The helpers.
  assert.deepEqual(blockedIds(null), []); assert.deepEqual(blockedIds({ no_xp_user_ids: ['1', 2] }), ['1', '2']);
  assert.equal(isXpBlocked({ no_xp_user_ids: ['9'] }, '9'), true); assert.equal(isXpBlocked({ no_xp_user_ids: ['9'] }, '8'), false);
  assert.equal(isXpBlocked({ no_xp_user_ids: ['9'] }, undefined), false, 'a missing id is never blocked'); assert.equal(isXpBlocked({}, '9'), false);
  assert.equal(firstBlocked({ no_xp_user_ids: ['9'] }, ['1', null, '9']), '9'); assert.equal(firstBlocked({ no_xp_user_ids: ['9'] }, ['1', null]), null);
  let toggled = toggleBlocked({ no_xp_user_ids: ['1'] }, '2');
  assert.deepEqual([toggled.list, toggled.blocked, toggled.full], [['1', '2'], true, false], 'a member is added');
  toggled = toggleBlocked({ no_xp_user_ids: ['1', '2'] }, '1');
  assert.deepEqual([toggled.list, toggled.blocked, toggled.full], [['2'], false, false], 'a blocked member is let out');
  const crowd = { no_xp_user_ids: Array.from({ length: MAX_BLOCKED }, (_, i) => String(1000 + i)) };
  toggled = toggleBlocked(crowd, '5');
  assert.deepEqual([toggled.list.length, toggled.blocked, toggled.full], [MAX_BLOCKED, false, true], 'a full list takes nobody else');
  assert.equal(toggleBlocked(crowd, '1000').list.length, MAX_BLOCKED - 1, 'but lets one out');

  // Who earns XP by themselves: the real rule, with the settings of the messages and the voice.
  for (const file of ['src/utils/levelActions.js']) delete require.cache[require.resolve(path.join(__dirname, '..', file))];
  for (const file of ['src/db/levelUsers.js', 'src/db/levelRewards.js', 'src/db/levelMultipliers.js', 'src/db/embedTemplates.js']) stub(file, {});
  stub('src/utils/deadRoles.js', { isGone: () => false, reportDeadRoles: async () => {} });
  stub('src/utils/cardService.js', { renderRankCard: async () => null, CARD_FILE_NAME: 'card.png' });
  const { canEarnXp } = require('../src/utils/levelActions');
  const { getVoiceConfig } = require('../src/utils/levelSource');
  const member = (id) => ({ id, roles: { cache: new Map() } });
  const channel = { id: 'c', parentId: null };
  const blockedConfig = { no_xp_user_ids: ['9'] };
  assert.equal(canEarnXp({ member: member('9'), channel, config: blockedConfig }), false, 'a blocked member earns no XP for messages');
  assert.equal(canEarnXp({ member: member('8'), channel, config: blockedConfig }), true, 'the others do');
  assert.equal(canEarnXp({ member: { user: { id: '9' }, roles: { cache: new Map() } }, channel, config: blockedConfig }), false, 'it also finds the id inside the user');
  assert.equal(canEarnXp({ member: member('9'), channel, config: getVoiceConfig(blockedConfig) }), false, 'nor for voice (the voice settings carry the list)');
  assert.equal(canEarnXp({ member: member('9'), channel, config: {} }), true, 'a server with nobody blocked works as before');

  // The command.
  const optionsOf = (group, sub, values) => ({ getSubcommandGroup: () => group, getSubcommand: () => sub, getUser: (name) => values[name] ?? null, getString: (name) => values[name] ?? null, getInteger: (name) => values[name] ?? null });
  const run = async (group, sub, values) => {
    replies.length = 0;
    const interaction = {
      guild: { id: '1' }, user: { id: 'staff' }, locale: 'en-US', options: optionsOf(group, sub, values),
      deferReply: async () => {}, editReply: async (payload) => { replies.push(JSON.stringify(payload)); }, reply: async (payload) => { replies.push(JSON.stringify(payload)); }, deferred: true, replied: false,
    };
    await command.execute(interaction);
    return replies.join(' ');
  };
  const alegis = { id: '9', bot: false, toString: () => '<@9>' };
  const other = { id: '8', bot: false, toString: () => '<@8>' };

  let text = await run('manage', 'block', {});
  assert.match(text, /Nobody is blocked/, 'with nobody, it says so');
  text = await run('manage', 'block', { user: alegis });
  assert.deepEqual(config.no_xp_user_ids, ['9']); assert.match(text, /can no longer earn XP/);
  text = await run('manage', 'block', {});
  assert.match(text, /Blocked from XP \(1\)/); assert.match(text, /<@9>/);
  text = await run('manage', 'block', { user: { id: '7', bot: true, toString: () => '<@7>' } });
  assert.deepEqual(config.no_xp_user_ids, ['9'], 'a bot is not added'); assert.match(text, /never earns XP/);

  written.length = 0;
  text = await run('manage', 'xp', { action: 'add', user: alegis, amount: 50 });
  assert.equal(written.length, 0, 'no XP is given by hand to a blocked member'); assert.match(text, /blocked from XP/);
  text = await run('manage', 'xp', { action: 'transfer', user: other, target: alegis, amount: 10 });
  assert.equal(written.length, 0, 'nor as the destination of a transfer'); assert.match(text, /blocked from XP/);
  text = await run('manage', 'xp', { action: 'transfer', user: alegis, target: other, amount: 10 });
  assert.equal(written.length, 0, 'nor taken from a blocked member to give to another');
  text = await run('manage', 'level', { action: 'add', user: alegis, amount: 2 });
  assert.equal(written.length, 0, 'nor a level'); assert.match(text, /blocked from XP/);
  text = await run('manage', 'xp', { action: 'add', user: other, amount: 50 });
  assert.equal(written.length, 1, 'anybody else still gets it'); assert.deepEqual([written[0][1], written[0][2]], ['8', 150]);

  text = await run('manage', 'block', { user: alegis });
  assert.deepEqual(config.no_xp_user_ids, [], 'the same command lets the member out'); assert.match(text, /can earn XP again/);
  written.length = 0;
  await run('manage', 'xp', { action: 'add', user: alegis, amount: 50 });
  assert.equal(written.length, 1, 'and then XP can be given by hand again');

  // The slash command carries the new subcommand and stays inside what Discord allows.
  const json = command.data.toJSON();
  assert.equal(json.options.length <= 25, true);
  const manage = json.options.find((option) => option.name === 'manage');
  assert.ok(manage.options.some((option) => option.name === 'block' && option.options.every((o) => !o.required)), 'block is in manage and needs no member to list');
  console.log('Checked the members blocked from XP: the list, who earns, what can be given by hand and the command.');
})().catch((error) => { console.error(error); process.exit(1); });
