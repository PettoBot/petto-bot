// Checks the second batch of umbrella commands: /game, /me, /search and /staff (src/commands/{fun/game,utility/me,integrations/search,moderation/staff}.js,
// utils/umbrella.js). The prefix commands are moving to slash umbrellas little by little; each umbrella wraps the old commands, which keep working:
//   - every subcommand exists, takes the options of the command it wraps (the same names, types, limits and choices) and runs that command's own
//     code with them, for the slash command and for the prefix (`!game 8ball ...`, `!search yt ...`, `!staff mban ...`); the prefix reads what
//     each subcommand takes exactly as the old command does (compared one by one against `!8ball ...`, `!roblox user ...`, `!massban ...`);
//     `!game`, `!me`, `!search` and `!staff` alone list the subcommands;
//   - SECURITY: Discord checks the permissions of a whole command, never of one subcommand, and the commands wrapped here work only with the
//     prefix, so each umbrella is open and each subcommand asks, when it runs, for the permission of the command it wraps (or the role chosen with
//     `!moderation`), for the slash command and the prefix alike: `/staff massban` asks for Administrator, `/staff voice-mute` for Mute Members
//     (not for the three voice permissions at once), `/staff nuke` for Manage Channels; a member with another permission, or none, is refused in
//     private and the wrapped command never starts. `/game`, `/me` and `/search` wrap commands that ask for nothing, and stay open;
//   - the old commands, their words, routes and slash commands are untouched; a rule of a server (turned off, restricted, a permission level)
//     on a wrapped command stops that subcommand only, and on the umbrella stops all of it;
//   - the descriptions are translated for Discord (Spanish and Portuguese), the short aliases are in the table, and the number and size of the
//     slash commands stay inside what Discord allows (38 registered, 35 of them slash commands).
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');
const { ApplicationCommandOptionType, ChannelType, MessageFlags, PermissionFlagsBits, PermissionsBitField } = require('discord.js');

const root = path.join(__dirname, '..');
function stub(relative, exports) {
  const resolved = require.resolve(path.join(root, relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
/** The real module with some of its functions replaced (the others are needed by the commands that load with it). */
function patch(relative, overrides) {
  return Object.assign(require(path.join(root, relative)), overrides);
}

// What the server has set, in memory.
let rules = []; // { command, channel_id }
let restrictions = {}; // command -> role ids
let levelDenied = new Set(); // commands whose permission level the member does not meet
let moderationRoles = {}; // command -> role ids chosen with `!moderation` (`voice`, `nuke`...)
const guildRow = { prefix: '!', prefixes: ['!', 'petto', ','] };
stub('src/db/database.js', { from: () => ({}) });
patch('src/db/guilds.js', { ensureGuild: async () => guildRow });
patch('src/db/commandAliases.js', { get: async () => null });
patch('src/db/customCommands.js', { getCommand: async () => null });
patch('src/db/disabledCommands.js', { findCached: async (guildId, command, channelId) => rules.find((row) => row.command === command && (row.channel_id === null || row.channel_id === channelId)) ?? null, canonicalizeStored: async () => 0 });
patch('src/db/commandRestrictions.js', { restrictionMap: async () => restrictions });
patch('src/db/permissions.js', {
  hasCommandPermission: async (guildId, command) => !levelDenied.has(command),
  listGroups: async () => Object.entries(moderationRoles).map(([command, roles]) => ({ name: `__petto_moderation_role__:${command}`, members: roles.map((id) => ({ subject_type: 'role', subject_id: id })) })),
});
patch('src/utils/userResolve.js', { resolveUser: async (client, token, guild, context) => { const id = String(token).replace(/\D/g, ''); return id ? { id } : null; } });
patch('src/utils/sharedCooldown.js', { getRemainingCooldownShared: async () => 0 });
patch('src/utils/userPrefixAccess.js', { activeUserPrefix: async () => null });
patch('src/utils/codeTriggers.js', { findTrigger: async () => null });
patch('src/utils/codeCommands.js', { runCodeCommand: async () => true });
patch('src/logging/extraLog.js', { logCommandUse() {} });
patch('src/utils/cardService.js', { plainMessage: async (text) => ({ content: text }) });
patch('src/utils/logger.js', { info() {}, warn() {}, error() {} });

const { loadCommands, collectCommandData, isSlashCommand } = require('../src/handlers/commandHandler');
const event = require('../src/events/messageCreateCommands');
const interactionCreate = require('../src/events/interactionCreate');
const commandRules = require('../src/utils/commandRules');
const { CATALOGS } = require('../src/i18n');
const { SHORT_ALIAS_TABLE } = require('../src/utils/shortAliases');
const { permissionBitsOf } = require('../src/utils/umbrella');

const client = { user: { id: '123' }, users: { fetch: async (id) => ({ id, username: `user${id.slice(-3)}` }) } };
loadCommands(client);
const F = PermissionFlagsBits;
const GUILD = '444444444444444444';
const ROOM = '666666666666666666';
const ANA = '111111111111111111';
const BEA = '222222222222222222';
const CAL = '333333333333333333';
const MODS = '900000000000000001';
const subcommandsOf = (command) => command.data.toJSON().options;

// ---------------------------------------------------------------- what each subcommand does (written here, apart from the commands)
// [name, wrapped command, the subcommand of it (or null), what it asks of the member (a permission, or null for anyone), what to type after it]
const TABLES = {
  game: [
    ['8ball', '8ball', null, null, 'will it rain tomorrow'],
    ['coinflip', 'coinflip', null, null, ''],
    ['rps', 'rps', null, null, 'rock'],
    ['ship', 'ship', null, null, `<@${BEA}> <@${CAL}>`],
    ['roll', 'roll', null, null, '2d6+3'],
    ['choose', 'choose', null, null, 'tea, coffee'],
    ['truthordare', 'truthordare', null, null, 'truth'],
    ['wouldyourather', 'wouldyourather', null, null, 'cats, dogs'],
    ['neverhaveiever', 'neverhaveiever', null, null, ''],
    ['uwu', 'uwu', null, null, 'hello there'],
    ['quote', 'quote', null, null, 'some words'],
    ['jumbo', 'jumbo', null, null, ':smile:'],
    ['cat', 'animal', 'cat', null, ''],
    ['dog', 'animal', 'dog', null, ''],
    ['fox', 'animal', 'fox', null, ''],
    ['minecraft', 'minecraft', 'user', null, 'Notch'],
    ['minecraft-server', 'minecraft', 'server', null, 'mc.hypixel.net'],
    ['roblox', 'roblox', 'user', null, 'builderman'],
    ['steam', 'steam', 'profile', null, 'gaben'],
    ['chesscom', 'chess', 'chesscom', null, 'hikaru'],
    ['lichess', 'chess', 'lichess', null, 'DrNykterstein'],
    ['pokemon', 'pokemon', null, null, 'pikachu'],
    ['modrinth', 'modrinth', null, null, 'sodium'],
  ],
  me: [
    ['birthday', 'birthday', 'set', null, '25 12'],
    ['birthday-remove', 'birthday', 'remove', null, ''],
    ['birthday-view', 'birthday', 'view', null, `<@${BEA}>`],
    ['rep', 'rep', 'view', null, `<@${BEA}>`],
    ['rep-give', 'rep', 'give', null, `<@${BEA}>`],
    ['prefix', 'myprefix', 'show', null, ''],
    ['prefix-set', 'myprefix', 'set', null, '?!'],
    ['prefix-reset', 'myprefix', 'reset', null, ''],
    ['names', 'profilehistory', 'names', null, `<@${BEA}>`],
    ['nicknames', 'profilehistory', 'nicknames', null, `<@${BEA}>`],
    ['history-clear', 'profilehistory', 'clear', null, 'names'],
    ['history-record', 'profilehistory', 'record', null, 'true'],
    ['ranking', 'globalranking', 'status', null, ''],
    ['ranking-on', 'globalranking', 'on', null, ''],
    ['ranking-off', 'globalranking', 'off', null, ''],
    ['lastfm-link', 'lastfm', 'link', null, 'someuser'],
    ['lastfm-unlink', 'lastfm', 'unlink', null, ''],
    ['spotify', 'spotify', 'view', null, `<@${BEA}>`],
    ['boosterrole', 'boosterrole', 'create', null, 'Cool'],
    ['boosterrole-color', 'boosterrole', 'color', null, '#ff0000'],
    ['boosterrole-rename', 'boosterrole', 'rename', null, 'Cooler'],
    ['boosterrole-remove', 'boosterrole', 'remove', null, ''],
  ],
  search: [
    ['anilist', 'anilist', 'anime', null, 'Frieren'],
    ['tmdb', 'tmdb', 'movie', null, 'Interstellar'],
    ['itunes', 'itunes', 'song', null, 'creep radiohead'],
    ['deezer', 'deezer', 'track', null, 'creep radiohead'],
    ['lastfm', 'lastfm', 'now', null, `<@${BEA}>`],
    ['youtube', 'youtube', 'video', null, 'lofi beats'],
    ['twitch', 'twitch', 'channel', null, 'shroud'],
    ['wikipedia', 'wikipedia', null, null, 'Minecraft'],
    ['wiki', 'wiki', null, null, 'ban'],
    ['weather', 'weather', null, null, 'Bogota'],
    ['time', 'time', null, null, 'Colombia'],
    ['currency', 'currency', null, null, '100 usd cop'],
    ['crypto', 'crypto', null, null, 'bitcoin'],
    ['github', 'github', 'repo', null, 'octocat/hello-world'],
    ['package', 'package', 'npm', null, 'discord.js'],
  ],
  staff: [
    ['imute', 'imute', 'user', 'ModerateMembers', `<@${BEA}> spam`],
    ['iunmute', 'imute', 'remove', 'ModerateMembers', `<@${BEA}> ok`],
    ['rmute', 'rmute', 'user', 'ModerateMembers', `<@${BEA}> spam`],
    ['runmute', 'rmute', 'remove', 'ModerateMembers', `<@${BEA}> ok`],
    ['voice-mute', 'voice', 'mute', 'MuteMembers', `<@${BEA}> loud`],
    ['voice-unmute', 'voice', 'unmute', 'MuteMembers', `<@${BEA}> ok`],
    ['voice-deafen', 'voice', 'deafen', 'DeafenMembers', `<@${BEA}> loud`],
    ['voice-undeafen', 'voice', 'undeafen', 'DeafenMembers', `<@${BEA}> ok`],
    ['voice-disconnect', 'voice', 'disconnect', 'MoveMembers', `<@${BEA}> afk`],
    ['voice-move', 'voice', 'move', 'MoveMembers', `<@${BEA}> <#${ROOM}> wrong room`],
    ['voice-drag', 'voice', 'drag', 'MoveMembers', `<@${BEA}> <@${CAL}> <#${ROOM}>`],
    ['thread-rename', 'thread', 'rename', 'ManageThreads', 'A new name for it'],
    ['thread-lock', 'thread', 'lock', 'ManageThreads', ''],
    ['thread-unlock', 'thread', 'unlock', 'ManageThreads', ''],
    ['nuke', 'nuke', null, 'ManageChannels', ''],
    ['raid', 'raid', 'clean', 'BanMembers', '10m ban raiders'],
    ['raid-list', 'raid', 'list', 'BanMembers', '1h'],
    ['massban', 'massban', null, 'Administrator', `<@${BEA}> <@${CAL}> spam`],
    ['masskick', 'masskick', null, 'Administrator', `<@${BEA}> <@${CAL}> spam`],
    ['massmute', 'massmute', null, 'Administrator', `<@${BEA}> <@${CAL}> spam`],
    ['massunban', 'massunban', null, 'Administrator', 'appeal accepted'],
    ['massunmute', 'massunmute', null, 'Administrator', `<@${BEA}> <@${CAL}> ok`],
    ['masswarn', 'masswarn', null, 'Administrator', `<@${BEA}> <@${CAL}> being rude`],
    ['snipe', 'snipe', 'deleted', 'ManageMessages', '2'],
  ],
};
const UMBRELLAS = Object.keys(TABLES);
const CATEGORY = { game: 'fun', me: 'utility', search: 'integrations', staff: 'moderation' };
const NEW_SLASH = ['game', 'me', 'search', 'staff'];
const commandFile = (name) => client.commands.get(name);

// ---------------------------------------------------------------- the spy: replaces what a wrapped command does with a record of what it was asked
const calls = [];
const originals = [];
const typeRead = { 3: 'getString', 4: 'getInteger', 5: 'getBoolean', 6: 'getUser', 7: 'getChannel', 8: 'getRole', 9: 'getMentionable', 10: 'getNumber', 11: 'getAttachment' };
function readOptions(interaction, file) {
  const json = commandFile(file).data.toJSON();
  const sub = interaction.options.getSubcommand(false);
  const node = sub ? json.options.find((option) => option.name === sub) : json;
  const values = {};
  for (const option of node?.options ?? []) {
    let value = null;
    try { value = interaction.options[typeRead[option.type]](option.name, false); } catch { value = null; }
    values[option.name] = value?.id ?? value?.url ?? value ?? null;
  }
  return { sub, values };
}
function spyOn(files) {
  for (const file of files) {
    const module = commandFile(file);
    originals.push([module, 'execute', module.execute]);
    module.execute = async function spy(interaction) {
      const { sub, values } = readOptions(interaction, file);
      calls.push({ file, sub, group: interaction.options.getSubcommandGroup(false), commandName: interaction.commandName, roleAllowed: Boolean(interaction.pettoModerationRoleAllowed), values, interaction });
    };
  }
}
const restoreSpies = () => { for (const [module, key, value] of originals.splice(0)) module[key] = value; };

// ---------------------------------------------------------------- the slash command, through the real handler
let seq = 0;
const memberWith = (perms, roles = []) => ({
  id: ANA, guild: { ownerId: '1' }, permissions: new PermissionsBitField(perms), roles: { cache: new Map(roles.map((id) => [id, {}])), highest: { position: 10 } },
});
/** What a member types for each option, by its type: the same value every time, inside the limits of the option. */
function valuesFor(option) {
  switch (option.type) {
    case ApplicationCommandOptionType.String: return option.choices?.length ? option.choices[0].value : `v-${option.name}`.slice(0, option.max_length ?? 99);
    case ApplicationCommandOptionType.Integer: return Math.min(Math.max(option.min_value ?? 3, 3), option.max_value ?? 1000);
    case ApplicationCommandOptionType.Number: return Math.min(Math.max(option.min_value ?? 3, 3), option.max_value ?? 1000);
    case ApplicationCommandOptionType.Boolean: return true;
    case ApplicationCommandOptionType.User: case ApplicationCommandOptionType.Mentionable: return BEA;
    case ApplicationCommandOptionType.Channel: return ROOM;
    case ApplicationCommandOptionType.Role: return MODS;
    case ApplicationCommandOptionType.Attachment: return 'https://example.com/a.png';
    default: throw new Error(`no value for type ${option.type}`);
  }
}
const typedValues = (umbrella, sub) => Object.fromEntries((subcommandsOf(commandFile(umbrella)).find((each) => each.name === sub).options ?? []).map((option) => [option.name, valuesFor(option)]));
/** `/<umbrella> <sub>` through interactionCreate: `{ replies, called, ran }`; `perms`: what the member has (a bit field or a flag). */
async function slash(umbrella, sub, { values = typedValues(umbrella, sub), channelId = ROOM, perms = F.Administrator, roles = [], member = null } = {}) {
  seq += 1;
  const replies = [];
  const before = calls.length;
  const pick = (name) => values[name] ?? null;
  const base = {
    id: `7777777777777777${String(10 + seq)}`, commandName: umbrella, commandType: 1, user: { id: ANA, username: 'Ana' },
    guild: { id: GUILD, ownerId: '1', name: 'Petto Test' }, guildId: GUILD, channelId, channel: { id: channelId },
    member: member ?? memberWith(perms, roles),
    locale: 'en-US', pettoLang: 'en', client,
    options: {
      getSubcommand: () => sub, getSubcommandGroup: () => null,
      getUser: (name) => (pick(name) ? { id: pick(name) } : null), getChannel: (name) => (pick(name) ? { id: pick(name) } : null), getRole: (name) => (pick(name) ? { id: pick(name) } : null),
      getMentionable: (name) => (pick(name) ? { id: pick(name) } : null), getAttachment: (name) => (pick(name) ? { url: pick(name) } : null),
      getString: (name) => pick(name), getInteger: (name) => pick(name), getBoolean: (name) => pick(name), getNumber: (name) => pick(name),
    },
    deferred: false, replied: false,
    isChatInputCommand: () => true,
    reply: async (payload) => { replies.push({ how: 'reply', payload }); base.replied = true; return {}; },
    deferReply: async (payload) => { replies.push({ how: 'defer', payload }); base.deferred = true; },
    editReply: async (payload) => { replies.push({ how: 'edit', payload }); },
  };
  const interaction = new Proxy(base, { get: (target, key) => (key in target ? target[key] : (typeof key === 'string' && /^is[A-Z]/.test(key) ? () => false : undefined)) });
  await interactionCreate.execute(interaction, client);
  const called = calls.slice(before);
  return { replies, called, ran: called[0] ?? null, values };
}
const text = (payload) => JSON.stringify((payload.components ?? []).map((component) => component.toJSON?.() ?? component)) + (payload.content ?? '');
const ephemeral = (reply) => reply?.how === 'reply' && (reply.payload.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral;
const refusedSlash = (result) => !result.ran && ephemeral(result.replies.find((reply) => reply.how === 'reply'));

// ---------------------------------------------------------------- the prefix, through the real message handler
let n = 0;
const voiceRoom = { id: ROOM, type: ChannelType.GuildVoice, name: 'room', guild: { id: GUILD } };
/** A message such as `!game 8ball ...`: `{ called, sent, ran }`. */
async function send(content, { channelId = '5', perms = F.Administrator, roles = [] } = {}) {
  const sent = [];
  const before = calls.length;
  const message = {
    content, author: { id: ANA, bot: false }, guild: { id: `7${n++}`, name: 'Petto Test', members: { cache: new Map(), fetch: async () => new Map() }, channels: { cache: new Map([[ROOM, voiceRoom]]) } }, client,
    member: memberWith(perms, roles),
    mentions: { users: new Map(), roles: new Map(), channels: new Map(), members: new Map() }, attachments: new Map(), reference: null,
    channel: { id: channelId, sendTyping: async () => {}, send: async (payload) => { sent.push(text(payload)); return {}; } },
    reply: async (payload) => { sent.push(text(payload)); return { delete: async () => {}, edit: async () => {} }; },
  };
  event.setCachedPrefix(message.guild.id, guildRow.prefixes);
  await event.execute(message);
  const called = calls.slice(before);
  return { called, ran: called[0] ?? null, sent, message };
}
const refusedPrefix = (result, why = /turned off|disabled/i) => !result.ran && result.sent.length === 1 && why.test(result.sent[0]);

(async () => {
  // ------------------------------------------------------------ the commands exist, once each, with what was decided
  const wrappedFiles = [...new Set(UMBRELLAS.flatMap((umbrella) => TABLES[umbrella].map((row) => row[1])))];
  for (const umbrella of UMBRELLAS) {
    const command = client.commands.get(umbrella);
    assert.ok(command, `/${umbrella} is loaded`);
    assert.equal(command.category, CATEGORY[umbrella], `/${umbrella} is in ${CATEGORY[umbrella]}`);
    assert.ok(!command.hiddenFromHelp && !command.slashOnly && !command.prefixOnly, `/${umbrella} is a prefix and a slash command, shown in !help`);
    assert.equal(command.registerSlash, true);
    assert.equal(command.rulesBySubcommand, true);
    assert.equal(command.listSubcommandsWhenEmpty, true);
    assert.ok(isSlashCommand(command));
    assert.equal(client.commandAliases.has(umbrella) || client.commandRoutes.has(umbrella), false, `\`${umbrella}\` was not a word of anything else`);
    const json = command.data.toJSON();
    assert.equal(json.dm_permission, false);
    // Discord checks this per command, not per subcommand: any bound would hide the umbrella from the members who may use some of it.
    assert.equal(json.default_member_permissions ?? null, null, `/${umbrella} is open: each subcommand asks for the permission of what it wraps when it runs`);
    const names = subcommandsOf(command).map((sub) => sub.name);
    assert.deepEqual(names, TABLES[umbrella].map((row) => row[0]), `/${umbrella} has the subcommands that were decided, in order`);
    assert.ok(names.length <= 25, `/${umbrella} has ${names.length} subcommands (at most 25)`);
    assert.ok(subcommandsOf(command).every((sub) => sub.type === ApplicationCommandOptionType.Subcommand), `/${umbrella} has subcommands and nothing else: no slash command without subcommands`);
    assert.deepEqual(command.subcommands.map((entry) => [entry.name, entry.wraps, entry.sub ?? null]), TABLES[umbrella].map((row) => [row[0], row[1], row[2]]), `/${umbrella} wraps what was decided`);
  }
  assert.deepEqual(UMBRELLAS.map((umbrella) => TABLES[umbrella].length), [23, 22, 15, 24]);

  // What it wraps is something the umbrella can run: it exists, is private to nobody, takes no list that is filled while typing, and reads no
  // shorter way of writing that an umbrella would not pass on.
  for (const file of wrappedFiles) {
    const wrapped = commandFile(file);
    assert.ok(wrapped, `${file} exists`);
    assert.ok(!wrapped.hiddenFromHelp && !wrapped.privateGuildId, `${file} is not private`);
    assert.equal(typeof wrapped.autocomplete, 'undefined', `${file} has no autocomplete the umbrella would have to pass on`);
    assert.equal(typeof wrapped.prefixArgs, 'undefined', `${file} has no prefixArgs reader the umbrella would have to pass on`);
    const walk = (node) => { assert.ok(!node.autocomplete, `${file} ${node.name} has no autocomplete`); (node.options ?? []).forEach(walk); };
    wrapped.data.toJSON().options?.forEach(walk);
  }
  // Only prefix commands are wrapped (the ones that were already slash commands, `/remind`, `/rank`, `/afk`..., stay as they are).
  for (const file of wrappedFiles) assert.ok(!isSlashCommand(commandFile(file)), `${file} was a prefix command (the slash ones are not wrapped twice)`);

  // Each subcommand has the description and the options of what it wraps: the same names, types, required flags, limits and choices.
  const shape = (options) => (options ?? []).map((option) => [option.name, option.type, Boolean(option.required), option.description, option.channel_types ?? null, option.choices ?? null, option.min_value ?? null, option.max_value ?? null, option.min_length ?? null, option.max_length ?? null]);
  for (const umbrella of UMBRELLAS) {
    const command = commandFile(umbrella);
    for (const [name, file, sub] of TABLES[umbrella]) {
      const own = subcommandsOf(command).find((each) => each.name === name);
      const wrapped = commandFile(file).data.toJSON();
      const node = sub ? wrapped.options.find((option) => option.name === sub) : wrapped;
      assert.ok(node, `${file} ${sub ?? ''} exists`);
      assert.equal(own.description, node.description, `/${umbrella} ${name} describes itself like ${file} ${sub ?? ''}`);
      assert.deepEqual(shape(own.options), shape(node.options), `/${umbrella} ${name} takes the options of ${file} ${sub ?? ''}`);
      assert.equal(command.ruleKeys[name], file, `the rules of /${umbrella} ${name} are the ones of ${file}`);
    }
  }
  const optionsOf = (umbrella, name) => (subcommandsOf(commandFile(umbrella)).find((sub) => sub.name === name).options ?? []).map((option) => `${option.name}:${option.type}:${Boolean(option.required)}`);
  assert.deepEqual(optionsOf('game', '8ball'), ['question:3:true']);
  assert.deepEqual(optionsOf('game', 'ship'), ['first:6:true', 'second:6:false']);
  assert.deepEqual(optionsOf('game', 'coinflip'), []);
  assert.deepEqual(optionsOf('me', 'birthday'), ['day:4:true', 'month:4:true', 'year:4:false']);
  assert.deepEqual(optionsOf('me', 'history-record'), ['enabled:5:true']);
  assert.deepEqual(optionsOf('search', 'weather'), ['place:3:true']);
  assert.deepEqual(optionsOf('staff', 'massban'), ['users:3:true', 'reason:3:false']);
  assert.deepEqual(optionsOf('staff', 'masswarn'), ['users:3:true', 'reason:3:true']);
  assert.deepEqual(optionsOf('staff', 'voice-move'), ['user:6:true', 'channel:7:true', 'reason:3:false']);
  assert.deepEqual(optionsOf('staff', 'nuke'), []);
  const birthday = subcommandsOf(commandFile('me')).find((sub) => sub.name === 'birthday');
  assert.deepEqual([birthday.options[0].min_value, birthday.options[0].max_value, birthday.options[2].min_value], [1, 31, 1900], 'the limits of an option go with it');
  const rps = subcommandsOf(commandFile('game')).find((sub) => sub.name === 'rps');
  assert.equal(rps.options[0].choices.length, 3, 'the choices of an option go with it');
  const thread = subcommandsOf(commandFile('staff')).find((sub) => sub.name === 'thread-rename');
  assert.deepEqual(thread.options.map((option) => [option.name, option.max_length ?? null, option.channel_types?.length ?? 0]), [['name', 100, 0], ['thread', null, 3]], 'the name is at most 100 and the thread is a thread');

  // ------------------------------------------------------------ the slash command runs the code of the old command, with its options
  spyOn(wrappedFiles);
  for (const umbrella of UMBRELLAS) {
    for (const [name, file, sub] of TABLES[umbrella]) {
      const result = await slash(umbrella, name);
      assert.ok(result.ran, `/${umbrella} ${name} runs something`);
      assert.equal(result.called.length, 1, `/${umbrella} ${name} runs one command`);
      assert.equal(result.ran.file, file, `/${umbrella} ${name} runs the code of ${file}`);
      assert.equal(result.ran.sub, sub, `/${umbrella} ${name} gives ${file} the subcommand ${sub}`);
      assert.equal(result.ran.group, null);
      assert.equal(result.ran.commandName, file, `${file} is told it was typed as ${file}`);
      assert.deepEqual(result.ran.values, result.values, `/${umbrella} ${name} passes every option it was given`);
    }
  }
  let r = (await slash('game', '8ball', { values: { question: 'will I win?' } })).ran;
  assert.deepEqual([r.file, r.values.question], ['8ball', 'will I win?']);
  r = (await slash('game', 'ship', { values: { first: BEA, second: CAL } })).ran;
  assert.deepEqual([r.values.first, r.values.second], [BEA, CAL]);
  r = (await slash('me', 'birthday', { values: { day: 25, month: 12, year: 1999 } })).ran;
  assert.deepEqual([r.sub, r.values.day, r.values.month, r.values.year], ['set', 25, 12, 1999]);
  r = (await slash('me', 'history-record', { values: { enabled: false } })).ran;
  assert.deepEqual([r.sub, r.values.enabled], ['record', false], 'a false is a value too');
  r = (await slash('search', 'github', { values: { repository: 'octocat/hello-world' } })).ran;
  assert.deepEqual([r.file, r.sub, r.values.repository], ['github', 'repo', 'octocat/hello-world']);
  r = (await slash('staff', 'massban', { values: { users: `${BEA} ${CAL}`, reason: 'raid' } })).ran;
  assert.deepEqual([r.file, r.values.users, r.values.reason], ['massban', `${BEA} ${CAL}`, 'raid'], 'the one text of users goes as it is');
  r = (await slash('staff', 'voice-move', { values: { user: BEA, channel: ROOM, reason: 'wrong room' } })).ran;
  assert.deepEqual([r.sub, r.values.user, r.values.channel, r.values.reason], ['move', BEA, ROOM, 'wrong room']);
  // The wrapped commands see the interaction as it came: what they set is what the handler reads.
  const first = await slash('staff', 'nuke');
  assert.equal(first.ran.interaction.options.getSubcommand(false), null, 'nuke has no subcommand of its own');
  restoreSpies();

  // ------------------------------------------------------------ the prefix reads what each subcommand takes exactly as the old command does
  spyOn(wrappedFiles);
  const ran = async (content, options) => (await send(content, options)).ran;
  for (const umbrella of UMBRELLAS) {
    for (const [name, file, sub, , tail] of TABLES[umbrella]) {
      const viaUmbrella = await send(`!${umbrella} ${name} ${tail}`.trimEnd());
      assert.ok(viaUmbrella.ran, `!${umbrella} ${name} ${tail} runs: ${viaUmbrella.sent.join('')}`);
      assert.equal(viaUmbrella.called.length, 1);
      assert.deepEqual([viaUmbrella.ran.file, viaUmbrella.ran.sub, viaUmbrella.ran.commandName], [file, sub, file], `!${umbrella} ${name} runs ${file}${sub ? ` ${sub}` : ''}`);
      const old = await send(`!${file}${sub ? ` ${sub}` : ''} ${tail}`.trimEnd());
      assert.ok(old.ran, `the old !${file} ${sub ?? ''} ${tail} still runs: ${old.sent.join('')}`);
      assert.deepEqual([old.ran.file, old.ran.sub], [file, sub]);
      assert.deepEqual(viaUmbrella.ran.values, old.ran.values, `!${umbrella} ${name} ${tail} reads its options as !${file} ${sub ?? ''} does`);
    }
  }
  // A few of them by hand, so the comparison above is not the only witness.
  let call = await ran('!game 8ball will it rain tomorrow?');
  assert.deepEqual([call.file, call.values.question], ['8ball', 'will it rain tomorrow?'], 'the question is every word');
  call = await ran(`,game ship <@${BEA}> <@${CAL}>`);
  assert.deepEqual([call.values.first, call.values.second], [BEA, CAL], 'with another prefix too');
  call = await ran('!game roll 4d6kh3');
  assert.equal(call.values.dice, '4d6kh3');
  call = await ran('!game minecraft Notch');
  assert.deepEqual([call.file, call.sub, call.values.player], ['minecraft', 'user', 'Notch']);
  call = await ran('!game minecraft-server mc.hypixel.net');
  assert.deepEqual([call.sub, call.values.address], ['server', 'mc.hypixel.net']);
  call = await ran('!me birthday 25 12 1999');
  assert.deepEqual([call.file, call.sub, call.values.day, call.values.month, call.values.year], ['birthday', 'set', 25, 12, 1999]);
  call = await ran('!me prefix-set p!');
  assert.deepEqual([call.file, call.sub, call.values.prefix], ['myprefix', 'set', 'p!']);
  call = await ran('!me history-record off');
  assert.deepEqual([call.sub, call.values.enabled], ['record', false]);
  call = await ran('!search weather San Salvador');
  assert.deepEqual([call.file, call.values.place], ['weather', 'San Salvador'], 'the place is every word');
  call = await ran('!search yt lofi hip hop');
  assert.deepEqual([call.file, call.sub, call.values.video], ['youtube', 'video', 'lofi hip hop'], 'the old word `yt` is `youtube`');
  call = await ran('!search github octocat/hello-world');
  assert.deepEqual([call.file, call.sub, call.values.repository], ['github', 'repo', 'octocat/hello-world']);
  call = await ran('!search currency 100 usd cop eur');
  assert.equal(call.values.conversion, '100 usd cop eur');
  call = await ran(`!staff massban <@${BEA}> <@${CAL}> posting scams`);
  assert.deepEqual([call.file, call.values.users, call.values.reason], ['massban', `<@${BEA}> <@${CAL}>`, 'posting scams'], 'the members, then the reason, as `!massban`');
  call = await ran(`!staff mban <@${BEA}> <@${CAL}> posting scams`);
  assert.deepEqual([call.file, call.values.users], ['massban', `<@${BEA}> <@${CAL}>`], 'the old word `mban` is `massban`');
  call = await ran(`!staff masswarn <@${BEA}> <@${CAL}> being rude`);
  assert.deepEqual([call.file, call.values.users, call.values.reason], ['masswarn', `<@${BEA}> <@${CAL}>`, 'being rude']);
  call = await ran('!staff thread-rename A new name for it');
  assert.deepEqual([call.file, call.sub, call.values.name], ['thread', 'rename', 'A new name for it'], 'the name takes every word left, as `!thread rename`');
  call = await ran('!staff raid 10m');
  assert.deepEqual([call.file, call.sub, call.values.duration], ['raid', 'clean', '10m']);
  call = await ran('!staff raid-list');
  assert.deepEqual([call.file, call.sub], ['raid', 'list']);
  call = await ran(`!staff picmute <@${BEA}>`);
  assert.deepEqual([call.file, call.sub], ['imute', 'user'], 'the old word `picmute` is `imute`');
  call = await ran('!staff snipe 3');
  assert.deepEqual([call.file, call.sub, call.values.index], ['snipe', 'deleted', 3]);

  // The old words of the wrapped commands, read as the subcommand they stand for.
  for (const [umbrella, words] of Object.entries({
    game: { cf: 'coinflip', flipcoin: 'coinflip', eightball: '8ball', tod: 'truthordare', wyr: 'wouldyourather', nhie: 'neverhaveiever', mc: 'minecraft', rbx: 'roblox', mr: 'modrinth', pkmn: 'pokemon', pokedex: 'pokemon', pick: 'choose', dice: 'roll', q: 'quote', bigemoji: 'jumbo', uwuify: 'uwu' },
    me: { bday: 'birthday', reputation: 'rep', myprefix: 'prefix', phist: 'names', globalrank: 'ranking', sp: 'spotify', br: 'boosterrole' },
    search: { ani: 'anilist', apple: 'itunes', dz: 'deezer', lfm: 'lastfm', yt: 'youtube', wp: 'wikipedia', wk: 'wiki', clima: 'weather', tz: 'time', cur: 'currency', coin: 'crypto', gh: 'github', pkg: 'package' },
    staff: { imagemute: 'imute', reactionmute: 'rmute', recentban: 'raid', mban: 'massban', mkick: 'masskick', mmute: 'massmute', munban: 'massunban', unbanall: 'massunban', munmute: 'massunmute', mwarn: 'masswarn', nuk: 'nuke' },
  })) {
    const command = commandFile(umbrella);
    for (const [word, name] of Object.entries(words)) {
      assert.equal(command.prefixSubcommandAliases[word], name, `!${umbrella} ${word} is ${name}`);
      assert.equal(commandRules.subcommandOfText(command, `${word} x`), name, `the rules read !${umbrella} ${word} as ${name}`);
    }
    for (const [word, name] of Object.entries(command.prefixSubcommandAliases)) assert.ok(command.subcommands.some((entry) => entry.name === name), `${word} points to a subcommand that exists`);
    for (const word of Object.keys(command.prefixSubcommandAliases)) assert.ok(!command.subcommands.some((entry) => entry.name === word), `${word} is not also the name of a subcommand`);
  }

  // `!game`, `!me`, `!search` and `!staff` alone: the list, not an error.
  for (const umbrella of UMBRELLAS) {
    const alone = await send(`!${umbrella}`);
    assert.equal(alone.called.length, 0);
    assert.equal(alone.sent.length, 1);
    for (const [name] of TABLES[umbrella]) assert.ok(alone.sent[0].includes(`!${umbrella} ${name}\``), `the list of !${umbrella} names ${name}`);
    assert.match(alone.sent[0], /has these ways to use it/);
    assert.ok(!/is not part of/.test(alone.sent[0]), `!${umbrella} alone is not a mistake`);
    assert.equal((await send(`,${umbrella}`)).sent.length, 1);
    const wrong = await send(`!${umbrella} banana`);
    assert.equal(wrong.called.length, 0);
    assert.match(wrong.sent[0], /is not part of/, 'a word that is not a subcommand is told');
  }
  assert.ok((await send('!game')).sent[0].includes('Ask the magic 8-ball'), 'with what each one does');
  assert.ok((await send('!staff')).sent[0].includes('Server-mute a member in voice.'));
  assert.equal((await send('!game 8ball')).called.length, 1, 'a missing option is the old command\'s to ask for (it reads it as required)');

  // `me` is also Spanish for "me": a word prefix (`petto`) never starts it, a symbol prefix does. The others work with both.
  assert.equal(await event.knownNameChecker(client, '1')('me'), false, '`petto me ayudas` is chat, not a command');
  assert.equal(await event.knownNameChecker(client, '1')('game'), true);
  assert.equal(await event.knownNameChecker(client, '1')('search'), true);
  assert.equal(await event.knownNameChecker(client, '1')('staff'), true);
  assert.equal(await event.knownNameChecker(client, '1')('help'), true, 'the real commands are still known');
  const chatMessage = await send('petto me ayudas con esto');
  assert.deepEqual([chatMessage.called.length, chatMessage.sent.length], [0, 0], '`petto me ayudas` is not answered');
  assert.ok((await send('!me birthday 1 1')).ran, '`!me` is a command with a symbol prefix');
  assert.ok((await send('petto game 8ball question')).ran, '`petto game` is a command with a word prefix');
  assert.ok((await send(`petto staff nuke`)).ran);

  // ------------------------------------------------------------ the old commands and their words are untouched
  for (const [content, file, sub] of [
    ['!8ball will it rain', '8ball', null], ['!eightball will it rain', '8ball', null], ['!coinflip', 'coinflip', null], ['!cf', 'coinflip', null], ['!rps rock', 'rps', null], [`!ship <@${BEA}>`, 'ship', null],
    ['!roll 2d6', 'roll', null], ['!dice 2d6', 'roll', null], ['!choose a, b', 'choose', null], ['!truthordare', 'truthordare', null], ['!tod', 'truthordare', null], ['!uwu hello', 'uwu', null], ['!jumbo :smile:', 'jumbo', null],
    ['!animal cat', 'animal', 'cat'], ['!minecraft user Notch', 'minecraft', 'user'], ['!mc Notch', 'minecraft', 'user'], ['!roblox user builderman', 'roblox', 'user'], ['!steam profile gaben', 'steam', 'profile'], ['!chess lichess DrNykterstein', 'chess', 'lichess'],
    ['!pokemon pikachu', 'pokemon', null], ['!modrinth sodium', 'modrinth', null],
    ['!birthday set 1 1', 'birthday', 'set'], ['!bday remove', 'birthday', 'remove'], ['!rep view', 'rep', 'view'], ['!rep give <@2>', 'rep', 'give'], ['!myprefix show', 'myprefix', 'show'], ['!myprefix', 'myprefix', 'show'], ['!profilehistory names', 'profilehistory', 'names'],
    ['!globalranking on', 'globalranking', 'on'], ['!globalranking', 'globalranking', 'status'], ['!lastfm link someone', 'lastfm', 'link'], ['!lastfm', 'lastfm', 'now'], ['!spotify view', 'spotify', 'view'], ['!boosterrole create Cool', 'boosterrole', 'create'],
    ['!anilist anime Frieren', 'anilist', 'anime'], ['!anilist Frieren', 'anilist', 'anime'], ['!tmdb Interstellar', 'tmdb', 'movie'], ['!itunes creep', 'itunes', 'song'], ['!deezer creep', 'deezer', 'track'], ['!youtube lofi beats', 'youtube', 'video'], ['!yt lofi beats', 'youtube', 'video'],
    ['!twitch shroud', 'twitch', 'channel'], ['!wikipedia Minecraft', 'wikipedia', null], ['!wp Minecraft', 'wikipedia', null], ['!wiki ban', 'wiki', null], ['!weather Bogota', 'weather', null], ['!time Colombia', 'time', null], ['!currency 100 usd cop', 'currency', null],
    ['!crypto bitcoin', 'crypto', null], ['!github user octocat', 'github', 'user'], ['!github issues octocat/hello-world', 'github', 'issues'], ['!package discord.js', 'package', 'npm'], ['!pkg py requests', 'package', 'pypi'],
    [`!imute <@${BEA}>`, 'imute', 'user'], [`!imute remove <@${BEA}>`, 'imute', 'remove'], [`!picmute <@${BEA}>`, 'imute', 'user'], [`!rmute <@${BEA}>`, 'rmute', 'user'], [`!voice mute <@${BEA}>`, 'voice', 'mute'], [`!v unmute <@${BEA}>`, 'voice', 'unmute'],
    ['!thread rename A new name', 'thread', 'rename'], ['!thread lock', 'thread', 'lock'], ['!nuke', 'nuke', null], ['!n', 'nuke', null], ['!raid clean 10m', 'raid', 'clean'], ['!raid 10m', 'raid', 'clean'], ['!raid list', 'raid', 'list'],
    [`!massban <@${BEA}> <@${CAL}> spam`, 'massban', null], [`!mban <@${BEA}>`, 'massban', null], [`!masskick <@${BEA}>`, 'masskick', null], [`!massmute <@${BEA}>`, 'massmute', null], ['!massunban', 'massunban', null], ['!unbanall', 'massunban', null],
    [`!massunmute <@${BEA}>`, 'massunmute', null], [`!masswarn <@${BEA}> rude`, 'masswarn', null], ['!snipe', 'snipe', 'deleted'], ['!snipe edited', 'snipe', 'edited'],
  ]) {
    const result = await ran(content);
    assert.ok(result, `${content} still runs`);
    assert.deepEqual([result.file, result.sub], [file, sub], `${content} still runs ${file}${sub ? ` ${sub}` : ''}`);
  }
  for (const [word, command] of [['cf', 'coinflip'], ['eightball', '8ball'], ['tod', 'truthordare'], ['wyr', 'wouldyourather'], ['nhie', 'neverhaveiever'], ['mc', 'minecraft'], ['rbx', 'roblox'], ['mr', 'modrinth'], ['bday', 'birthday'],
    ['bd', 'birthday'], ['reputation', 'rep'], ['userprefix', 'myprefix'], ['phist', 'profilehistory'], ['globalrank', 'globalranking'], ['sp', 'spotify'], ['br', 'boosterrole'], ['ani', 'anilist'], ['lfm', 'lastfm'], ['yt', 'youtube'],
    ['wp', 'wikipedia'], ['wk', 'wiki'], ['clima', 'weather'], ['tz', 'time'], ['gh', 'github'], ['pkg', 'package'], ['imagemute', 'imute'], ['reactionmute', 'rmute'], ['th', 'thread'], ['n', 'nuke'], ['mban', 'massban'], ['mkick', 'masskick'],
    ['mmute', 'massmute'], ['munban', 'massunban'], ['unbanall', 'massunban'], ['munmute', 'massunmute'], ['mwarn', 'masswarn'], ['sniped', 'snipe'], ['v', 'voice'], ['recentban', 'raid']]) {
    assert.equal(client.commandAliases.get(word), command, `${word} is still ${command}`);
  }
  assert.equal(client.commandRoutes.get('ytsearch').command, 'youtube', 'a route of an old command is still there');
  for (const name of ['8ball', 'minecraft', 'birthday', 'boosterrole', 'anilist', 'github', 'voice', 'thread', 'massban', 'snipe']) assert.ok(!isSlashCommand(commandFile(name)), `/${name} is still not a slash command: it works with the prefix`);
  // The commands that were already slash commands are still registered as they were.
  for (const name of ['afk', 'remind', 'rank', 'suggest', 'top', 'avatar', 'userinfo', 'ban', 'kick', 'purge']) assert.ok(isSlashCommand(commandFile(name)), `/${name} is still a slash command`);

  // ------------------------------------------------------------ SECURITY: the permission of each wrapped command, slash and prefix
  const wrongFor = (flag) => (flag === 'ManageGuild' ? F.ManageMessages : F.ManageGuild);
  for (const umbrella of UMBRELLAS) {
    const command = commandFile(umbrella);
    for (const [name, file, sub, flag, tail] of TABLES[umbrella]) {
      const wrapped = commandFile(file).data.toJSON();
      const wanted = flag === null ? null : F[flag];
      // What is asked for is what the old command is registered with, or what its own action asks for (`!voice mute` is Mute Members).
      const override = commandFile(file).prefixPermissionOverrides?.[sub ?? name];
      const registered = override !== undefined ? BigInt(override) : wrapped.default_member_permissions == null ? null : BigInt(wrapped.default_member_permissions);
      assert.equal(registered, wanted, `${file} ${sub ?? ''} asks for ${flag ?? 'nothing'}: what /${umbrella} ${name} asks for`);
      assert.equal(command.permissionForSubcommand(name), wanted, `!help ${umbrella} ${name} says ${flag ?? 'anyone'}`);
      assert.equal(permissionBitsOf((each) => commandFile(each), command.subcommands.find((entry) => entry.name === name)), wanted);
      const typed = `!${umbrella} ${name} ${tail}`.trimEnd();
      if (wanted === null) {
        // Open: a member with nothing runs it.
        assert.ok((await slash(umbrella, name, { perms: 0n })).ran, `/${umbrella} ${name} is for everybody`);
        assert.ok((await send(typed, { perms: 0n })).ran, `!${umbrella} ${name} is for everybody`);
        continue;
      }
      // Slash
      assert.equal((await slash(umbrella, name, { perms: wanted })).ran?.file, file, `/${umbrella} ${name} runs for a member with ${flag}`);
      for (const [label, perms] of [['nothing', 0n], ['another permission', wrongFor(flag)]]) {
        const denied = await slash(umbrella, name, { perms });
        assert.ok(refusedSlash(denied), `/${umbrella} ${name} is refused to a member with ${label}`);
        assert.equal(denied.replies.length, 1, 'the refusal is the only answer: the wrapped command did not start');
        assert.match(text(denied.replies[0].payload), new RegExp(`You need the \\*\\*${flag}\\*\\* permission`), `and says ${flag}`);
      }
      // Prefix
      { const got = await send(typed, { perms: wanted }); assert.equal(got.ran?.file, file, `!${umbrella} ${name} runs for a member with ${flag}: ${got.sent.join('')}`); }
      const deniedPrefix = await send(typed, { perms: wrongFor(flag) });
      assert.ok(!deniedPrefix.ran && deniedPrefix.sent.length === 1 && deniedPrefix.sent[0].includes(`**${flag}**`), `!${umbrella} ${name} is refused to a member with another permission, saying ${flag}`);
      assert.ok(!(await send(typed, { perms: 0n })).ran, `!${umbrella} ${name} is refused to a member with nothing`);
    }
  }
  // The ones the owner would worry about: the mass commands are for administrators only, whoever else can ban or kick.
  for (const name of ['massban', 'masskick', 'massmute', 'massunban', 'massunmute', 'masswarn']) {
    for (const perms of [F.BanMembers, F.KickMembers, F.ModerateMembers, F.ManageGuild, F.ManageMessages]) {
      assert.ok(refusedSlash(await slash('staff', name, { perms })), `/staff ${name} is refused to a member who is not an administrator`);
      assert.ok(!(await send(`!staff ${name} <@${BEA}> x`, { perms })).ran);
    }
    assert.ok((await slash('staff', name, { perms: F.Administrator })).ran && (await send(`!staff ${name} <@${BEA}> x`, { perms: F.Administrator })).ran);
  }
  // Each voice action asks for its own permission, not for all three.
  for (const [name, own, others] of [['voice-mute', F.MuteMembers, [F.DeafenMembers, F.MoveMembers]], ['voice-deafen', F.DeafenMembers, [F.MuteMembers, F.MoveMembers]], ['voice-move', F.MoveMembers, [F.MuteMembers, F.DeafenMembers]], ['voice-disconnect', F.MoveMembers, [F.MuteMembers]]]) {
    assert.ok((await slash('staff', name, { perms: own })).ran, `/staff ${name} runs with its own permission only`);
    for (const perms of others) assert.ok(refusedSlash(await slash('staff', name, { perms })), `/staff ${name} is not opened by another voice permission`);
    assert.ok(!(await send(`!staff ${name} <@${BEA}> <#${ROOM}>`, { perms: others[0] })).ran);
  }
  assert.ok(refusedSlash(await slash('staff', 'nuke', { perms: F.ManageMessages })) && (await slash('staff', 'nuke', { perms: F.ManageChannels })).ran);
  assert.ok(refusedSlash(await slash('staff', 'snipe', { perms: F.ManageChannels })) && (await slash('staff', 'snipe', { perms: F.ManageMessages })).ran);
  assert.ok(refusedSlash(await slash('staff', 'raid', { perms: F.KickMembers })) && (await slash('staff', 'raid', { perms: F.BanMembers })).ran, 'raid is a ban: Kick Members is not enough');
  // An administrator can do all of it.
  for (const umbrella of UMBRELLAS) for (const [name] of TABLES[umbrella]) assert.ok((await slash(umbrella, name)).ran, `an administrator can /${umbrella} ${name}`);
  // No member (never from a server, but a gate must not open for it).
  assert.ok(refusedSlash(await slash('staff', 'massban', { member: { id: ANA, guild: { ownerId: '1' }, roles: { cache: new Map() } } })));

  // The role a server chose with `!moderation` stands in for the Discord permission of that family only (`voice` and `nuke`).
  moderationRoles = { voice: [MODS], nuke: [MODS] };
  for (const name of ['voice-mute', 'voice-deafen', 'voice-move', 'voice-drag', 'nuke']) {
    const allowed = await slash('staff', name, { perms: 0n, roles: [MODS] });
    assert.ok(allowed.ran && allowed.ran.roleAllowed, `/staff ${name} runs for the role chosen for it, and the command knows it was that role`);
    assert.ok(refusedSlash(await slash('staff', name, { perms: 0n, roles: [] })), `/staff ${name} is still refused without it`);
    assert.ok((await send(`!staff ${name} ${TABLES.staff.find((row) => row[0] === name)[4]}`.trimEnd(), { perms: 0n, roles: [MODS] })).ran, `!staff ${name} runs for that role with the prefix`);
  }
  for (const name of ['thread-lock', 'imute', 'raid', 'massban', 'snipe']) assert.ok(refusedSlash(await slash('staff', name, { perms: 0n, roles: [MODS] })), `the role of voice and nuke is not a role for ${name}`);
  assert.equal((await slash('staff', 'voice-mute', { perms: F.MuteMembers })).ran.roleAllowed, false, 'with the permission and no role, the command is told it was not the role');
  moderationRoles = {};
  restoreSpies();

  // ------------------------------------------------------------ SECURITY: what the wrapped commands check by themselves still happens
  // The mass commands go through the real `massban`, which hands over to `ban`: the umbrella asked for Administrator first, and `ban` then
  // reads its own `users` subcommand, as it always did.
  // (`loadCommands` loads every file twice, so a mass command that was loaded before the command it hands over to holds an older copy of it;
  // each wrapper is loaded again here, so the copy it holds is the one that is spied on.)
  const savedModules = ['massban', 'masskick', 'massmute', 'massunban', 'massunmute', 'masswarn'].map((name) => {
    const file = require.resolve(commandFile(name).filePath);
    const saved = [file, require.cache[file]];
    delete require.cache[file];
    require(file);
    return saved;
  });
  spyOn(['ban', 'kick', 'mute', 'warn']);
  for (const [name, base, sub] of [['massban', 'ban', 'users'], ['masskick', 'kick', 'users'], ['massmute', 'mute', 'users'], ['massunban', 'ban', 'remove-all'], ['massunmute', 'mute', 'remove-users'], ['masswarn', 'warn', 'users']]) {
    const result = await slash('staff', name, { perms: F.Administrator, values: { users: `${BEA} ${CAL}`, reason: 'raid' } });
    assert.ok(result.ran, `/staff ${name} reaches ${base}`);
    assert.deepEqual([result.ran.file, result.ran.sub], [base, sub], `/staff ${name} is ${base} ${sub}, as ${name} always was`);
    assert.equal(result.ran.values.reason, 'raid');
    const refused = await slash('staff', name, { perms: F.BanMembers | F.KickMembers | F.ModerateMembers | F.ManageGuild, values: { users: `${BEA}`, reason: 'raid' } });
    assert.ok(refusedSlash(refused) && refused.called.length === 0, `/staff ${name} never reaches ${base} for a member who is not an administrator`);
    const viaPrefix = await send(`!staff ${name} <@${BEA}> <@${CAL}> raid`, { perms: F.Administrator });
    assert.deepEqual([viaPrefix.ran?.file, viaPrefix.ran?.sub], [base, sub], `!staff ${name} reaches ${base} ${sub} too`);
    assert.ok(!(await send(`!staff ${name} <@${BEA}> <@${CAL}> raid`, { perms: F.BanMembers })).ran);
  }
  restoreSpies();
  for (const [file, saved] of savedModules) require.cache[file] = saved;

  // ------------------------------------------------------------ the rules of a server
  assert.deepEqual(commandRules.ruleNames(commandFile('game'), { subcommand: 'cat' }), ['animal', 'game']);
  assert.deepEqual(commandRules.ruleNames(commandFile('game'), { subcommand: '8ball' }), ['8ball', 'game']);
  assert.deepEqual(commandRules.ruleNames(commandFile('me'), { subcommand: 'prefix-set' }), ['myprefix', 'me']);
  assert.deepEqual(commandRules.ruleNames(commandFile('search'), { subcommand: 'anilist' }), ['anilist', 'search']);
  assert.deepEqual(commandRules.ruleNames(commandFile('staff'), { subcommand: 'voice-mute' }), ['voice', 'staff']);
  assert.deepEqual(commandRules.ruleNames(commandFile('staff'), { subcommand: 'iunmute' }), ['imute', 'staff']);
  assert.deepEqual(commandRules.ruleNames(commandFile('staff'), {}), ['staff']);
  assert.deepEqual(commandRules.permissionNames(commandFile('staff'), { subcommand: 'massban' }), ['staff', 'massban']);
  for (const [umbrella, argText, expected] of [['game', '', null], ['game', 'cf', 'coinflip'], ['game', 'mc Notch', 'minecraft'], ['me', 'bday 1 1', 'birthday'], ['me', 'prefix-set p!', 'prefix-set'], ['search', 'yt lofi', 'youtube'], ['staff', 'mban <@1>', 'massban'], ['staff', 'voice-move <@1>', 'voice-move']]) {
    assert.equal(commandRules.subcommandOfText(commandFile(umbrella), argText), expected, `${umbrella} "${argText}" reaches ${expected}`);
  }

  spyOn(wrappedFiles);
  // A rule for the wrapped command stops the subcommand, and only that one.
  rules = [{ command: 'weather', channel_id: null }];
  let result = await slash('search', 'weather');
  assert.ok(refusedSlash(result), '/search weather is refused when weather is turned off');
  assert.ok(text(result.replies[0].payload).includes('/search weather'), 'the notice names it');
  assert.ok((await slash('search', 'time')).ran, '/search time still runs');
  for (const content of ['!search weather Bogota', '!search clima Bogota']) assert.ok(refusedPrefix(await send(content)), `${content} is refused when weather is turned off`);
  assert.ok(await ran('!search time Colombia'), '!search time still runs');
  assert.ok(!(await ran('!weather Bogota')), '!weather itself is refused too (as before)');
  rules = [{ command: 'animal', channel_id: null }];
  for (const name of ['cat', 'dog', 'fox']) assert.ok(refusedSlash(await slash('game', name)) && refusedPrefix(await send(`!game ${name}`)), `/game ${name} is refused when animal is turned off`);
  assert.ok((await slash('game', '8ball')).ran && (await slash('game', 'minecraft')).ran);
  rules = [{ command: 'voice', channel_id: null }];
  for (const [name] of TABLES.staff.filter((row) => row[1] === 'voice')) assert.ok(refusedSlash(await slash('staff', name)) && refusedPrefix(await send(`!staff ${name} <@${BEA}>`)), `/staff ${name} is refused when voice is turned off`);
  assert.ok((await slash('staff', 'nuke')).ran && (await slash('staff', 'imute')).ran);
  rules = [{ command: 'massban', channel_id: null }];
  assert.ok(refusedSlash(await slash('staff', 'massban')) && refusedPrefix(await send(`!staff mban <@${BEA}>`)) && (await slash('staff', 'masskick')).ran, 'a rule on massban stops only /staff massban');
  rules = [{ command: 'imute', channel_id: null }];
  assert.ok(refusedSlash(await slash('staff', 'imute')) && refusedSlash(await slash('staff', 'iunmute')) && (await slash('staff', 'rmute')).ran, 'imute covers both of its subcommands');
  // The name of the umbrella turns off all of it, and not the old commands.
  for (const umbrella of UMBRELLAS) {
    rules = [{ command: umbrella, channel_id: null }];
    for (const [name, , , , tail] of TABLES[umbrella]) {
      assert.ok(refusedSlash(await slash(umbrella, name)), `/${umbrella} ${name} is refused when ${umbrella} is turned off`);
      assert.ok(refusedPrefix(await send(`!${umbrella} ${name} ${tail}`.trimEnd())), `!${umbrella} ${name} is refused when ${umbrella} is turned off`);
    }
    assert.ok(refusedPrefix(await send(`!${umbrella}`)), `!${umbrella} alone is refused too`);
  }
  assert.ok(await ran('!8ball will it rain') && await ran('!birthday set 1 1') && await ran('!weather Bogota') && await ran(`!imute <@${BEA}>`) && await ran(`!massban <@${BEA}>`), 'the old commands are not touched by it');
  rules = [];
  // One channel only.
  rules = [{ command: 'coinflip', channel_id: ROOM }];
  result = await slash('game', 'coinflip', { channelId: ROOM });
  assert.ok(refusedSlash(result) && text(result.replies[0].payload).includes(`<#${ROOM}>`), 'refused in that channel, naming it');
  assert.ok((await slash('game', 'coinflip', { channelId: '666666666666666667' })).ran, 'allowed in another channel');
  assert.ok(refusedPrefix(await send('!game coinflip', { channelId: ROOM })) && (await send('!game coinflip', { channelId: '8' })).ran);
  rules = [];

  // A restriction to roles (`!restrictcommand`): the name of the wrapped command and the one of the umbrella.
  restrictions = { voice: [MODS] };
  result = await slash('staff', 'voice-mute', { perms: F.MuteMembers });
  assert.ok(!result.ran && result.replies[0].payload.content.includes(`<@&${MODS}>`), '/staff voice-mute asks for the role of voice');
  assert.ok((await slash('staff', 'voice-mute', { perms: F.MuteMembers, roles: [MODS] })).ran, 'with the role (and the permission) it runs');
  assert.ok((await slash('staff', 'voice-mute')).ran, 'an administrator always can');
  assert.ok((await slash('staff', 'nuke', { perms: F.ManageChannels })).ran, 'another subcommand is not restricted');
  assert.match((await send(`!staff voice-mute <@${BEA}>`, { perms: F.MuteMembers })).sent.join(''), new RegExp(MODS), 'the prefix asks for the role too');
  restrictions = { massban: [MODS] };
  assert.ok((await slash('staff', 'massban', { roles: [MODS] })).ran && (await slash('staff', 'masskick', { perms: F.Administrator })).ran, 'a restriction on massban does not reach masskick');
  restrictions = { search: [MODS] };
  assert.ok(!(await slash('search', 'weather', { perms: 0n })).ran && !(await slash('search', 'github', { perms: 0n })).ran && !(await ran('!search time Colombia', { perms: 0n })), 'a restriction on search asks for the role in every subcommand');
  assert.ok(await ran('!weather Bogota', { perms: 0n }), 'and not for the old commands');
  assert.ok((await slash('search', 'weather')).ran, 'an administrator always can');
  restrictions = { game: [MODS] };
  assert.ok(!(await slash('game', '8ball', { perms: 0n })).ran && (await slash('game', '8ball', { perms: 0n, roles: [MODS] })).ran);
  restrictions = {};

  // A permission level (`!permissions`): the one of the wrapped command, and the one of the umbrella.
  levelDenied = new Set(['voice']);
  assert.ok(!(await slash('staff', 'voice-mute')).ran && !(await ran('!staff voice-mute <@2>')) && (await slash('staff', 'nuke')).ran && (await ran('!staff nuke')), 'the level of voice is asked of its subcommands only');
  levelDenied = new Set(['staff']);
  assert.ok(!(await slash('staff', 'nuke')).ran && !(await ran('!staff nuke')), 'the level of /staff is asked for all of it');
  levelDenied = new Set(['birthday']);
  assert.ok(!(await slash('me', 'birthday-remove')).ran && (await slash('me', 'rep')).ran && !(await ran('!me birthday 1 1')));
  levelDenied = new Set(['search']);
  assert.ok(!(await slash('search', 'wiki')).ran && !(await ran('!search wiki')));
  levelDenied = new Set();
  restoreSpies();

  // ------------------------------------------------------------ Discord: registered, translated, inside the limits
  const registered = collectCommandData();
  const chat = registered.filter((each) => (each.type ?? 1) === 1);
  assert.equal(registered.length, 38, '38 commands registered with Discord (the 34 there were and /game, /me, /search and /staff)');
  assert.equal(chat.length, 35, '35 of them slash commands (3 are menus)');
  assert.ok(chat.length <= 100, 'far from the 100 slash commands Discord allows');
  const deployed = [];
  await require('../src/handlers/deployCommands').deployCommands({ rest: { put: async (_route, { body }) => { deployed.push(...body); return body; }, get: async () => [] }, settings: { getSetting: async () => null, setSetting: async () => {} }, force: true });
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
  for (const umbrella of NEW_SLASH) {
    const registeredCommand = registered.find((each) => each.name === umbrella);
    assert.ok(registeredCommand, `/${umbrella} is registered with Discord, so deploy-commands.js sends it`);
    assert.ok(registeredCommand.options.length <= 25, `/${umbrella} has ${registeredCommand.options.length} subcommands (at most 25)`);
    assert.ok(deployed.some((each) => each.name === umbrella && each.options.length === TABLES[umbrella].length), `deploy-commands.js sends /${umbrella} to Discord`);
    walk(registeredCommand, `/${umbrella}`);
    assert.notEqual(registeredCommand.description_localizations['es-ES'], registeredCommand.description);
    assert.notEqual(registeredCommand.description_localizations['pt-BR'], registeredCommand.description);
    for (const sub of registeredCommand.options) {
      assert.ok(sub.description_localizations['es-ES'] && sub.description_localizations['pt-BR'], `/${umbrella} ${sub.name} is translated`);
      assert.ok(sub.options?.length === undefined || sub.options.every((option) => option.description_localizations?.['es-ES'] && option.description_localizations?.['pt-BR']), `the options of /${umbrella} ${sub.name} are translated`);
    }
    // What Discord counts of a command: names, descriptions, choices and values, in each language, at most 8000.
    for (const locale of [null, ...LOCALES]) {
      let total = 0;
      const add = (node) => {
        total += size(node.name) + size((locale && node.description_localizations?.[locale]) || node.description);
        for (const choice of node.choices ?? []) total += size(choice.name) + size(choice.value);
        for (const child of node.options ?? []) add(child);
      };
      add(registeredCommand);
      assert.ok(total < 8000, `/${umbrella}${locale ? ` [${locale}]` : ''} is ${total} characters (Discord allows 8000)`);
    }
    // Every key of the English catalog of the umbrella has its Spanish and Portuguese text.
    for (const key of Object.keys(CATALOGS.en).filter((each) => each.startsWith(`cmd.${CATEGORY[umbrella]}.${umbrella}.`))) assert.ok(CATALOGS.es[key] && CATALOGS['pt-BR'][key], `${key} is in es and pt-BR`);
  }
  // The Spanish and Portuguese of a subcommand are the ones of the command it wraps.
  const es = registered.find((each) => each.name === 'game').options.find((sub) => sub.name === 'coinflip').description_localizations['es-ES'];
  assert.equal(es, CATALOGS.es['cmd.fun.coinflip.desc']);
  assert.equal(registered.find((each) => each.name === 'staff').options.find((sub) => sub.name === 'voice-mute').description_localizations['pt-BR'], CATALOGS['pt-BR']['cmd.moderation.voice.mute.desc']);

  // ------------------------------------------------------------ the short aliases
  for (const umbrella of UMBRELLAS) {
    const own = Object.entries(SHORT_ALIAS_TABLE).filter(([, target]) => target.startsWith(`${umbrella} `));
    assert.ok(own.length >= TABLES[umbrella].length - 3, `/${umbrella} has a short alias for nearly every subcommand (${own.length} of ${TABLES[umbrella].length})`);
    for (const [alias, target] of own) {
      const route = client.commandRoutes.get(alias);
      assert.ok(route && route.short && route.command === umbrella && route.subcommand === target.slice(umbrella.length + 1), `${alias} is the short alias of ${target}`);
      assert.ok(TABLES[umbrella].some((row) => row[0] === target.slice(umbrella.length + 1)), `${target} is a subcommand that exists`);
    }
  }
  spyOn(wrappedFiles);
  const shortOf = (target) => Object.entries(SHORT_ALIAS_TABLE).find(([, value]) => value === target)[0];
  call = await ran(`!${shortOf('game 8ball')} will it rain`);
  assert.deepEqual([call.file, call.values.question], ['8ball', 'will it rain'], 'a short alias runs the subcommand');
  call = await ran(`!${shortOf('search weather')} Bogota`);
  assert.deepEqual([call.file, call.values.place], ['weather', 'Bogota']);
  assert.ok(!(await send(`!${shortOf('staff massban')} <@${BEA}>`, { perms: F.BanMembers })).ran, 'a short alias asks for the permission too');
  assert.ok((await send(`!${shortOf('staff massban')} <@${BEA}>`, { perms: F.Administrator })).ran);
  assert.ok(!(await send(`!${shortOf('staff nuke')}`, { perms: F.ManageMessages })).ran && (await send(`!${shortOf('staff nuke')}`, { perms: F.ManageChannels })).ran);
  restoreSpies();
  for (const umbrella of UMBRELLAS) assert.equal(await event.knownNameChecker(client, '1')(umbrella), umbrella !== 'me');

  console.log('check-umbrellas-2: ok');
  setTimeout(() => process.exit(0), 10);
})().catch((err) => { console.error(err); process.exit(1); });
