// Checks the umbrella command /mod (src/commands/moderation/mod.js, utils/umbrella.js):
//   - its 25 subcommands exist, take the options of the command they wrap (the same names, types, limits and choices) and run that command's
//     own code, with the slash command and with the prefix (`!mod ban @x spam`, `!mod k @x`, `!mod purge bots 50`); `!mod` alone lists them;
//   - SECURITY: Discord checks the permissions of a whole command, never of one subcommand, so /mod is open and each subcommand asks, when
//     it runs, for the permission of the command it wraps (or the role chosen with `!moderation`), for the slash command and the prefix
//     alike; a member with only Kick Members cannot `/mod ban`, and what the wrapped commands check by themselves (the hierarchy, the
//     permission of the bot) still happens;
//   - the old commands keep their words, routes and slash commands; a rule of a server (turned off, restricted, a permission level) on the
//     wrapped command, or on `mod`, stops the subcommand;
//   - the descriptions are translated for Discord, the short aliases are in the table, and the number and size of the slash commands stay
//     inside what Discord allows (67 registered now, 64 of them slash commands: the third batch of umbrellas, scripts/check-umbrellas-3.js, adds the rest; before it were 38 and 35: the second batch of umbrellas, scripts/check-umbrellas-2.js, adds four).
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');
const { ApplicationCommandOptionType, MessageFlags, PermissionFlagsBits, PermissionsBitField, SlashCommandBuilder } = require('discord.js');

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
let moderationRoles = {}; // command -> role ids chosen with `!moderation` (`ban`: the family of ban, hardban and tempban)
const guildRow = { prefix: '!', prefixes: ['!', 'petto', ','] };
const resolveContexts = [];
const cases = [];
const sanctionsSent = [];
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
patch('src/db/modActions.js', { createCase: async (row) => { cases.push(row); return { ...row, case_number: cases.length }; } });
patch('src/utils/caseLog.js', { logSanction: async () => {} });
patch('src/utils/sanctionTemplates.js', { sanctionDM: async () => ({ content: 'dm' }), sanctionReply: async (interaction, data) => { sanctionsSent.push(data.type); } });
patch('src/utils/userResolve.js', { resolveUser: async (client, token, guild, context) => { resolveContexts.push(context); const id = String(token).replace(/\D/g, ''); return id ? { id } : null; } });
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
const { SHORT_ALIAS_TABLE } = require('../src/utils/shortAliases');
const { copyOptions, wrapInteraction } = require('../src/utils/umbrella');
const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');

const client = { user: { id: '123' }, users: { fetch: async (id) => ({ id, username: `user${id.slice(-3)}` }) } };
loadCommands(client);
const mod = client.commands.get('mod');
const modFile = (name) => require(path.join(root, 'src', 'commands', 'moderation', `${name}.js`));
const subcommandsOf = (command) => command.data.toJSON().options;
const F = PermissionFlagsBits;

// What each subcommand does: the module whose own code answers (the base command: `/mod tempban` goes through `/tempban` into `ban`) and the
// subcommand that code reads (null: the command has none).
const RUNS = {
  ban: ['ban', 'user'], kick: ['kick', 'user'], mute: ['mute', 'user'], tempmute: ['mute', 'temp'], unmute: ['mute', 'remove'], warn: ['warn', 'user'],
  softban: ['softban', null], tempban: ['ban', 'temp'], unban: ['ban', 'remove'], hardban: ['ban:hard', 'user'], note: ['note', 'add'], case: ['case', 'view'],
  history: ['history', null], jail: ['jail', 'user'], unjail: ['jail', 'remove'], nickname: ['nickname', 'set'], stripstaff: ['stripstaff', null], purge: ['purge', null],
  lockdown: ['lockdown', 'start'], unlockdown: ['lockdown', 'end'], clearinvites: ['clearinvites', null], pauseinvites: ['pauseinvites', null],
  lock: ['channel', 'lock'], unlock: ['channel', 'unlock'], slowmode: ['channel', 'slowmode'],
};
// The command each one wraps (its file) and the subcommand of it that it stands for, as the builder shows.
const WRAPS = {
  ban: ['ban', 'user'], kick: ['kick', 'user'], mute: ['mute', 'user'], tempmute: ['tempmute'], unmute: ['unmute'], warn: ['warn', 'user'], softban: ['softban'], tempban: ['tempban'],
  unban: ['unban'], hardban: ['hardban'], note: ['note', 'add'], case: ['case', 'view'], history: ['history'], jail: ['jail', 'user'], unjail: ['unjail'], nickname: ['nickname', 'set'],
  stripstaff: ['stripstaff'], purge: ['purge'], lockdown: ['lockdown', 'start'], unlockdown: ['lockdown', 'end'], clearinvites: ['clearinvites'], pauseinvites: ['pauseinvites'],
  lock: ['channel', 'lock'], unlock: ['channel', 'unlock'], slowmode: ['channel', 'slowmode'],
};
// What each one asks of the member: what the old command is registered with.
const NEEDS = {
  ban: 'BanMembers', kick: 'KickMembers', mute: 'ModerateMembers', tempmute: 'ModerateMembers', unmute: 'ModerateMembers', warn: 'ModerateMembers', softban: 'BanMembers', tempban: 'BanMembers',
  unban: 'BanMembers', hardban: 'BanMembers', note: 'ModerateMembers', case: 'ModerateMembers', history: 'ModerateMembers', jail: 'ModerateMembers', unjail: 'ModerateMembers',
  nickname: 'ManageNicknames', stripstaff: 'Administrator', purge: 'ManageMessages', lockdown: 'Administrator', unlockdown: 'Administrator', clearinvites: 'ManageGuild',
  pauseinvites: 'Administrator', lock: 'ManageChannels', unlock: 'ManageChannels', slowmode: 'ManageChannels',
};

// What to type after the word of a subcommand that does not take a member (an amount, a number, a time or nothing).
const TAILS = { purge: '5', lock: '', unlock: '', slowmode: '5', case: '3', lockdown: '', unlockdown: '', clearinvites: '', pauseinvites: '1h' };
const GUILD = '444444444444444444';
const ROOM = '666666666666666666';
const ANA = '111111111111111111';
const BEA = '222222222222222222';
const MODS = '900000000000000001';

/** Replaces the code of the base commands with a spy that records what it was asked, the way the real one reads it. */
const calls = [];
const originals = [];
function spyOnBase() {
  const record = (file) => async function spy(interaction) {
    const opt = interaction.options;
    const read = (method, name) => { try { return opt[method](name, false); } catch { return null; } };
    const entry = { file, sub: opt.getSubcommand(false), group: opt.getSubcommandGroup(false), commandName: interaction.commandName, roleAllowed: Boolean(interaction.pettoModerationRoleAllowed), interaction };
    entry.user = read('getUser', 'user')?.id ?? null;
    entry.channel = read('getChannel', 'channel')?.id ?? null;
    for (const name of ['reason', 'duration', 'note', 'nickname', 'filter', 'text']) entry[name] = read('getString', name);
    for (const name of ['delete_message_days', 'amount', 'case', 'minutes', 'seconds']) entry[name] = read('getInteger', name);
    calls.push(entry);
  };
  for (const file of ['ban', 'kick', 'mute', 'warn', 'softban', 'note', 'case', 'history', 'jail', 'nickname', 'stripstaff', 'purge', 'lockdown', 'clearinvites', 'pauseinvites', 'channel']) {
    const module = modFile(file);
    originals.push([module, 'execute', module.execute]);
    module.execute = record(file);
  }
  const ban = modFile('ban');
  originals.push([ban, 'hardBanUser', ban.hardBanUser]);
  ban.hardBanUser = record('ban:hard');
}
const restoreBase = () => { for (const [module, key, value] of originals.splice(0)) module[key] = value; };

// ---------------------------------------------------------------- the slash command, through the real handler
let seq = 0;
const memberWith = (perms, roles = []) => ({
  id: ANA, guild: { ownerId: '1' }, permissions: new PermissionsBitField(perms), roles: { cache: new Map(roles.map((id) => [id, {}])), highest: { position: 10 } },
});
/** `/mod <sub>` through interactionCreate: `{ replies, called, ran, interaction }`; `perms`: what the member has (a bit field or a flag). */
async function slash(sub, { values = {}, channelId = ROOM, perms = PermissionFlagsBits.Administrator, roles = [], guild = {}, member = null } = {}) {
  seq += 1;
  const replies = [];
  const before = calls.length;
  const pick = (name) => values[name] ?? null;
  const base = {
    id: `7777777777777777${String(10 + seq)}`, commandName: 'mod', commandType: 1, user: { id: ANA, username: 'Ana' },
    guild: { id: GUILD, ownerId: '1', name: 'Petto Test', ...guild }, guildId: GUILD, channelId, channel: { id: channelId },
    member: member ?? memberWith(perms, roles),
    locale: 'en-US', pettoLang: 'en', client,
    options: {
      getSubcommand: () => sub, getSubcommandGroup: () => null,
      getUser: (name) => (pick(name) ? { id: pick(name) } : null), getChannel: (name) => (pick(name) ? { id: pick(name) } : null), getRole: (name) => (pick(name) ? { id: pick(name) } : null),
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
  return { replies, called, ran: called[0] ?? null, interaction };
}
const text = (payload) => JSON.stringify((payload.components ?? []).map((component) => component.toJSON?.() ?? component)) + (payload.content ?? '');
const ephemeral = (reply) => reply?.how === 'reply' && (reply.payload.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral;
const refusedSlash = (result) => !result.ran && ephemeral(result.replies.find((reply) => reply.how === 'reply'));

// ---------------------------------------------------------------- the prefix, through the real message handler
let n = 0;
/** A message such as `!mod ban @x`: `{ called, sent, ran }`. */
async function send(content, { channelId = '5', perms = PermissionFlagsBits.Administrator, roles = [] } = {}) {
  const sent = [];
  const before = calls.length;
  const message = {
    content, author: { id: ANA, bot: false }, guild: { id: `7${n++}`, name: 'Petto Test', members: { cache: new Map(), fetch: async () => new Map() }, channels: { cache: new Map() } }, client,
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
  // ------------------------------------------------------------ the command exists, once, in the moderation category
  assert.ok(mod, '/mod is loaded');
  assert.equal(mod.category, 'moderation');
  assert.ok(!mod.hiddenFromHelp && !mod.slashOnly && !mod.prefixOnly, '/mod is a prefix and a slash command, shown in !help');
  assert.equal(mod.registerSlash, true);
  assert.equal(mod.rulesBySubcommand, true);
  assert.equal(mod.listSubcommandsWhenEmpty, true);
  const json = mod.data.toJSON();
  assert.equal(json.dm_permission, false);
  // Discord checks this per command, not per subcommand: any bound would hide /mod from the members who may use some of it. The subcommands ask for their own.
  assert.equal(json.default_member_permissions ?? null, null, '/mod is open: each subcommand asks for the permission of what it wraps when it runs');
  const names = subcommandsOf(mod).map((sub) => sub.name);
  assert.deepEqual(names, Object.keys(RUNS));
  assert.equal(names.length, 25, '25 subcommands, the most Discord allows');
  assert.ok(subcommandsOf(mod).every((sub) => sub.type === ApplicationCommandOptionType.Subcommand));
  assert.equal(client.commandAliases.has('mod') || client.commandRoutes.has('mod'), false, '`mod` was not a word of anything else');

  // Each subcommand has the description and the options of what it wraps: the same names, types, required flags, limits and choices.
  const shape = (options) => (options ?? []).map((option) => [option.name, option.type, Boolean(option.required), option.description, option.channel_types ?? null, option.choices ?? null, option.min_value ?? null, option.max_value ?? null, option.min_length ?? null, option.max_length ?? null]);
  for (const [name, [file, sub]] of Object.entries(WRAPS)) {
    const own = subcommandsOf(mod).find((each) => each.name === name);
    const wrapped = modFile(file).data.toJSON();
    const node = sub ? wrapped.options.find((option) => option.name === sub) : wrapped;
    assert.ok(node, `${file} ${sub ?? ''} exists`);
    assert.equal(own.description, node.description, `/mod ${name} describes itself like ${file} ${sub ?? ''}`);
    assert.deepEqual(shape(own.options), shape(node.options), `/mod ${name} takes the options of ${file} ${sub ?? ''}`);
    assert.deepEqual(mod.ruleKeys[name], file, `the rules of /mod ${name} are the ones of ${file}`);
  }
  const optionsOf = (name) => (subcommandsOf(mod).find((sub) => sub.name === name).options ?? []).map((option) => `${option.name}:${option.type}:${Boolean(option.required)}`);
  assert.deepEqual(optionsOf('ban'), ['user:6:true', 'delete_message_days:4:false', 'reason:3:false']);
  assert.deepEqual(optionsOf('tempban'), ['user:6:true', 'duration:3:true', 'delete_message_days:4:false', 'reason:3:false']);
  assert.deepEqual(optionsOf('warn'), ['user:6:true', 'reason:3:true']);
  assert.deepEqual(optionsOf('case'), ['case:4:true']);
  assert.deepEqual(optionsOf('unlockdown'), []);
  const ban = subcommandsOf(mod).find((sub) => sub.name === 'ban');
  assert.deepEqual([ban.options[1].min_value, ban.options[1].max_value], [0, 7], 'the limits of an option go with it: Discord refuses 30 days of messages');
  const purge = subcommandsOf(mod).find((sub) => sub.name === 'purge');
  assert.ok(purge.options.find((option) => option.name === 'filter').choices.length > 5, 'the choices of purge go with it');
  assert.equal(purge.options.find((option) => option.name === 'text').max_length, 100);

  // The umbrella copies every type of option, with its limits.
  const sample = new SlashCommandBuilder().setName('x').setDescription('x').addSubcommand((sub) => {
    sub.setName('y').setDescription('y');
    copyOptions(sub, [
      { type: ApplicationCommandOptionType.Number, name: 'ratio', description: 'r', required: true, min_value: 0.5, max_value: 2.5 },
      { type: ApplicationCommandOptionType.Mentionable, name: 'who', description: 'w' },
      { type: ApplicationCommandOptionType.Attachment, name: 'file', description: 'f' },
      { type: ApplicationCommandOptionType.String, name: 'kind', description: 'k', choices: [{ name: 'One', value: '1' }], min_length: 1, max_length: 5 },
    ]);
    return sub;
  }).toJSON().options[0].options;
  assert.deepEqual(sample.map((option) => [option.name, option.type, Boolean(option.required)]), [['ratio', 10, true], ['who', 9, false], ['file', 11, false], ['kind', 3, false]]);
  assert.deepEqual([sample[0].min_value, sample[0].max_value, sample[3].choices.map((choice) => [choice.name, choice.value]), sample[3].min_length, sample[3].max_length], [0.5, 2.5, [['One', '1']], 1, 5]);

  // The interaction a wrapped command gets: its own subcommand, the state of the real one.
  {
    const real = { options: { getSubcommand: () => 'ban', getString: (name) => `value-${name}` }, deferred: false, commandName: 'mod', async deferReply() { this.deferred = true; } };
    const wrapped = wrapInteraction(real, { subcommand: 'user', overrides: { commandName: 'ban' } });
    assert.equal(wrapped.options.getSubcommand(), 'user');
    assert.equal(wrapped.options.getSubcommandGroup(false), null);
    assert.equal(wrapped.options.getString('reason'), 'value-reason', 'the options are the real ones');
    assert.equal(wrapped.commandName, 'ban');
    await wrapped.deferReply();
    assert.equal(real.deferred, true, 'what the command does to the interaction is seen by the handler (it decides how to tell an error)');
    const none = wrapInteraction(real, {});
    assert.equal(none.options.getSubcommand(false), null, 'a command with no subcommands has none');
    assert.throws(() => none.options.getSubcommand(), /No subcommand/, 'and asking for one as required fails, as with Discord');
    const copy = Object.create(wrapped); // what `asSubcommand` does on top of it
    copy.options = Object.create(wrapped.options);
    copy.options.getSubcommand = () => 'temp';
    assert.equal(copy.options.getSubcommand(), 'temp');
    assert.equal(wrapped.options.getSubcommand(), 'user', 'a copy made on top does not change the wrapped interaction');
  }

  // ------------------------------------------------------------ the slash command runs the code of the old command, with its options
  spyOnBase();
  const VALUES = { user: BEA, reason: 'because', duration: '1d', note: 'a note', nickname: 'Nick', filter: 'bots', text: 'hello', channel: ROOM, delete_message_days: 3, amount: 20, case: 7, minutes: 15, seconds: 30 };
  for (const [name, [file, sub]] of Object.entries(RUNS)) {
    const result = await slash(name, { values: VALUES });
    assert.ok(result.ran, `/mod ${name} runs something`);
    assert.equal(result.ran.file, file, `/mod ${name} runs the code of ${file}`);
    assert.equal(result.ran.sub, sub, `/mod ${name} gives ${file} the subcommand ${sub}`);
    assert.equal(result.ran.group, null);
  }
  let r = (await slash('ban', { values: VALUES })).ran;
  assert.deepEqual([r.user, r.reason, r.delete_message_days, r.commandName], [BEA, 'because', 3, 'ban'], '/mod ban passes its options and is `ban` to the code');
  r = (await slash('tempban', { values: VALUES })).ran;
  assert.deepEqual([r.user, r.duration, r.reason, r.delete_message_days], [BEA, '1d', 'because', 3], '/mod tempban goes through /tempban into ban temp with its options');
  assert.equal((await slash('unban', { values: VALUES })).ran.commandName, 'unban');
  assert.equal((await slash('warn', { values: VALUES })).ran.reason, 'because');
  assert.equal((await slash('note', { values: VALUES })).ran.note, 'a note');
  assert.equal((await slash('case', { values: VALUES })).ran.case, 7);
  assert.equal((await slash('nickname', { values: VALUES })).ran.nickname, 'Nick');
  r = (await slash('purge', { values: VALUES })).ran;
  assert.deepEqual([r.amount, r.filter, r.text, r.user], [20, 'bots', 'hello', BEA]);
  assert.equal((await slash('lockdown', { values: VALUES })).ran.minutes, 15);
  r = (await slash('slowmode', { values: VALUES })).ran;
  assert.deepEqual([r.sub, r.seconds, r.channel], ['slowmode', 30, ROOM]);
  assert.equal((await slash('history', { values: { user: BEA } })).ran.user, BEA);
  // The wrapped commands see the interaction as it came: what they set is what the handler reads.
  const first = await slash('kick', { values: VALUES });
  assert.equal(first.ran.interaction.options.getSubcommand(false), 'user');

  // ------------------------------------------------------------ SECURITY: the permission of each wrapped command, slash and prefix
  for (const [name, flag] of Object.entries(NEEDS)) {
    const [file, sub] = WRAPS[name];
    const wrapped = modFile(file).data.toJSON();
    assert.equal(BigInt(wrapped.default_member_permissions), F[flag], `${file} is registered with ${flag}: what /mod ${name} asks for`);
    assert.equal(mod.permissionForSubcommand(name), F[flag], `!help mod ${name} says ${flag}`);
    const wrong = flag === 'ManageGuild' ? F.ManageMessages : F.ManageGuild;
    // Slash
    assert.equal((await slash(name, { perms: F[flag], values: VALUES })).ran?.file, RUNS[name][0], `/mod ${name} runs for a member with ${flag}`);
    for (const [label, perms] of [['nothing', 0n], ['another permission', wrong]]) {
      const denied = await slash(name, { perms, values: VALUES });
      assert.ok(refusedSlash(denied), `/mod ${name} is refused to a member with ${label}`);
      assert.match(text(denied.replies.find((reply) => reply.how === 'reply').payload), new RegExp(`You need the \\*\\*${flag}\\*\\* permission`), `and says ${flag}`);
    }
    // Prefix
    const wordFor = name;
    const tail = name in TAILS ? TAILS[name] : `<@${BEA}> x`;
    { const got = await send(`!mod ${wordFor} ${tail}`, { perms: F[flag] }); assert.equal(got.ran?.file, RUNS[name][0], `!mod ${name} runs for a member with ${flag}: ${got.sent.join("")}`); }
    const deniedPrefix = await send(`!mod ${wordFor} ${tail}`, { perms: wrong });
    assert.ok(!deniedPrefix.ran && deniedPrefix.sent.length === 1 && deniedPrefix.sent[0].includes(`**${flag}**`), `!mod ${name} is refused to a member with another permission, saying ${flag}`);
    assert.ok(!(await send(`!mod ${wordFor} ${tail}`, { perms: 0n })).ran, `!mod ${name} is refused to a member with nothing`);
  }
  // The two the owner named: Kick Members is not Ban Members.
  assert.ok(refusedSlash(await slash('ban', { perms: F.KickMembers })) && refusedSlash(await slash('hardban', { perms: F.KickMembers })) && refusedSlash(await slash('tempban', { perms: F.KickMembers })));
  assert.equal((await slash('kick', { perms: F.KickMembers })).ran?.file, 'kick');
  assert.equal((await slash('ban', { perms: F.BanMembers })).ran?.file, 'ban');
  assert.ok(!(await send(`!mod ban <@${BEA}>`, { perms: F.KickMembers })).ran && (await send(`!mod kick <@${BEA}>`, { perms: F.KickMembers })).ran);
  assert.ok((await send(`!mod ban <@${BEA}>`, { perms: F.BanMembers })).ran);
  // An administrator can do all of it.
  for (const name of Object.keys(RUNS)) assert.ok((await slash(name)).ran, `an administrator can /mod ${name}`);
  // The refusal has no side effect: the wrapped command did not even start (nothing was deferred or answered but the refusal).
  const refusal = await slash('purge', { perms: F.ManageChannels });
  assert.equal(refusal.replies.length, 1);
  // No member (never from a server, but a gate must not open for it).
  assert.ok(refusedSlash(await slash('ban', { member: { id: ANA, guild: { ownerId: '1' }, roles: { cache: new Map() } } })));

  // The role a server chose with `!moderation` stands in for the Discord permission of that family only.
  moderationRoles = { ban: [MODS], hardban: [MODS], tempban: [MODS], warn: [MODS] };
  for (const name of ['ban', 'hardban', 'tempban', 'warn']) {
    const allowed = await slash(name, { perms: 0n, roles: [MODS] });
    assert.ok(allowed.ran && allowed.ran.roleAllowed, `/mod ${name} runs for the role chosen for it, and the command knows it was that role`);
    assert.ok(refusedSlash(await slash(name, { perms: 0n, roles: [] })), `/mod ${name} is still refused without it`);
    assert.ok((await send(`!mod ${name} <@${BEA}> x`, { perms: 0n, roles: [MODS] })).ran, `!mod ${name} runs for that role with the prefix`);
  }
  assert.ok(refusedSlash(await slash('kick', { perms: 0n, roles: [MODS] })), 'the role of ban is not a role for kick');
  assert.ok(refusedSlash(await slash('unban', { perms: 0n, roles: [MODS] })), 'nor for unban');
  assert.equal((await slash('ban', { perms: F.BanMembers })).ran.roleAllowed, false, 'with the permission and no role, the command is told it was not the role');
  moderationRoles = {};
  restoreBase();

  // ------------------------------------------------------------ SECURITY: what the wrapped commands check by themselves still happens
  // Real code now: `/mod ban` and `/mod kick` reach `ban` and `kick`, with a fake server.
  const bans = [];
  const kicks = [];
  const target = (position, extra = {}) => ({ id: BEA, roles: { highest: { position } }, bannable: true, kickable: true, moderatable: true, permissions: new PermissionsBitField(0n), send: async () => ({}), kick: async (why) => kicks.push(why), ...extra });
  const serverWith = ({ me = [F.BanMembers, F.KickMembers], targetMember = target(5) } = {}) => ({
    ownerId: '1', members: { me: { id: '123', permissions: new PermissionsBitField(me) }, fetch: async () => targetMember, ban: async (id, options) => { bans.push({ id, options }); } },
  });
  let real = await slash('ban', { perms: F.BanMembers, values: { user: BEA, reason: 'spam' }, guild: serverWith() });
  assert.equal(bans.length, 1, 'a member with Ban Members bans through /mod ban');
  assert.deepEqual([bans[0].id, bans[0].options.reason], [BEA, 'spam']);
  assert.deepEqual(cases.map((row) => [row.type, row.userId, row.moderatorId, row.reason]), [['ban', BEA, ANA, 'spam']], 'the sanction case is made by the same code');
  assert.deepEqual(sanctionsSent, ['ban']);
  assert.ok(real.replies.some((reply) => reply.how === 'defer'));
  real = await slash('ban', { perms: F.BanMembers, values: { user: BEA }, guild: serverWith({ targetMember: target(10) }) });
  assert.equal(bans.length, 1, 'a target with a role as high as the moderator is still refused by the hierarchy');
  assert.match(text(real.replies.find((reply) => reply.how === 'reply').payload), /equal to or higher than yours/);
  real = await slash('ban', { perms: F.BanMembers, values: { user: BEA }, guild: serverWith({ targetMember: target(5, { bannable: false }) }) });
  assert.equal(bans.length, 1, 'a member above the bot is refused');
  assert.match(text(real.replies.find((reply) => reply.how === 'reply').payload), /cannot ban this member/);
  real = await slash('ban', { perms: F.BanMembers, values: { user: BEA }, guild: serverWith({ me: [F.KickMembers] }) });
  assert.equal(bans.length, 1, 'when the bot has no Ban Members it says so, and does not ban');
  assert.match(text(real.replies.find((reply) => reply.how === 'reply').payload), /I need the \*\*BanMembers\*\* permission/);
  real = await slash('ban', { perms: F.KickMembers, values: { user: BEA }, guild: serverWith() });
  assert.equal(bans.length, 1, 'a member with only Kick Members does not ban through the real code either');
  assert.ok(refusedSlash(real));
  real = await slash('ban', { perms: F.BanMembers, values: { user: ANA }, guild: serverWith({ targetMember: target(5, { id: ANA }) }) });
  assert.equal(bans.length, 1, 'nobody bans themselves');
  real = await slash('kick', { perms: F.KickMembers, values: { user: BEA, reason: 'x' }, guild: serverWith() });
  assert.equal(kicks.length, 1, 'a member with Kick Members kicks through /mod kick');
  real = await slash('kick', { perms: F.KickMembers, values: { user: BEA }, guild: serverWith({ targetMember: target(5, { kickable: false }) }) });
  assert.equal(kicks.length, 1);
  assert.match(text(real.replies.find((reply) => reply.how === 'reply').payload), /cannot kick this member/);
  real = await slash('kick', { perms: F.KickMembers, values: { user: BEA }, guild: serverWith({ me: [F.BanMembers] }) });
  assert.equal(kicks.length, 1);
  assert.match(text(real.replies.find((reply) => reply.how === 'reply').payload), /I need the \*\*KickMembers\*\* permission/);
  // The same run with the role of the server: it replaces the permission of the member, never the hierarchy or the bot.
  moderationRoles = { ban: [MODS] };
  await slash('ban', { perms: 0n, roles: [MODS], values: { user: BEA }, guild: serverWith() });
  assert.equal(bans.length, 2, 'the chosen role bans');
  await slash('ban', { perms: 0n, roles: [MODS], values: { user: BEA }, guild: serverWith({ targetMember: target(10) }) });
  assert.equal(bans.length, 2, 'but the hierarchy still counts for it');
  await slash('ban', { perms: 0n, roles: [MODS], values: { user: BEA }, guild: serverWith({ me: [] }) });
  assert.equal(bans.length, 2, 'and so does the permission of the bot');
  moderationRoles = {};

  // ------------------------------------------------------------ the prefix: `!mod ban`, the old words, and `!mod` alone
  spyOnBase();
  const ran = async (content, opts) => (await send(content, opts)).ran;
  let call = await ran(`!mod ban <@${BEA}> spamming a lot`);
  assert.deepEqual([call.file, call.sub, call.user, call.reason, call.commandName], ['ban', 'user', BEA, 'spamming a lot', 'ban'], '!mod ban @x reason');
  call = await ran(`,mod ban <@${BEA}> 3`);
  assert.equal(call.user, BEA, 'with another prefix too');
  call = await ran(`!mod ban <@${BEA}> 5 for ads`);
  assert.deepEqual([call.delete_message_days, call.reason], [5, 'for ads'], 'the days of messages, when written');
  call = await ran(`!mod tempban <@${BEA}> 2d ads`);
  assert.deepEqual([call.file, call.sub, call.duration, call.reason], ['ban', 'temp', '2d', 'ads']);
  call = await ran(`!mod k <@${BEA}> rude`);
  assert.deepEqual([call.file, call.user, call.reason], ['kick', BEA, 'rude'], 'the old word `k` is `kick`');
  call = await ran(`!mod to <@${BEA}> 10m calm down`);
  assert.deepEqual([call.file, call.sub, call.duration, call.reason], ['mute', 'temp', '10m', 'calm down'], '`to` (timeout) is tempmute');
  call = await ran(`!mod w <@${BEA}> second warning`);
  assert.deepEqual([call.file, call.sub, call.reason], ['warn', 'user', 'second warning']);
  call = await ran(`!mod note <@${BEA}> keeps arguing`);
  assert.deepEqual([call.file, call.sub, call.note], ['note', 'add', 'keeps arguing']);
  call = await ran('!mod case 12');
  assert.deepEqual([call.file, call.sub, call.case], ['case', 'view', 12]);
  call = await ran(`!mod nick <@${BEA}> New Name`);
  assert.deepEqual([call.file, call.sub, call.nickname], ['nickname', 'set', 'New Name'], 'the name of a member can be several words');
  call = await ran(`!mod unban ${BEA}`);
  assert.deepEqual([call.file, call.sub, call.user], ['ban', 'remove', BEA]);
  call = await ran('!mod lockdown "big raid"');
  assert.deepEqual([call.file, call.sub, call.reason], ['lockdown', 'start', 'big raid']);
  assert.deepEqual([(await ran('!mod unlockdown')).sub, (await ran('!mod ld')).sub], ['end', 'start']);
  call = await ran('!mod slowmode 30');
  assert.deepEqual([call.file, call.sub, call.seconds], ['channel', 'slowmode', 30]);
  assert.deepEqual([(await ran('!mod lock')).sub, (await ran('!mod unlock')).sub], ['lock', 'unlock']);
  // purge reads its shorter ways of writing like the old command.
  call = await ran('!mod purge bots 50');
  assert.deepEqual([call.file, call.filter, call.amount], ['purge', 'bots', 50], '`!mod purge bots 50` reads like `!purge bots 50`');
  call = await ran(`!mod purge 20 <@${BEA}>`);
  assert.deepEqual([call.amount, call.user], [20, BEA]);
  call = await ran('!mod purge 30 hello there');
  assert.deepEqual([call.amount, call.text], [30, 'hello there'], 'the text takes every word left');
  call = await ran('!mod prune 10');
  assert.equal(call.amount, 10, 'the old word `prune`');
  // `!unban <name>` looks among the banned people; so does `!mod unban <name>`.
  resolveContexts.length = 0;
  await ran('!mod unban someone');
  await ran('!unban someone');
  await ran('!mod ban someone');
  assert.deepEqual(resolveContexts.map((context) => Boolean(context.includeBans)), [true, true, false], '`!mod unban` searches the bans as `!unban` does, `!mod ban` does not');

  // `!mod` alone: the list, not an error.
  let alone = await send('!mod');
  assert.equal(alone.called.length, 0);
  assert.equal(alone.sent.length, 1);
  for (const sub of Object.keys(RUNS)) assert.ok(alone.sent[0].includes(`!mod ${sub}\``), `the list names ${sub}`);
  assert.match(alone.sent[0], /has these ways to use it/);
  assert.ok(!/is not part of/.test(alone.sent[0]), '`!mod` alone is not a mistake');
  assert.ok(alone.sent[0].includes('Ban a single member.'), 'with what each one does');
  assert.equal((await send(',mod')).sent.length, 1);
  const wrong = await send('!mod banana');
  assert.equal(wrong.called.length, 0);
  assert.match(wrong.sent[0], /is not part of/, 'a word that is not a subcommand is told');
  assert.match(wrong.sent[0], /!mod ban/, 'with what was probably meant');
  assert.equal((await send('!mod ban')).called.length, 1, 'a missing option is the old command\'s to ask for (it reads it as required)');

  // The old commands and their words are untouched, and so are their slash commands.
  for (const [content, file, sub] of [[`!ban <@${BEA}>`, 'ban', 'user'], [`!b <@${BEA}>`, 'ban', 'user'], [`!kick <@${BEA}>`, 'kick', 'user'], [`!k <@${BEA}>`, 'kick', 'user'], [`!mute <@${BEA}>`, 'mute', 'user'],
    [`!m <@${BEA}>`, 'mute', 'user'], [`!tempmute <@${BEA}> 1h`, 'mute', 'temp'], [`!timeout <@${BEA}> 1h`, 'mute', 'temp'], [`!to <@${BEA}> 1h`, 'mute', 'temp'], [`!unmute <@${BEA}>`, 'mute', 'remove'],
    [`!um <@${BEA}>`, 'mute', 'remove'], [`!warn <@${BEA}> x`, 'warn', 'user'], [`!w <@${BEA}> x`, 'warn', 'user'], [`!softban <@${BEA}>`, 'softban', null], [`!tempban <@${BEA}> 1d`, 'ban', 'temp'],
    [`!unban ${BEA}`, 'ban', 'remove'], [`!ub ${BEA}`, 'ban', 'remove'], [`!hardban <@${BEA}>`, 'ban:hard', 'user'], [`!note add <@${BEA}> x`, 'note', 'add'], ['!case view 3', 'case', 'view'],
    [`!history <@${BEA}>`, 'history', null], [`!jail <@${BEA}>`, 'jail', 'user'], [`!unjail <@${BEA}>`, 'jail', 'remove'], [`!nickname set <@${BEA}> x`, 'nickname', 'set'], [`!stripstaff <@${BEA}>`, 'stripstaff', null],
    ['!purge 10', 'purge', null], ['!prune 10', 'purge', null], ['!lockdown start', 'lockdown', 'start'], ['!clearinvites', 'clearinvites', null], ['!pauseinvites 1h', 'pauseinvites', null],
    ['!lock', 'channel', 'lock'], ['!unlock', 'channel', 'unlock'], ['!slowmode 5', 'channel', 'slowmode'], ['!ch lock', 'channel', 'lock']]) {
    const result = await ran(content);
    assert.ok(result, `${content} still runs`);
    assert.deepEqual([result.file, result.sub], [file, sub], `${content} still runs ${file}${sub ? ` ${sub}` : ''}`);
  }
  for (const [word, command] of [['b', 'ban'], ['k', 'kick'], ['m', 'mute'], ['um', 'unmute'], ['ub', 'unban'], ['uj', 'unjail'], ['w', 'warn'], ['to', 'timeout'], ['sb', 'softban'], ['hb', 'hardban'], ['ld', 'lockdown'],
    ['prune', 'purge'], ['cs', 'case'], ['nick', 'nickname'], ['tban', 'tempban'], ['tmute', 'tempmute'], ['pi', 'pauseinvites'], ['strip', 'stripstaff']]) {
    assert.equal(client.commandAliases.get(word), command, `${word} is still ${command}`);
  }
  assert.equal(client.commandRoutes.get('lock').command, 'channel', '!lock is still a route to channel lock');
  assert.equal(client.commandRoutes.get('slowmode').command, 'channel');

  // The short aliases of the table: one for each subcommand, and the generator put /mod after the rest (no word that worked changed).
  const shortTargets = Object.entries(SHORT_ALIAS_TABLE).filter(([, target]) => /^mod /.test(target));
  assert.equal(shortTargets.length, 25, 'every subcommand of /mod has a short alias');
  assert.deepEqual(shortTargets.map(([, target]) => target.slice(4)).sort(), Object.keys(RUNS).sort());
  for (const [alias, target] of shortTargets) {
    const route = client.commandRoutes.get(alias);
    assert.ok(route && route.short && route.command === 'mod' && route.subcommand === target.slice(4), `${alias} is the short alias of ${target}`);
  }
  const shortBan = shortTargets.find(([, target]) => target === 'mod ban')[0];
  call = await ran(`!${shortBan} <@${BEA}> why`);
  assert.deepEqual([call.file, call.sub, call.reason], ['ban', 'user', 'why'], 'a short alias runs the subcommand');
  assert.ok(!(await send(`!${shortBan} <@${BEA}>`, { perms: F.KickMembers })).ran, 'and asks for its permission too');
  assert.equal(await event.knownNameChecker(client, '1')('mod'), true);

  // ------------------------------------------------------------ the rules of a server
  assert.deepEqual(commandRules.ruleNames(mod, { subcommand: 'ban' }), ['ban', 'mod']);
  // `/timeout` is not a slash command any more: a rule saved for `timeout` also reaches `/mod tempmute` (and the level asked for it).
  assert.deepEqual(commandRules.ruleNames(mod, { subcommand: 'tempmute' }), ['tempmute', 'timeout', 'mod']);
  assert.deepEqual(commandRules.permissionNames(mod, { subcommand: 'tempmute' }), ['mod', 'tempmute', 'timeout']);
  assert.deepEqual(commandRules.ruleNames(mod, { subcommand: 'lock' }), ['channel', 'mod']);
  assert.deepEqual(commandRules.ruleNames(mod, { subcommand: 'unlockdown' }), ['lockdown', 'mod']);
  assert.deepEqual(commandRules.ruleNames(mod, {}), ['mod']);
  assert.deepEqual(commandRules.permissionNames(mod, { subcommand: 'kick' }), ['mod', 'kick']);
  for (const [argText, expected] of [['', null], ['ban <@1>', 'ban'], ['k <@1>', 'kick'], ['to <@1> 1h', 'tempmute'], ['purge bots', 'purge'], ['prune', 'purge'], ['ld', 'lockdown'], ['unlock', 'unlock']]) {
    assert.equal(commandRules.subcommandOfText(mod, argText), expected, `"${argText}" reaches ${expected}`);
  }

  // A rule for the wrapped command stops the subcommand, and only that one.
  rules = [{ command: 'ban', channel_id: null }];
  let result = await slash('ban');
  assert.ok(refusedSlash(result), '/mod ban is refused when ban is turned off');
  assert.ok(text(result.replies[0].payload).includes('/mod ban'), 'the notice names it');
  assert.ok((await slash('kick')).ran, '/mod kick still runs');
  assert.ok((await slash('unban')).ran, 'a rule on ban is not a rule on unban');
  for (const content of ['!mod ban', '!mod banish', '!mod b']) assert.ok(refusedPrefix(await send(content)), `${content} is refused when ban is turned off`);
  assert.ok((await ran('!mod kick')), '!mod kick still runs');
  assert.ok(!(await ran('!ban')), '!ban itself is refused too (as before)');
  rules = [{ command: 'tempmute', channel_id: null }];
  assert.ok(refusedSlash(await slash('tempmute')) && (await slash('mute')).ran && refusedPrefix(await send('!mod to')) && (await send('!mod mute')).ran);
  rules = [{ command: 'timeout', channel_id: null }];
  assert.ok(refusedSlash(await slash('tempmute')) && (await slash('mute')).ran && refusedPrefix(await send('!mod to')) && refusedPrefix(await send('!mod tempmute')) && (await send('!mod mute')).ran, 'a rule on timeout (the removed /timeout) also stops /mod tempmute');
  rules = [{ command: 'channel', channel_id: null }];
  for (const sub of ['lock', 'unlock', 'slowmode']) assert.ok(refusedSlash(await slash(sub)) && refusedPrefix(await send(`!mod ${sub}`)), `/mod ${sub} is refused when channel is turned off`);
  assert.ok(!(await ran('!lock')), 'and !lock (as before)');
  assert.ok((await slash('purge')).ran);
  // The name of the umbrella turns off all of it, and not the old commands.
  rules = [{ command: 'mod', channel_id: null }];
  for (const sub of Object.keys(RUNS)) assert.ok(refusedSlash(await slash(sub)), `/mod ${sub} is refused when mod is turned off`);
  for (const content of ['!mod ban', '!mod k', '!mod purge 10', '!mod']) assert.ok(refusedPrefix(await send(content)), `${content} is refused when mod is turned off`);
  assert.ok(await ran('!ban') && await ran('!kick') && await ran('!purge 10'), 'the old commands are not touched by it');
  // One channel only.
  rules = [{ command: 'kick', channel_id: ROOM }];
  result = await slash('kick', { channelId: ROOM });
  assert.ok(refusedSlash(result) && text(result.replies[0].payload).includes(`<#${ROOM}>`), 'refused in that channel, naming it');
  assert.ok((await slash('kick', { channelId: '666666666666666667' })).ran, 'allowed in another channel');
  assert.ok(refusedPrefix(await send('!mod kick', { channelId: ROOM })) && (await send('!mod kick', { channelId: '8' })).ran);
  rules = [];

  // A restriction to roles (`!restrictcommand`): the name of the wrapped command and the one of /mod.
  restrictions = { ban: [MODS] };
  result = await slash('ban', { perms: F.BanMembers });
  assert.ok(!result.ran && result.replies[0].payload.content.includes(`<@&${MODS}>`), '/mod ban asks for the role of ban');
  assert.ok((await slash('ban', { perms: F.BanMembers, roles: [MODS] })).ran, 'with the role it runs');
  assert.ok((await slash('ban')).ran, 'an administrator always can');
  assert.ok((await slash('kick', { perms: F.KickMembers })).ran, 'another subcommand is not restricted');
  assert.match((await send('!mod ban', { perms: F.BanMembers })).sent.join(''), new RegExp(MODS), 'the prefix asks for the role too');
  restrictions = { mod: [MODS] };
  assert.ok(!(await slash('warn', { perms: F.ModerateMembers })).ran && !(await slash('kick', { perms: F.KickMembers })).ran && !(await ran('!mod purge 5', { perms: F.ManageMessages })), 'a restriction on mod asks for the role in every subcommand');
  assert.ok((await ran('!warn <@1> x')), 'and not for the old commands');
  restrictions = {};

  // A permission level (`!permissions`): the one of the wrapped command, and the one of /mod.
  levelDenied = new Set(['ban']);
  result = await slash('ban');
  assert.ok(!result.ran && result.replies[0].payload.content, '/mod ban asks for the level of ban');
  assert.ok((await slash('kick')).ran);
  assert.ok(!(await ran('!mod ban')) && (await ran('!mod kick')));
  levelDenied = new Set(['mod']);
  assert.ok(!(await slash('kick')).ran && !(await ran('!mod kick')), 'the level of /mod is asked for all of it');
  levelDenied = new Set();
  restoreBase();

  // ------------------------------------------------------------ Discord: registered, translated, inside the limits
  const registered = collectCommandData();
  const chat = registered.filter((each) => (each.type ?? 1) === 1);
  assert.equal(registered.length, 67, '67 commands registered with Discord (71 before six old slash commands were replaced by their umbrella subcommand, then /ai was added)');
  assert.equal(chat.length, 64, '64 of them slash commands (3 are menus)');
  assert.ok(chat.length <= 100, 'far from the 100 slash commands Discord allows');
  const registeredMod = registered.find((each) => each.name === 'mod');
  assert.ok(registeredMod, '/mod is registered with Discord, so deploy-commands.js sends it');
  assert.ok(registeredMod.options.length <= 25, `/mod has ${registeredMod.options.length} subcommands (at most 25)`);
  const deployed = [];
  await require('../src/handlers/deployCommands').deployCommands({ rest: { put: async (_route, { body }) => { deployed.push(...body); return body; }, get: async () => [] }, settings: { getSetting: async () => null, setSetting: async () => {} }, force: true });
  assert.ok(deployed.some((each) => each.name === 'mod' && each.options.length === 25), 'deploy-commands.js sends /mod to Discord');
  // `/ban`, `/kick` and `/warn` are still registered with their own permissions (each has subcommands that /mod does not wrap, and /mod is at 25).
  for (const name of ['ban', 'kick', 'warn', 'channel']) assert.ok(chat.some((each) => each.name === name), `/${name} is still registered`);
  // `/unban`, `/purge` and `/timeout` are replaced by `/mod unban`, `/mod purge` and `/mod tempmute` (same options, same permission): not registered, the prefix is unchanged.
  for (const name of ['unban', 'purge', 'timeout']) assert.ok(!chat.some((each) => each.name === name), `/${name} is not registered any more`);
  for (const [name, sub] of [['unban', 'unban'], ['purge', 'purge'], ['timeout', 'tempmute']]) {
    const old = client.commands.get(name).data.toJSON();
    const replacement = mod.data.toJSON().options.find((each) => each.name === sub);
    assert.deepEqual((replacement.options ?? []).map((o) => [o.name, o.type, Boolean(o.required), o.min_value ?? null, o.max_value ?? null, o.max_length ?? null, (o.choices ?? []).length]), (old.options ?? []).map((o) => [o.name, o.type, Boolean(o.required), o.min_value ?? null, o.max_value ?? null, o.max_length ?? null, (o.choices ?? []).length]), `/mod ${sub} has every option of /${name}`);
    assert.equal(mod.permissionForSubcommand(sub), BigInt(old.default_member_permissions), `/mod ${sub} asks for what /${name} asked for`);
  }
  assert.ok(chat.find((each) => each.name === 'ban').default_member_permissions === String(F.BanMembers));
  for (const name of ['tempban', 'softban', 'hardban', 'jail', 'note', 'case', 'history', 'lockdown']) assert.ok(!chat.some((each) => each.name === name), `/${name} is not a slash command`);

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
  walk(registeredMod, '/mod');
  assert.notEqual(registeredMod.description_localizations['es-ES'], registeredMod.description);
  assert.notEqual(registeredMod.description_localizations['pt-BR'], registeredMod.description);
  for (const sub of registeredMod.options) {
    assert.notEqual(sub.description_localizations['es-ES'], sub.description, `/mod ${sub.name} is translated into Spanish`);
    assert.notEqual(sub.description_localizations['pt-BR'], sub.description, `/mod ${sub.name} is translated into Portuguese`);
  }
  // What Discord counts of a command: names, descriptions, choices and values, in each language, at most 8000.
  for (const locale of [null, ...LOCALES]) {
    let total = 0;
    const add = (node) => {
      total += size(node.name) + size((locale && node.description_localizations?.[locale]) || node.description);
      for (const choice of node.choices ?? []) total += size(choice.name) + size(choice.value);
      for (const child of node.options ?? []) add(child);
    };
    add(registeredMod);
    assert.ok(total < 8000, `/mod${locale ? ` [${locale}]` : ''} is ${total} characters (Discord allows 8000)`);
  }
  // Every key of the English catalog of /mod has its Spanish and Portuguese text, and the card of the list too.
  for (const key of Object.keys(CATALOGS.en).filter((each) => /^cmd\.moderation\.mod\./.test(each))) assert.ok(CATALOGS.es[key] && CATALOGS['pt-BR'][key], `${key} is in es and pt-BR`);
  for (const lang of ['en', 'es', 'pt-BR']) assert.ok(CATALOGS[lang]['core.usage.listTitle'], `the title of the list is in ${lang}`);
  assert.notEqual(CATALOGS.es['core.usage.listTitle'], CATALOGS.en['core.usage.listTitle']);
  assert.notEqual(CATALOGS['pt-BR']['core.usage.listTitle'], CATALOGS.en['core.usage.listTitle']);

  // The prefix reader still builds an interaction for the subcommands of /mod (the handler above did, this is the function by itself).
  const messageOf = (content) => ({ content, author: { id: ANA }, guild: { id: GUILD, members: { cache: new Map() }, channels: { cache: new Map() } }, client, member: memberWith(0n), channel: { id: '5' }, attachments: new Map(), mentions: {} });
  const built = await buildInteractionFromMessage(messageOf(''), mod, `ban <@${BEA}> reason`);
  assert.equal(built.options.getSubcommand(), 'ban');
  assert.equal(built.options.getUser('user').id, BEA);

  console.log('check-mod-command: ok');
  setTimeout(() => process.exit(0), 10);
})().catch((err) => { console.error(err); process.exit(1); });
