// Checks the umbrella commands /server and /user (src/commands/info/server.js, user.js, utils/umbrella.js):
//   - every subcommand exists, takes the options of the command it wraps and runs that command's own code, with the slash command and with
//     the prefix (`!server info`, `!server`, `!user`, `!user avatar @x`), and the old commands (`!serverinfo`, `!si`, `!avatar`...) still work;
//   - the new ones (the icon, banner and invite splash of a server) answer with a card, or say the server has none;
//   - the rules of a server reach them: a rule (or a restriction, or a permission level) of the wrapped command also stops the subcommand,
//     the name of the umbrella stops all of it, `servericon` stops that one only, in the same way for the slash command and the prefix;
//   - the descriptions are translated for Discord (Spanish and Portuguese), the short aliases are in the table, and the number and size of
//     the slash commands stay inside what Discord allows.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ApplicationCommandOptionType, MessageFlags, PermissionFlagsBits, PermissionsBitField } = require('discord.js');

const root = path.join(__dirname, '..');
function stub(relative, exports) {
  const resolved = require.resolve(path.join(root, relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
/** The real module with some of its functions replaced (the others are needed by the commands that load with it). */
function patch(relative, overrides) {
  return Object.assign(require(path.join(root, relative)), overrides);
}

// What the server has set: rules, role restrictions and permission levels, in memory.
let rules = []; // { command, channel_id }
let restrictions = {}; // command -> role ids
let levelDenied = new Set(); // commands whose permission level the member does not meet
const guildRow = { prefix: '!', prefixes: ['!', 'petto', ','] };
stub('src/db/database.js', { from: () => ({}) });
patch('src/db/guilds.js', { ensureGuild: async () => guildRow });
patch('src/db/commandAliases.js', { get: async () => null });
patch('src/db/customCommands.js', { getCommand: async () => null });
patch('src/db/disabledCommands.js', { findCached: async (guildId, command, channelId) => rules.find((row) => row.command === command && (row.channel_id === null || row.channel_id === channelId)) ?? null, canonicalizeStored: async () => 0 });
patch('src/db/commandRestrictions.js', { restrictionMap: async () => restrictions });
patch('src/db/permissions.js', { hasCommandPermission: async (guildId, command) => !levelDenied.has(command) });
patch('src/utils/sharedCooldown.js', { getRemainingCooldownShared: async () => 0 });
patch('src/utils/userPrefixAccess.js', { activeUserPrefix: async () => null });
patch('src/utils/codeTriggers.js', { findTrigger: async () => null });
patch('src/utils/codeCommands.js', { runCodeCommand: async () => true });
patch('src/logging/extraLog.js', { logCommandUse() {} });
patch('src/utils/cardService.js', { plainMessage: async (text) => ({ content: text }) });
patch('src/utils/logger.js', { info() {}, warn() {}, error() {} });

const { loadCommands, collectCommandData } = require('../src/handlers/commandHandler');
const event = require('../src/events/messageCreateCommands');
const interactionCreate = require('../src/events/interactionCreate');
const commandRules = require('../src/utils/commandRules');
const { CATALOGS } = require('../src/i18n');
const { shortAliasRoutes, SHORT_ALIAS_TABLE } = require('../src/utils/shortAliases');
const { isCommonWord } = require('../src/utils/commonWords');

const client = { user: { id: '123' }, users: { fetch: async (id) => ({ id, username: `user${id.slice(-3)}` }) } };
loadCommands(client);
const server = client.commands.get('server');
const user = client.commands.get('user');
const infoFile = (name) => path.join(root, 'src', 'commands', 'info', `${name}.js`);

// What each subcommand of each umbrella wraps (`file` of the old command), and the new ones that have a function of their own.
const SERVER = { info: 'serverinfo', roles: 'roles', channels: 'channels', emojis: 'emojis', boosters: 'boosters', channel: 'channelinfo', role: 'roleinfo', emoji: 'emojiinfo', invite: 'inviteinfo' };
const SERVER_NEW = { icon: 'servericon', banner: 'serverbanner', splash: 'serversplash' };
const USER = { info: 'userinfo', avatar: 'avatar', banner: 'banner', cosmetics: 'usercosmetics', permissions: 'permissions', id: 'snowflake', 'first-message': 'firstmessage', activity: 'activity' };
const subcommandsOf = (command) => command.data.toJSON().options;

const GUILD = '444444444444444444';
const ROOM = '666666666666666666';
const OTHER_ROOM = '666666666666666667';
const ANA = '111111111111111111';
const BEA = '222222222222222222';

/** Replaces `execute` of the wrapped commands with a spy that records what it was asked, the way the real one reads it. */
const calls = [];
const REQUIRED = { roleinfo: ['role'], inviteinfo: ['code'], emojiinfo: ['emoji'], snowflake: ['id'] };
const originals = new Map();
function spyOnWrapped() {
  for (const file of new Set([...Object.values(SERVER), ...Object.values(USER)])) {
    const module = require(infoFile(file));
    originals.set(file, module.execute);
    module.execute = async (interaction) => {
      // A required option is read as the real command reads it, so a missing one stops the command (the person is told how to write it).
      const required = REQUIRED[file] ?? [];
      const read = (method, name) => interaction.options[method](name, required.includes(name));
      const entry = { file, user: read('getUser', 'user')?.id ?? null, channel: read('getChannel', 'channel')?.id ?? null, role: read('getRole', 'role')?.id ?? null };
      for (const name of ['server', 'code', 'emoji', 'id']) { const value = read('getString', name); if (value !== null) entry[name] = value; }
      calls.push({ ...entry, interaction });
    };
  }
}
const restoreWrapped = () => { for (const [file, execute] of originals) require(infoFile(file)).execute = execute; originals.clear(); };

// ---------------------------------------------------------------- the slash command, through the real handler
let seq = 0;
/** `/server <sub>` or `/user <sub>` through interactionCreate: `{ replies, ran }` (`ran`: the file of the wrapped command that was called). */
async function slash(commandName, sub, { values = {}, channelId = ROOM, roles = [], admin = false, guild = {} } = {}) {
  seq += 1;
  const replies = [];
  const before = calls.length;
  const pick = (name) => values[name] ?? null;
  const base = {
    id: `7777777777777777${String(10 + seq)}`, commandName, commandType: 1, user: { id: String(BigInt(ANA) + BigInt(seq)), username: 'Ana' },
    guild: { id: GUILD, ownerId: '1', name: 'Petto Test', icon: null, banner: null, splash: null, ...guild }, guildId: GUILD, channelId, channel: { id: channelId },
    member: { id: ANA, guild: { ownerId: '1' }, permissions: new PermissionsBitField(admin ? PermissionsBitField.Flags.Administrator : 0n), roles: { cache: { has: (id) => roles.includes(id) } } },
    locale: 'en-US', pettoLang: 'en', client,
    options: {
      getSubcommand: () => sub, getSubcommandGroup: () => null,
      getUser: (name) => (pick(name) ? { id: pick(name) } : null), getChannel: (name) => (pick(name) ? { id: pick(name) } : null), getRole: (name) => (pick(name) ? { id: pick(name) } : null),
      getString: (name) => pick(name),
    },
    deferred: false, replied: false,
    isChatInputCommand: () => true,
    reply: async (payload) => { replies.push({ how: 'reply', payload }); return {}; },
    deferReply: async () => { replies.push({ how: 'defer' }); },
    editReply: async (payload) => { replies.push({ how: 'edit', payload }); },
  };
  const interaction = new Proxy(base, { get: (target, key) => (key in target ? target[key] : (typeof key === 'string' && /^is[A-Z]/.test(key) ? () => false : undefined)) });
  await interactionCreate.execute(interaction, client);
  const called = calls.slice(before);
  return { replies, called, ran: called[0]?.file ?? null, interaction };
}
const text = (payload) => JSON.stringify((payload.components ?? []).map((component) => component.toJSON?.() ?? component)) + (payload.content ?? '');
const ephemeral = (reply) => reply?.how === 'reply' && (reply.payload.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral;

// ---------------------------------------------------------------- the prefix, through the real message handler
let n = 0;
/** A message such as `!server info`: `{ ran, sent, call }` (the wrapped commands called, what was answered, the first call with its options). */
async function send(content, { channelId = '5', admin = false, mentions = [], guild = {} } = {}) {
  const sent = [];
  const before = calls.length;
  const message = {
    content, author: { id: ANA, bot: false }, guild: { id: `7${n++}`, name: 'Petto Test', members: { cache: new Map(), fetch: async () => new Map() }, channels: { cache: new Map() }, ...guild }, client,
    member: { permissions: { has: (flag) => (admin ? true : flag !== PermissionFlagsBits.Administrator) }, roles: { cache: new Map() }, id: ANA },
    mentions: { users: new Map(mentions.map((id) => [id, { id }])), roles: new Map(), channels: new Map(), members: new Map() }, attachments: new Map(), reference: null,
    channel: { id: channelId, sendTyping: async () => {}, send: async (payload) => { sent.push(text(payload)); return {}; } },
    reply: async (payload) => { sent.push(text(payload)); return { delete: async () => {}, edit: async () => {} }; },
  };
  event.setCachedPrefix(message.guild.id, guildRow.prefixes);
  await event.execute(message);
  const done = calls.slice(before);
  return { ran: done.map((call) => call.file), sent, call: done[0] ?? null, message };
}

(async () => {
  // ------------------------------------------------------------ the two commands exist, in the info category, once, with the right subcommands
  assert.ok(server && user, '/server and /user are loaded');
  for (const command of [server, user]) {
    assert.equal(command.category, 'info', `${command.data.name} is listed with the info commands in !help`);
    assert.ok(!command.hiddenFromHelp && !command.slashOnly && !command.prefixOnly, `${command.data.name} is a prefix and a slash command, shown in !help`);
    assert.equal(command.registerSlash, true);
    assert.equal(command.rulesBySubcommand, true);
    assert.equal(command.prefixDefaultSubcommand, 'info', `${command.data.name} alone is its info`);
    assert.equal(command.data.toJSON().dm_permission, false);
    assert.equal(command.data.toJSON().default_member_permissions ?? null, null, `${command.data.name} is for everyone, like the commands it wraps`);
  }
  assert.deepEqual(subcommandsOf(server).map((sub) => sub.name), ['info', 'icon', 'banner', 'splash', 'roles', 'channels', 'emojis', 'boosters', 'channel', 'role', 'emoji', 'invite']);
  assert.deepEqual(subcommandsOf(user).map((sub) => sub.name), ['info', 'avatar', 'banner', 'cosmetics', 'permissions', 'id', 'first-message', 'activity']);
  assert.ok(subcommandsOf(server).every((sub) => sub.type === ApplicationCommandOptionType.Subcommand) && subcommandsOf(user).every((sub) => sub.type === ApplicationCommandOptionType.Subcommand));
  assert.equal(client.commands.has('server') && client.commandAliases.has('server'), false, '`server` is the command now, no longer a word of serverinfo');
  assert.equal(client.commandAliases.get('si'), 'serverinfo', '`!si` is still serverinfo');
  assert.equal(client.commandAliases.get('ui'), 'userinfo');
  assert.equal(client.commandAliases.get('whois'), 'userinfo');
  assert.equal(client.commandAliases.get('av'), 'avatar');
  assert.equal(client.commandAliases.get('id'), 'snowflake');

  // Each subcommand that wraps a command has its description and its options, with the same names, types and required flags.
  const shape = (options) => (options ?? []).map((option) => [option.name, option.type, Boolean(option.required), option.description, option.channel_types ?? null]);
  for (const [umbrella, map] of [[server, SERVER], [user, USER]]) {
    for (const [name, file] of Object.entries(map)) {
      const sub = subcommandsOf(umbrella).find((each) => each.name === name);
      const wrapped = require(infoFile(file)).data.toJSON();
      const node = file === 'activity' ? wrapped.options.find((option) => option.name === 'view') : wrapped;
      assert.equal(sub.description, node.description, `${umbrella.data.name} ${name} describes itself like ${file}`);
      assert.deepEqual(shape(sub.options), shape(node.options), `${umbrella.data.name} ${name} takes the options of ${file}`);
    }
  }
  // The options that matter, written out.
  const optionsOf = (umbrella, name) => shape(subcommandsOf(umbrella).find((sub) => sub.name === name).options).map(([option, type, required]) => `${option}:${type}:${required}`);
  assert.deepEqual(optionsOf(server, 'info'), ['server:3:false']);
  assert.deepEqual(optionsOf(server, 'role'), ['role:8:true']);
  assert.deepEqual(optionsOf(server, 'invite'), ['code:3:true']);
  assert.deepEqual(optionsOf(user, 'avatar'), ['user:6:false'], 'a user option that is the person who ran it when left empty');
  assert.deepEqual(optionsOf(user, 'permissions'), ['user:6:false', 'channel:7:false']);
  assert.deepEqual(optionsOf(user, 'id'), ['id:3:true']);
  assert.deepEqual(optionsOf(user, 'activity'), ['user:6:false']);
  assert.deepEqual(optionsOf(server, 'icon'), [], 'the new subcommands are about this server and take nothing');

  // The keys of the rules: the wrapped command, or the key of a new subcommand.
  assert.deepEqual(server.ruleKeys, { ...SERVER, ...SERVER_NEW });
  assert.deepEqual(user.ruleKeys, USER);
  assert.equal(Object.keys(server.ruleKeys).length, 12);

  // ------------------------------------------------------------ the slash command runs the code of the old command, with its options
  spyOnWrapped();
  for (const [name, file] of Object.entries(SERVER)) {
    const result = await slash('server', name, { values: { server: '555555555555555555', channel: ROOM, role: '900000000000000001', code: 'abc', emoji: '<:a:123>' } });
    assert.equal(result.ran, file, `/server ${name} runs ${file}`);
    assert.equal(result.called[0].interaction, result.interaction, `/server ${name} is given the interaction as it came, with its options`);
  }
  const options = (await slash('server', 'info', { values: { server: '555555555555555555' } })).called[0];
  assert.equal(options.server, '555555555555555555', '/server info passes its server option');
  assert.equal((await slash('server', 'invite', { values: { code: 'discord-api' } })).called[0].code, 'discord-api');
  assert.equal((await slash('server', 'channel', { values: { channel: ROOM } })).called[0].channel, ROOM);
  assert.equal((await slash('server', 'role', { values: { role: '900000000000000001' } })).called[0].role, '900000000000000001');
  for (const [name, file] of Object.entries(USER)) {
    const result = await slash('user', name, { values: { user: BEA, channel: ROOM, id: '123456789012345678' } });
    assert.equal(result.ran, file, `/user ${name} runs ${file}`);
  }
  assert.equal((await slash('user', 'avatar', { values: { user: BEA } })).called[0].user, BEA, '/user avatar passes the member');
  assert.equal((await slash('user', 'avatar')).called[0].user, null, 'without a member the old command uses the person who ran it');
  assert.equal((await slash('user', 'id', { values: { id: '123456789012345678' } })).called[0].id, '123456789012345678');
  assert.equal((await slash('user', 'permissions', { values: { user: BEA, channel: ROOM } })).called[0].channel, ROOM);
  assert.equal((await slash('user', 'first-message', { values: { channel: ROOM } })).called[0].channel, ROOM);

  // ------------------------------------------------------------ the new ones: the picture of the server and its links
  restoreWrapped();
  const imageGuild = {
    icon: 'a_abc123', banner: 'bannerhash', splash: null,
    iconURL: ({ size = 128, extension = 'webp', forceStatic = false } = {}) => `https://cdn.discordapp.com/icons/${GUILD}/a_abc123.${!forceStatic ? 'gif' : extension}?size=${size}`,
    bannerURL: ({ size = 128, extension = 'webp' } = {}) => `https://cdn.discordapp.com/banners/${GUILD}/bannerhash.${extension}?size=${size}`,
    splashURL: () => null,
  };
  const icon = await slash('server', 'icon', { guild: imageGuild });
  assert.equal(icon.replies.length, 1);
  const iconJson = JSON.stringify(icon.replies[0].payload.components.map((component) => component.toJSON()));
  assert.ok(iconJson.includes('Icon of Petto Test'), 'the card has a title');
  assert.ok(iconJson.includes('.gif?size=1024'), 'the picture is shown at 1024 (a GIF when it moves)');
  for (const size of [128, 256, 512, 1024, 2048, 4096]) assert.ok(iconJson.includes(`size=${size})`), `a link in size ${size}`);
  assert.ok(iconJson.includes('Animated'), 'it says the icon moves');
  const buttons = icon.replies[0].payload.components[0].toJSON().components.find((component) => component.type === 1).components;
  assert.deepEqual(buttons.map((button) => button.label), ['Open original', 'PNG', 'JPG', 'WEBP'], 'the original and the still formats');
  assert.ok(buttons.every((button) => button.url.includes('size=4096')), 'the buttons are the biggest size');
  assert.ok(buttons[0].url.endsWith('.gif?size=4096') && buttons[1].url.includes('.png?size=4096'));
  const banner = await slash('server', 'banner', { guild: imageGuild });
  assert.ok(JSON.stringify(banner.replies[0].payload.components.map((component) => component.toJSON())).includes('Banner of Petto Test'));
  const splash = await slash('server', 'splash', { guild: imageGuild });
  assert.match(text(splash.replies[0].payload), /has no invite splash set/, 'a server with no splash is told so');
  const none = await slash('server', 'icon', { guild: { ...imageGuild, icon: null } });
  assert.match(text(none.replies[0].payload), /Petto Test has no icon set/);
  // The same in Spanish and Portuguese, from the catalogs.
  for (const key of ['icon.title', 'icon.none', 'banner.title', 'banner.none', 'splash.title', 'splash.none', 'sizes', 'animated']) {
    for (const lang of ['en', 'es', 'pt-BR']) assert.ok(CATALOGS[lang][`info.server.${key}`], `info.server.${key} in ${lang}`);
  }
  assert.notEqual(CATALOGS.es['info.server.icon.none'], CATALOGS.en['info.server.icon.none']);
  assert.notEqual(CATALOGS['pt-BR']['info.server.icon.none'], CATALOGS.en['info.server.icon.none']);

  // ------------------------------------------------------------ the prefix: the umbrellas and the old commands
  spyOnWrapped();
  const ran = async (content, opts) => (await send(content, opts)).ran;
  assert.deepEqual(await ran('!server info'), ['serverinfo']);
  assert.deepEqual(await ran('!server'), ['serverinfo'], '`!server` alone is what it always was');
  assert.deepEqual(await ran(',server'), ['serverinfo'], 'with another prefix too');
  let call = (await send('!server 555555555555555555')).call;
  assert.deepEqual([call.file, call.server], ['serverinfo', '555555555555555555'], '`!server <id>` is `!serverinfo <id>`');
  assert.deepEqual(await ran('!server roles'), ['roles']);
  assert.deepEqual(await ran('!server channels'), ['channels']);
  assert.deepEqual(await ran('!server emojis'), ['emojis']);
  assert.deepEqual(await ran('!server boosters'), ['boosters']);
  assert.deepEqual(await ran('!server rl'), ['roles'], 'a word that stands for a subcommand');
  assert.deepEqual(await ran('!server serverinfo'), ['serverinfo']);
  call = (await send('!server invite discord-api')).call;
  assert.deepEqual([call.file, call.code], ['inviteinfo', 'discord-api']);
  call = (await send('!server emoji <:a:123>')).call;
  assert.deepEqual([call.file, call.emoji], ['emojiinfo', '<:a:123>']);
  assert.deepEqual((await send('!server role')).ran, [], 'a required option that is missing is asked for, nothing runs');
  assert.ok((await send('!server role')).sent.length === 1, 'and the person is told how to write it');

  assert.deepEqual(await ran('!user'), ['userinfo'], '`!user` alone is the info of the person');
  call = (await send('!user', {})).call;
  assert.equal(call.user, null, 'with nobody named it is the author (the old command decides)');
  call = (await send(`!user <@${BEA}>`)).call;
  assert.deepEqual([call.file, call.user], ['userinfo', BEA], '`!user @x` is `!userinfo @x`');
  call = (await send('!user info 222222222222222222')).call;
  assert.deepEqual([call.file, call.user], ['userinfo', BEA]);
  call = (await send(`!user avatar <@${BEA}>`)).call;
  assert.deepEqual([call.file, call.user], ['avatar', BEA], '`!user avatar @x`');
  call = (await send(`!user pfp <@${BEA}>`)).call;
  assert.deepEqual([call.file, call.user], ['avatar', BEA], '`!user pfp @x`');
  assert.deepEqual(await ran('!user banner'), ['banner']);
  assert.deepEqual(await ran('!user cosmetics'), ['usercosmetics']);
  assert.deepEqual(await ran('!user permissions'), ['permissions']);
  assert.deepEqual(await ran('!user first-message'), ['firstmessage']);
  assert.deepEqual(await ran('!user activity'), ['activity']);
  call = (await send('!user id 123456789012345678')).call;
  assert.deepEqual([call.file, call.id], ['snowflake', '123456789012345678']);
  assert.deepEqual(await ran('!user sf 123456789012345678'), ['snowflake']);

  // The old commands and their words are untouched.
  for (const [content, file] of [['!serverinfo', 'serverinfo'], ['!si', 'serverinfo'], ['!userinfo', 'userinfo'], ['!ui', 'userinfo'], ['!whois', 'userinfo'], ['!avatar', 'avatar'], ['!av', 'avatar'], ['!pfp', 'avatar'],
    ['!banner', 'banner'], ['!usercosmetics', 'usercosmetics'], ['!uc', 'usercosmetics'], ['!roles', 'roles'], ['!channels', 'channels'], ['!emojis', 'emojis'], ['!boosters', 'boosters'],
    ['!permissions', 'permissions'], ['!perms', 'permissions'], ['!id 123456789012345678', 'snowflake'], ['!firstmessage', 'firstmessage'], ['!activity view', 'activity'],
    ['!inviteinfo abc', 'inviteinfo'], ['!ii abc', 'inviteinfo'], ['!ci', 'channelinfo']]) {
    assert.deepEqual(await ran(content), [file], `${content} still runs ${file}`);
  }
  // The routes `!servericon`, `!serverbanner`, `!serversplash` and the short aliases of the table.
  for (const word of ['servericon', 'serverbanner', 'serversplash']) {
    const route = client.commandRoutes.get(word);
    assert.deepEqual([route.command, route.args, route.disableName], ['server', [word.replace('server', '')], word], `!${word} is !server ${word.replace('server', '')}`);
  }
  for (const [target, alias] of Object.entries(Object.fromEntries(Object.entries(SHORT_ALIAS_TABLE).map(([word, to]) => [to, word])))) {
    if (!/^(server|user) /.test(target)) continue;
    const [command, sub] = target.split(' ');
    const route = client.commandRoutes.get(alias);
    assert.ok(route && route.short && route.command === command && route.subcommand === sub, `${alias} is the short alias of ${target}`);
  }
  const shortTargets = Object.values(SHORT_ALIAS_TABLE).filter((target) => /^(server|user) /.test(target));
  assert.equal(shortTargets.length, 20, 'every subcommand of /server (12) and /user (8) has a short alias');
  const shortServer = Object.keys(SHORT_ALIAS_TABLE).find((word) => SHORT_ALIAS_TABLE[word] === 'server roles');
  assert.deepEqual(await ran(`!${shortServer}`), ['roles'], 'a short alias runs the subcommand');
  assert.deepEqual(await ran('petto se'), [], 'a common word after a word prefix is chat, even when it is a short alias');
  assert.ok(isCommonWord('se'));
  assert.equal(await event.knownNameChecker(client, '1')('server'), true);
  assert.equal(await event.knownNameChecker(client, '1')('user'), true);
  const iconMessage = await send('!servericon', { guild: imageGuild });
  assert.equal(iconMessage.ran.length, 0);
  assert.ok(iconMessage.sent.join('').includes('Icon of Petto Test'), '!servericon shows the icon card');
  assert.ok((await send('!server banner', { guild: imageGuild })).sent.join('').includes('Banner of Petto Test'));
  assert.match((await send('!server splash', { guild: imageGuild })).sent.join(''), /no invite splash/);

  // ------------------------------------------------------------ the rules of a server
  // Which rule names a use has: the wrapped command first, then the umbrella.
  assert.deepEqual(commandRules.ruleNames(server, { subcommand: 'info' }), ['serverinfo', 'server']);
  assert.deepEqual(commandRules.ruleNames(server, { subcommand: 'channel' }), ['channelinfo', 'server']);
  assert.deepEqual(commandRules.ruleNames(server, { subcommand: 'icon' }), ['servericon', 'server']);
  assert.deepEqual(commandRules.ruleNames(server, { route: client.commandRoutes.get('servericon') }), ['servericon', 'server']);
  assert.deepEqual(commandRules.ruleNames(user, { subcommand: 'cosmetics' }), ['usercosmetics', 'user']);
  assert.deepEqual(commandRules.ruleNames(user, { subcommand: 'first-message' }), ['firstmessage', 'user']);
  assert.deepEqual(commandRules.ruleNames(user, { subcommand: 'activity' }), ['activity', 'user']);
  assert.deepEqual(commandRules.ruleNames(user, {}), ['user'], 'no subcommand: the umbrella');
  assert.deepEqual(commandRules.permissionNames(user, { subcommand: 'avatar' }), ['user', 'avatar']);
  assert.deepEqual(commandRules.permissionNames(server, { subcommand: 'icon' }), ['server', 'servericon']);
  assert.deepEqual(commandRules.permissionNames(client.commands.get('ban'), { subcommand: 'x' }), ['ban']);
  // What a prefix text reaches (words that stand for a subcommand, and the subcommand when none is typed).
  for (const [command, argText, expected] of [[server, '', 'info'], [server, 'info', 'info'], [server, '555555555555555555', 'info'], [server, 'rl', 'roles'], [server, 'icon', 'icon'], [server, 'invite x', 'invite'],
    [user, '', 'info'], [user, `<@${BEA}>`, 'info'], [user, 'pfp <@2>', 'avatar'], [user, 'fm', 'first-message'], [user, 'id 1', 'id'], [user, 'activity', 'activity']]) {
    assert.equal(commandRules.subcommandOfText(command, argText), expected, `${command.data.name} "${argText}" reaches ${expected}`);
  }
  assert.equal(commandRules.subcommandOfText(client.commands.get('ban'), ''), null);

  const refusedSlash = (result) => !result.ran && ephemeral(result.replies.find((reply) => reply.how === 'reply'));
  // A refusal of the prefix is one card that says why (`why`: what it says); nothing of the wrapped command ran.
  const refusedPrefix = (result, why = /turned off|disabled/i) => result.ran.length === 0 && result.sent.length === 1 && why.test(result.sent[0]);
  const NEEDS_ROLE = /900000000000000001|only members with/i;
  const NEEDS_LEVEL = /permission level|level/i;

  // A rule for the wrapped command stops the subcommand (slash and prefix), and only that one.
  rules = [{ command: 'serverinfo', channel_id: null }];
  let result = await slash('server', 'info');
  assert.ok(refusedSlash(result), '/server info is refused when serverinfo is turned off');
  assert.ok(text(result.replies[0].payload).includes('/server serverinfo'), 'the notice names the rule');
  assert.ok((await slash('server', 'roles')).ran === 'roles', '/server roles still runs');
  assert.ok((await slash('user', 'info')).ran === 'userinfo', 'and /user info');
  for (const content of ['!server', '!server info', '!server 555555555555555555', ',server']) assert.ok(refusedPrefix(await send(content)), `${content} is refused when serverinfo is turned off`);
  assert.match((await send('!server')).sent.join(''), /turned off|disabled/i);
  assert.deepEqual(await ran('!server roles'), ['roles']);
  assert.deepEqual(await ran('!serverinfo'), [], '!serverinfo itself is refused too (as before)');
  assert.deepEqual(await ran('!si'), []);

  rules = [{ command: 'avatar', channel_id: null }];
  assert.ok(refusedSlash(await slash('user', 'avatar')), '/user avatar is refused when avatar is turned off');
  assert.ok((await slash('user', 'banner')).ran === 'banner', '/user banner is not');
  for (const content of ['!user avatar', '!user pfp', '!user av']) assert.ok(refusedPrefix(await send(content)), `${content} is refused when avatar is turned off`);
  assert.deepEqual(await ran('!user'), ['userinfo'], '!user (the info) still runs');
  assert.deepEqual(await ran('!user banner'), ['banner']);

  rules = [{ command: 'userinfo', channel_id: null }];
  assert.ok(refusedSlash(await slash('user', 'info')));
  assert.ok(refusedPrefix(await send('!user')) && refusedPrefix(await send(`!user <@${BEA}>`)), '`!user` and `!user @x` are the info, so they are refused');
  assert.deepEqual(await ran('!user avatar'), ['avatar']);

  // The new subcommands have a key of their own.
  rules = [{ command: 'servericon', channel_id: null }];
  assert.ok(refusedSlash(await slash('server', 'icon', { guild: imageGuild })), '/server icon is refused when servericon is turned off');
  assert.match(text((await slash('server', 'banner', { guild: imageGuild })).replies[0].payload), /Banner of Petto Test/, '/server banner is not');
  const shortIcon = Object.keys(SHORT_ALIAS_TABLE).find((word) => SHORT_ALIAS_TABLE[word] === 'server icon');
  for (const content of ['!servericon', '!server icon', `!${shortIcon}`]) assert.ok(refusedPrefix(await send(content, { guild: imageGuild })), `${content} is refused when servericon is turned off`);
  assert.match((await send('!serverbanner', { guild: imageGuild })).sent.join(''), /Banner of Petto Test/, '!serverbanner is not');

  // The name of the umbrella turns off all of it.
  rules = [{ command: 'server', channel_id: null }];
  for (const sub of Object.keys({ ...SERVER, ...SERVER_NEW })) assert.ok(refusedSlash(await slash('server', sub, { guild: imageGuild })), `/server ${sub} is refused when server is turned off`);
  for (const content of ['!server', '!server roles', '!servericon', '!server channels']) assert.ok(refusedPrefix(await send(content, { guild: imageGuild })), `${content} is refused when server is turned off`);
  assert.deepEqual(await ran('!serverinfo'), ['serverinfo'], 'the old commands are not touched by it');
  assert.deepEqual(await ran('!roles'), ['roles']);
  assert.ok((await slash('user', 'info')).ran === 'userinfo');
  rules = [{ command: 'user', channel_id: null }];
  for (const sub of Object.keys(USER)) assert.ok(refusedSlash(await slash('user', sub)), `/user ${sub} is refused when user is turned off`);
  assert.ok(refusedPrefix(await send('!user')) && refusedPrefix(await send('!user avatar')));
  assert.deepEqual(await ran('!avatar'), ['avatar']);

  // One channel only.
  rules = [{ command: 'serverinfo', channel_id: ROOM }];
  result = await slash('server', 'info', { channelId: ROOM });
  assert.ok(refusedSlash(result) && text(result.replies[0].payload).includes(`<#${ROOM}>`), 'refused in that channel, naming it');
  assert.equal((await slash('server', 'info', { channelId: OTHER_ROOM })).ran, 'serverinfo', 'allowed in another channel');
  assert.ok(refusedPrefix(await send('!server', { channelId: ROOM })) && (await send('!server', { channelId: OTHER_ROOM })).ran[0] === 'serverinfo');
  rules = [];

  // A restriction to roles (`!restrictcommand`): the wrapped command's name and the umbrella's.
  restrictions = { userinfo: ['900000000000000001'] };
  result = await slash('user', 'info');
  assert.ok(refusedSlash(result) && text(result.replies[0].payload).includes('<@&900000000000000001>'), '/user info asks for the role of userinfo');
  assert.equal((await slash('user', 'info', { roles: ['900000000000000001'] })).ran, 'userinfo', 'with the role it runs');
  assert.equal((await slash('user', 'info', { admin: true })).ran, 'userinfo', 'an administrator always can');
  assert.equal((await slash('user', 'avatar')).ran, 'avatar', 'another subcommand is not restricted');
  assert.ok(refusedPrefix(await send('!user'), NEEDS_ROLE) && refusedPrefix(await send('!user whois'), NEEDS_ROLE), 'the prefix asks for the role too');
  assert.match((await send('!user')).sent.join(''), /900000000000000001/);
  assert.deepEqual(await ran('!user avatar'), ['avatar']);
  restrictions = { server: ['900000000000000002'] };
  assert.ok(refusedSlash(await slash('server', 'roles')) && refusedPrefix(await send('!server roles'), NEEDS_ROLE), 'a restriction on server asks for the role in every subcommand');
  assert.equal((await slash('user', 'info')).ran, 'userinfo');
  restrictions = {};

  // A permission level (`!permissions`): the one of the wrapped command also asked.
  levelDenied = new Set(['serverinfo']);
  result = await slash('server', 'info');
  assert.ok(!result.ran && result.replies[0].payload.content, '/server info asks for the level of serverinfo');
  assert.equal((await slash('server', 'roles')).ran, 'roles');
  assert.ok(refusedPrefix(await send('!server'), NEEDS_LEVEL), '!server asks for it too');
  assert.deepEqual(await ran('!server roles'), ['roles']);
  levelDenied = new Set(['user']);
  assert.ok(!(await slash('user', 'avatar')).ran && refusedPrefix(await send('!user avatar'), NEEDS_LEVEL), 'the level of the umbrella is asked for all of it');
  levelDenied = new Set();
  restoreWrapped();

  // The rules the commands save with: `!disablecommand servericon` finds the route, and the stored name is kept at start.
  const disableSource = fs.readFileSync(path.join(root, 'src', 'commands', 'automation', 'disablecommand.js'), 'utf8');
  assert.match(disableSource, /route\?\.disableName/, '!disablecommand reads the name a route stands for');
  assert.match(fs.readFileSync(path.join(root, 'src', 'events', 'ready.js'), 'utf8'), /route\?\.disableName \?\? route\?\.command/, 'the rules saved with a route name keep it when the bot starts');

  // ------------------------------------------------------------ Discord: the descriptions in Spanish and Portuguese, the numbers and the sizes
  const registered = collectCommandData();
  const chat = registered.filter((json) => (json.type ?? 1) === 1);
  assert.equal(registered.length, 71, '71 commands registered with Discord (the 31 there were, /server, /user, /mod, /game, /me, /search, /staff and the third batch of umbrellas)');
  assert.equal(chat.length, 68, '68 of them slash commands (3 are menus)');
  assert.ok(chat.length <= 100, 'far from the 100 slash commands Discord allows');
  const size = (value) => [...String(value ?? '')].length;
  const LOCALES = ['es-ES', 'es-419', 'pt-BR'];
  const walk = (node, trail) => {
    assert.ok(size(node.description) > 0 && size(node.description) <= 100, `${trail}: the description has ${size(node.description)} characters`);
    assert.equal(node.name_localizations, undefined, `${trail}: names of commands are never translated`);
    for (const locale of LOCALES) {
      const translated = node.description_localizations?.[locale];
      assert.ok(translated, `${trail}: described in ${locale}`);
      assert.ok(size(translated) <= 100, `${trail} [${locale}]: ${size(translated)} characters`);
    }
    for (const child of node.options ?? []) walk(child, `${trail} ${child.name}`);
  };
  for (const name of ['server', 'user']) {
    const json = registered.find((each) => each.name === name);
    assert.ok(json, `/${name} is registered with Discord, so deploy-commands.js sends it`);
    walk(json, `/${name}`);
    assert.ok(json.options.length <= 25, `/${name} has ${json.options.length} subcommands (at most 25)`);
    // The command and its subcommands are in the language of the person, not the English text.
    assert.notEqual(json.description_localizations['es-ES'], json.description);
    assert.notEqual(json.description_localizations['pt-BR'], json.description);
    for (const sub of json.options) assert.notEqual(sub.description_localizations['es-ES'], sub.description, `/${name} ${sub.name} is translated into Spanish`);
    for (const sub of json.options) assert.notEqual(sub.description_localizations['pt-BR'], sub.description, `/${name} ${sub.name} is translated into Portuguese`);
    for (const locale of [null, ...LOCALES]) {
      let total = 0;
      const add = (node) => {
        total += size(node.name) + size((locale && node.description_localizations?.[locale]) || node.description);
        for (const child of node.options ?? []) add(child);
      };
      add(json);
      assert.ok(total < 2500, `/${name}${locale ? ` [${locale}]` : ''} is ${total} characters (Discord allows 8000)`);
    }
  }
  // The old everyday slash commands are still registered as they were.
  for (const name of ['serverinfo', 'userinfo', 'avatar']) assert.ok(chat.some((json) => json.name === name), `/${name} is still registered`);
  // Nothing else of the wrapped commands became a slash command.
  for (const name of ['roles', 'channels', 'emojis', 'boosters', 'banner', 'usercosmetics', 'permissions', 'snowflake', 'firstmessage', 'activity']) assert.ok(!chat.some((json) => json.name === name), `/${name} is not a slash command`);
  // Every key of the English catalog of the info commands has its Spanish and Portuguese text.
  const english = CATALOGS.en;
  for (const key of Object.keys(english).filter((each) => /^cmd\.info\.(server|user)\./.test(each))) {
    assert.ok(CATALOGS.es[key] && CATALOGS['pt-BR'][key], `${key} is in es and pt-BR`);
  }

  // Short aliases of a pair of words are common words only when they should be (the rule of the table does not change).
  assert.ok(shortAliasRoutes().length >= 520);

  console.log('check-server-user-commands: ok');
  setTimeout(() => process.exit(0), 10);
})().catch((err) => { console.error(err); process.exit(1); });
