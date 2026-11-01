// Checks the third batch of umbrella commands, the last of the prefix commands that moved to slash: /config, /protect, /greet, /auto, /message,
// /community, /contrib, /special and /bot (src/commands/*/*.js, utils/umbrella.js), and the commands that already were a command with subcommands and
// are registered as they are (/level, /automod, /role, /forum, /form...). Discord will take the prefix away one day, so everything public moves now:
//   - every umbrella only has groups and subcommands; a group is an old command with ALL its subcommands (the same names, options, types, limits and
//     choices), a subcommand one that has none; nothing is left out of a wrapped command, and nothing is wrapped twice;
//   - the slash command runs the code of the old command with its options; the prefix sends the first word to the old command (`!protect honeypot add`
//     is `!honeypot add`), so it reads what it takes exactly as the old command does (compared one by one), and `!config`, `!protect`... alone list
//     the groups;
//   - SECURITY: every umbrella is open (`default_member_permissions` null) and each subcommand asks, when it runs, for the permission of the command
//     it wraps (or the role chosen with `!moderation`), for the slash command and the prefix alike: a member with the exact permission runs it, one
//     with another permission or none is refused in private and the wrapped command never starts; what asks for nothing stays open;
//   - the old commands, their words, routes and short aliases are untouched; the rules of a server (turned off, restricted, a permission level) on a
//     wrapped command stop that group only, and on the umbrella stop all of it, with the prefix too;
//   - the list that Discord fills while an option is typed (autocomplete) is the wrapped command's own, and empty for who may not use it;
//   - the descriptions are translated for Discord (es and pt-BR), every command is under 8000 characters in each language, and the number of slash
//     commands (68 of the 100 Discord allows: 32 free) is the one expected;
//   - the private tools of the team and the generated `!<name>config` cards stay prefix-only.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
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

// What the server has set, in memory.
let rules = []; // { command, channel_id }
let restrictions = {}; // command -> role ids
let levelDenied = new Set(); // commands whose permission level the member does not meet
let moderationRoles = {}; // command -> role ids chosen with `!moderation`
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
const { defineUmbrella, copyOptions } = require('../src/utils/umbrella');
const { slotUsage, commandSize, LIMITS } = require('../src/utils/slashBudget');

const client = { user: { id: '123' }, users: { fetch: async (id) => ({ id, username: `user${id.slice(-3)}` }) } };
loadCommands(client);
const F = PermissionFlagsBits;
const GUILD = '444444444444444444';
const ROOM = '666666666666666666';
const ANA = '111111111111111111';
const BEA = '222222222222222222';
const MODS = '900000000000000001';
const commandFile = (name) => client.commands.get(name);
const optionsOf = (command) => command.data.toJSON().options;

// ---------------------------------------------------------------- what was decided (written here, apart from the commands)
// `groups`: old commands wrapped whole, `flat`: [name, old command] wrapped as one subcommand. Counts: how many subcommands the groups hold.
const UMBRELLAS = {
  config: { category: 'config', groups: { prefix: 5, alias: 4, moderation: 4, restrictcommand: 4, disablecommand: 4, sanctionmessage: 3, backup: 9, statsconfig: 6 }, flat: { language: 'language', appeals: 'appeals', recommended: 'cmdconfig' } },
  protect: { category: 'config', groups: { honeypot: 5, verify: 5, security: 2 }, flat: {} },
  greet: { category: 'welcome', groups: { welcome: 6, leave: 4, boost: 5, dmonjoin: 4, poj: 5, joinrole: 4, stickyroles: 3 }, flat: {} },
  auto: { category: 'automation', groups: { autothread: 3, bumpreminder: 8, reaction: 10, reactionrole: 4, stickymessage: 3, timer: 12 }, flat: {} },
  message: { category: 'config', groups: { sender: 3, webhook: 5, panel: 7, responder: 4, pagination: 12 }, flat: { send: 'send', editembed: 'editembed' } },
  community: { category: 'automation', groups: { suggestion: 17, confession: 13, request: 2, requestconfig: 8, review: 3, profileconfig: 3 }, flat: { confess: 'confess', profile: 'profile' } },
  contrib: { category: 'automation', groups: { partner: 2, partnerconfig: 10, uploads: 2, uploadconfig: 6 }, flat: {} },
  special: { category: 'utility', groups: { counting: 9, counter: 8, imgonly: 3, urlonly: 4 }, flat: {} },
  bot: { category: 'info', groups: { votes: 2, premium: 5 }, flat: { uptime: 'uptime', version: 'version' } },
};
// What each wrapped command asks of the member (a permission, or null for anyone: what it checks by itself is its own).
const PERMS = {
  prefix: 'ManageGuild', language: 'ManageGuild', alias: 'ManageGuild', moderation: 'ManageGuild', restrictcommand: 'ManageGuild', disablecommand: 'ManageGuild',
  sanctionmessage: 'ManageGuild', appeals: 'ManageGuild', backup: 'ManageGuild', statsconfig: 'ManageGuild', cmdconfig: null,
  honeypot: 'Administrator', verify: 'ManageGuild', security: 'ManageGuild',
  welcome: 'ManageGuild', leave: 'ManageGuild', boost: 'ManageGuild', dmonjoin: 'ManageGuild', poj: 'ManageGuild', joinrole: 'ManageRoles', stickyroles: 'ManageRoles',
  autothread: 'ManageChannels', bumpreminder: 'ManageGuild', reaction: 'ManageGuild', reactionrole: 'ManageRoles', stickymessage: 'ManageMessages', timer: 'ManageGuild',
  send: 'ManageMessages', editembed: 'ManageMessages', sender: 'ManageGuild', webhook: 'ManageWebhooks', panel: 'ManageGuild', responder: 'ManageGuild', pagination: 'ManageMessages',
  suggestion: null, confession: null, confess: null, request: null, requestconfig: 'ManageGuild', review: null, profile: null, profileconfig: 'ManageGuild',
  partner: null, partnerconfig: 'ManageGuild', uploads: null, uploadconfig: 'ManageGuild',
  counting: null, counter: 'ManageChannels', imgonly: null, urlonly: null,
  uptime: null, version: null, votes: null, premium: null,
};
// The commands that already have subcommands, registered by themselves (with the number of top-level subcommands and groups they have).
const DIRECT = {
  level: 25, automod: 16, form: 17, forum: 19, role: 21, logs: 5, permission: 3, antinuke: 8, antiscam: 4, invites: 9, autoresponder: 8, image: 12, feed: 8, identity: 6,
  starboard: 10, clownboard: 10, monkeyboard: 10, stats: 8, customcommand: 16, rollouts: 15, quickreply: 4, voicemaster: 17, giveawaypreset: 7, giveawaytemplate: 4,
};
const NEW_SLASH = [...Object.keys(UMBRELLAS), ...Object.keys(DIRECT)];
const wrappedNames = Object.values(UMBRELLAS).flatMap((u) => [...Object.keys(u.groups), ...Object.values(u.flat)]);
const leavesOf = (umbrella) => {
  const { groups, flat } = UMBRELLAS[umbrella];
  return [
    ...Object.keys(groups).flatMap((group) => commandFile(group).data.toJSON().options.map((sub) => ({ umbrella, group, name: sub.name, file: group, node: sub }))),
    ...Object.entries(flat).map(([name, file]) => ({ umbrella, group: null, name, file, node: commandFile(file).data.toJSON() })),
  ];
};

// ---------------------------------------------------------------- the spy: replaces what a wrapped command does with a record of what it was asked
const calls = [];
const originals = [];
const typeRead = { 3: 'getString', 4: 'getInteger', 5: 'getBoolean', 6: 'getUser', 7: 'getChannel', 8: 'getRole', 9: 'getMentionable', 10: 'getNumber', 11: 'getAttachment' };
function readOptions(interaction, file) {
  const json = commandFile(file).data.toJSON();
  const sub = interaction.options.getSubcommand(false);
  const group = interaction.options.getSubcommandGroup(false);
  const top = group ? json.options.find((option) => option.name === group).options : json.options;
  const node = sub ? top.find((option) => option.name === sub) : json;
  const values = {};
  for (const option of node?.options ?? []) {
    let value = null;
    try { value = interaction.options[typeRead[option.type]](option.name, false); } catch { value = null; }
    values[option.name] = value?.id ?? value?.url ?? value ?? null;
  }
  return { sub, values };
}
function spyOn(files) {
  for (const file of new Set(files)) {
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
    case ApplicationCommandOptionType.Integer: case ApplicationCommandOptionType.Number: return Math.min(Math.max(option.min_value ?? 3, 3), option.max_value ?? 1000);
    case ApplicationCommandOptionType.Boolean: return true;
    case ApplicationCommandOptionType.User: case ApplicationCommandOptionType.Mentionable: return BEA;
    case ApplicationCommandOptionType.Channel: return ROOM;
    case ApplicationCommandOptionType.Role: return MODS;
    case ApplicationCommandOptionType.Attachment: return 'https://example.com/a.png';
    default: throw new Error(`no value for type ${option.type}`);
  }
}
const leafNode = (umbrella, group, name) => {
  const top = optionsOf(commandFile(umbrella));
  return group ? top.find((each) => each.name === group).options.find((sub) => sub.name === name) : top.find((each) => each.name === name);
};
const typedValues = (umbrella, group, name) => Object.fromEntries((leafNode(umbrella, group, name).options ?? []).map((option) => [option.name, valuesFor(option)]));
/** `/<umbrella> [group] <sub>` through interactionCreate: `{ replies, called, ran }`; `perms`: what the member has. */
async function slash(umbrella, group, sub, { values = typedValues(umbrella, group, sub), channelId = ROOM, perms = F.Administrator, roles = [] } = {}) {
  seq += 1;
  const replies = [];
  const before = calls.length;
  const pick = (name) => values[name] ?? null;
  const base = {
    id: `7777777777777777${String(10 + seq)}`, commandName: umbrella, commandType: 1, user: { id: ANA, username: 'Ana' },
    guild: { id: GUILD, ownerId: '1', name: 'Petto Test' }, guildId: GUILD, channelId, channel: { id: channelId },
    member: memberWith(perms, roles),
    locale: 'en-US', pettoLang: 'en', client,
    options: {
      getSubcommand: () => sub, getSubcommandGroup: () => group,
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
const roleOfMods = { id: MODS, name: 'Mods', guild: { id: GUILD }, position: 1 };
/** A message such as `!config prefix set ...`: `{ called, sent, ran }`. */
async function send(content, { channelId = '5', perms = F.Administrator, roles = [] } = {}) {
  const sent = [];
  const before = calls.length;
  const guild = { id: `7${n++}`, name: 'Petto Test', members: { cache: new Map(), fetch: async () => new Map() }, channels: { cache: new Map([[ROOM, { id: ROOM, name: 'room', type: 0, guild: { id: GUILD } }]]) }, roles: { cache: new Map([[MODS, roleOfMods]]), fetch: async () => null } };
  const message = {
    content, author: { id: ANA, bot: false }, guild, client,
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
/** What is typed after the name for the required options of a subcommand (the same words for the old command and the umbrella). */
function tailOf(node) {
  return (node.options ?? []).filter((option) => option.required && option.type !== ApplicationCommandOptionType.Attachment).map((option) => {
    switch (option.type) {
      case ApplicationCommandOptionType.User: case ApplicationCommandOptionType.Mentionable: return `<@${BEA}>`;
      case ApplicationCommandOptionType.Channel: return `<#${ROOM}>`;
      case ApplicationCommandOptionType.Role: return `<@&${MODS}>`;
      case ApplicationCommandOptionType.Boolean: return 'true';
      case ApplicationCommandOptionType.Integer: case ApplicationCommandOptionType.Number: return String(Math.min(Math.max(option.min_value ?? 3, 3), option.max_value ?? 1000));
      default: return option.choices?.length ? String(option.choices[0].value) : 'word';
    }
  }).join(' ');
}

(async () => {
  // ------------------------------------------------------------ the umbrellas exist, once each, with what was decided
  const total = { groups: 0, leaves: 0 };
  for (const [umbrella, spec] of Object.entries(UMBRELLAS)) {
    const command = commandFile(umbrella);
    assert.ok(command, `/${umbrella} is loaded`);
    assert.equal(command.category, spec.category, `/${umbrella} is in ${spec.category}`);
    assert.ok(!command.hiddenFromHelp && !command.slashOnly && !command.prefixOnly, `/${umbrella} is a prefix and a slash command, shown in !help`);
    assert.equal(command.registerSlash, true);
    assert.equal(command.umbrella, true);
    assert.equal(command.rulesBySubcommand, true);
    assert.equal(command.listSubcommandsWhenEmpty, true);
    assert.equal(typeof command.autocomplete, 'function', `/${umbrella} answers the lists of its options`);
    assert.ok(isSlashCommand(command));
    assert.ok(!client.commandAliases.has(umbrella) && !client.commandRoutes.has(umbrella), `\`${umbrella}\` was not a word of anything else`);
    const json = command.data.toJSON();
    assert.equal(json.dm_permission, false);
    // Discord checks this per command, not per subcommand: any bound would hide the umbrella from the members who may use some of it.
    assert.equal(json.default_member_permissions ?? null, null, `/${umbrella} is open: each subcommand asks for the permission of what it wraps when it runs`);
    const top = json.options;
    assert.ok(top.length <= 25, `/${umbrella} has ${top.length} groups and subcommands (at most 25)`);
    assert.ok(top.every((each) => each.type === ApplicationCommandOptionType.Subcommand || each.type === ApplicationCommandOptionType.SubcommandGroup), `/${umbrella} has groups and subcommands and nothing else: no slash command without subcommands`);
    assert.deepEqual(top.filter((each) => each.type === 2).map((each) => each.name), Object.keys(spec.groups), `/${umbrella} has the groups that were decided`);
    assert.deepEqual(top.filter((each) => each.type === 1).map((each) => each.name), Object.keys(spec.flat), `/${umbrella} has the subcommands that were decided`);
    for (const [group, count] of Object.entries(spec.groups)) {
      const node = top.find((each) => each.name === group);
      assert.equal(node.options.length, count, `/${umbrella} ${group} holds the ${count} subcommands of !${group}`);
      assert.ok(node.options.every((sub) => sub.type === 1), `/${umbrella} ${group} holds subcommands only`);
      total.groups += 1;
    }
    total.leaves += leavesOf(umbrella).length;
    assert.ok(Object.values(command.ruleKeys).length >= top.length);
  }
  assert.deepEqual(Object.fromEntries(Object.keys(UMBRELLAS).map((umbrella) => [umbrella, leavesOf(umbrella).length])), { config: 42, protect: 12, greet: 31, auto: 40, message: 33, community: 48, contrib: 20, special: 24, bot: 9 });

  // What it wraps is something the umbrella can run: it exists, is private to nobody, is wrapped once, has no groups of its own (Discord allows two
  // levels), and is still a prefix command (the ones that were slash commands are not wrapped twice).
  assert.equal(new Set(wrappedNames).size, wrappedNames.length, 'no command is wrapped twice');
  for (const file of wrappedNames) {
    const wrapped = commandFile(file);
    assert.ok(wrapped, `${file} exists`);
    assert.ok(!wrapped.hiddenFromHelp && !wrapped.privateGuildId, `${file} is not private`);
    assert.ok(!isSlashCommand(wrapped), `${file} is still a prefix command: the old command works as it did`);
    assert.ok(!(wrapped.data.toJSON().options ?? []).some((option) => option.type === 2), `${file} has no groups of its own`);
    assert.equal(wrapped.prefixArgs === undefined || ['disablecommand'].includes(file), true, `${file}: a prefixArgs reader is read by the old command itself (the prefix goes to it)`);
  }

  // Each group is the whole old command: the same subcommands in the same order, each with the description and the options of the old one.
  const shape = (options) => (options ?? []).map((option) => [option.name, option.type, Boolean(option.required), option.description, option.channel_types ?? null, option.choices ?? null, option.min_value ?? null, option.max_value ?? null, option.min_length ?? null, option.max_length ?? null, Boolean(option.autocomplete)]);
  for (const umbrella of Object.keys(UMBRELLAS)) {
    for (const leaf of leavesOf(umbrella)) {
      const own = leafNode(umbrella, leaf.group, leaf.name);
      const wrapped = leaf.group ? leaf.node : commandFile(leaf.file).data.toJSON();
      assert.equal(own.description, wrapped.description, `/${umbrella} ${leaf.group ?? ''} ${leaf.name} describes itself like !${leaf.file}`);
      assert.deepEqual(shape(own.options), shape(wrapped.options), `/${umbrella} ${leaf.group ?? ''} ${leaf.name} takes the options of !${leaf.file}`);
    }
    for (const group of Object.keys(UMBRELLAS[umbrella].groups)) {
      assert.equal(commandFile(umbrella).ruleKeys[group], group, `the rules of /${umbrella} ${group} are the ones of !${group}`);
      assert.equal(optionsOf(commandFile(umbrella)).find((each) => each.name === group).description, commandFile(group).data.toJSON().description);
    }
    for (const [name, file] of Object.entries(UMBRELLAS[umbrella].flat)) assert.equal(commandFile(umbrella).ruleKeys[name], file);
  }
  // A few by hand, so the comparison above is not the only witness.
  const sub = (umbrella, group, name) => leafNode(umbrella, group, name);
  const optionList = (node) => (node.options ?? []).map((option) => `${option.name}:${option.type}:${Boolean(option.required)}`);
  assert.deepEqual(optionList(sub('config', null, 'language')), optionList(commandFile('language').data.toJSON()));
  assert.deepEqual(optionList(sub('protect', 'honeypot', 'add')), optionList(commandFile('honeypot').data.toJSON().options.find((each) => each.name === 'add')));
  assert.ok(sub('protect', 'honeypot', 'add').options.some((option) => option.type === ApplicationCommandOptionType.Channel && option.required), 'the channel of a honeypot is required, as in !honeypot');
  assert.ok(sub('message', null, 'send').options.some((option) => option.type === ApplicationCommandOptionType.Attachment), 'a file option (Attachment) is copied');

  // ------------------------------------------------------------ the commands that already have subcommands are registered as they are
  const registered = collectCommandData();
  const chat = registered.filter((each) => (each.type ?? 1) === 1);
  for (const [name, count] of Object.entries(DIRECT)) {
    const command = commandFile(name);
    assert.ok(command && isSlashCommand(command), `/${name} is registered`);
    assert.ok(!command.prefixOnly && !command.slashOnly && !command.hiddenFromHelp, `/${name} works with the prefix and as a slash command`);
    const json = command.data.toJSON();
    assert.equal(json.dm_permission, false, `/${name} is not offered in DMs`);
    assert.equal(json.options.length, count, `/${name} has ${count} subcommands and groups`);
    assert.ok(json.options.length <= 25 && json.options.every((each) => each.type === 1 || each.type === 2), `/${name} only has subcommands (at most 25)`);
    assert.deepEqual(chat.find((each) => each.name === name).options.map((each) => each.name), json.options.map((each) => each.name), `/${name} is sent to Discord as it is`);
  }
  // The old permission of each is the one Discord checks for the whole command (they are not wrapped, so nobody else asks for it).
  const byName = new Map(chat.map((each) => [each.name, each]));
  for (const [name, bits] of Object.entries({ level: F.ManageGuild, automod: F.ModerateMembers, role: F.ManageRoles, logs: F.ManageGuild, antinuke: F.Administrator, antiscam: F.ManageGuild, autoresponder: F.ManageGuild, feed: F.ManageGuild, identity: F.ManageGuild, customcommand: F.ManageGuild, counter: null })) {
    if (bits !== null) assert.equal(BigInt(byName.get(name).default_member_permissions), bits, `/${name} asks Discord for its permission`);
  }
  for (const name of ['form', 'forum', 'invites', 'image', 'stats', 'quickreply', 'voicemaster']) assert.equal(byName.get(name).default_member_permissions ?? null, null, `/${name} is open, as !${name} is (it checks what it needs by itself)`);

  // /level reward: Discord wants the required options first, so the kind of level goes last, and the prefix still reads it first as it always did.
  const reward = optionsOf(commandFile('level')).find((each) => each.name === 'reward');
  for (const name of ['add', 'remove']) {
    const options = reward.options.find((each) => each.name === name).options;
    assert.deepEqual(options.map((option) => option.name), name === 'add' ? ['level', 'role', 'type'] : ['level', 'type'], `/level reward ${name} has its required options first`);
  }
  assert.equal(commandFile('level').prefixArgs('reward add voice 5 <@&1>'), 'reward add 5 <@&1> voice');
  assert.equal(commandFile('level').prefixArgs('reward add 5 <@&1>'), 'reward add 5 <@&1>');
  assert.equal(commandFile('level').prefixArgs('reward remove text 5'), 'reward remove 5 text');
  assert.equal(commandFile('level').prefixArgs('voice-xp 5 10'), 'voice-xp 5 10');
  spyOn(['level']);
  let call = (await send(`!xp reward add voice 5 <@&${MODS}>`)).ran;
  assert.deepEqual([call.sub, call.group, call.values.level, call.values.type, call.values.role], ['add', 'reward', 5, 'voice', MODS], 'the old way of writing it still works');
  call = (await send(`!level reward add 5 <@&${MODS}>`)).ran;
  assert.deepEqual([call.values.level, call.values.type], [5, null], 'and the one without the kind of level now works too');
  call = (await send('!level reward remove messages 7')).ran;
  assert.deepEqual([call.sub, call.values.level, call.values.type], ['remove', 7, 'text']);
  restoreSpies();

  // ------------------------------------------------------------ the slash command runs the code of the old command, with its options
  spyOn(wrappedNames);
  for (const umbrella of Object.keys(UMBRELLAS)) {
    for (const leaf of leavesOf(umbrella)) {
      const result = await slash(umbrella, leaf.group, leaf.name);
      assert.ok(result.ran, `/${umbrella} ${leaf.group ?? ''} ${leaf.name} runs something`);
      assert.equal(result.called.length, 1, `/${umbrella} ${leaf.group ?? ''} ${leaf.name} runs one command`);
      assert.equal(result.ran.file, leaf.file, `/${umbrella} ${leaf.group ?? ''} ${leaf.name} runs the code of ${leaf.file}`);
      assert.equal(result.ran.sub, leaf.group ? leaf.name : null, `it gives ${leaf.file} its own subcommand`);
      assert.equal(result.ran.group, null);
      assert.equal(result.ran.commandName, leaf.file, `${leaf.file} is told it was typed as ${leaf.file}`);
      assert.deepEqual(result.ran.values, result.values, `/${umbrella} ${leaf.group ?? ''} ${leaf.name} passes every option it was given`);
    }
  }
  let r = (await slash('protect', 'honeypot', 'add', { values: { channel: ROOM, action: 'ban' } })).ran;
  assert.deepEqual([r.file, r.sub, r.values.channel], ['honeypot', 'add', ROOM]);
  r = (await slash('config', 'prefix', 'set', { values: { new_prefix: '?!' } })).ran;
  assert.deepEqual([r.file, r.sub, r.values.new_prefix], ['prefix', 'set', '?!']);
  r = (await slash('config', null, 'language', { values: { language: 'es' } })).ran;
  assert.deepEqual([r.file, r.sub], ['language', null], 'a command without subcommands is read with none');
  assert.equal((await slash('config', null, 'recommended')).ran.file, 'cmdconfig', '/config recommended is !cmdconfig');
  r = (await slash('auto', 'timer', 'add', { values: { channel: ROOM, interval: '10m', message: 'hi' } })).ran;
  assert.deepEqual([r.file, r.sub, r.values.interval, r.values.message], ['timer', 'add', '10m', 'hi']);
  r = (await slash('bot', 'votes', 'show')).ran;
  assert.deepEqual([r.file, r.sub], ['votes', 'show']);
  assert.equal((await slash('config', 'prefix', 'show')).ran.interaction.options.getSubcommandGroup(false), null, 'the old command sees no group, as if it was typed as the old command');
  restoreSpies();

  // ------------------------------------------------------------ the prefix reads what each subcommand takes exactly as the old command does
  spyOn(wrappedNames);
  const ran = async (content, options) => (await send(content, options)).ran;
  for (const umbrella of Object.keys(UMBRELLAS)) {
    for (const leaf of leavesOf(umbrella)) {
      const tail = tailOf(leaf.node);
      const via = await send(`!${umbrella} ${leaf.group ? `${leaf.group} ` : ''}${leaf.name} ${tail}`.replace(/\s+/g, ' ').trimEnd());
      assert.ok(via.ran, `!${umbrella} ${leaf.group ?? ''} ${leaf.name} ${tail} runs: ${via.sent.join('')}`);
      assert.equal(via.called.length, 1);
      assert.deepEqual([via.ran.file, via.ran.sub, via.ran.commandName], [leaf.file, leaf.group ? leaf.name : null, leaf.file], `!${umbrella} ${leaf.group ?? ''} ${leaf.name} runs ${leaf.file}`);
      const old = await send(`!${leaf.file} ${leaf.group ? `${leaf.name} ` : ''}${tail}`.replace(/\s+/g, ' ').trimEnd());
      assert.ok(old.ran, `the old !${leaf.file} ${leaf.group ? leaf.name : ''} ${tail} still runs: ${old.sent.join('')}`);
      assert.deepEqual([old.ran.file, old.ran.sub], [leaf.file, leaf.group ? leaf.name : null]);
      assert.deepEqual(via.ran.values, old.ran.values, `!${umbrella} ${leaf.group ?? ''} ${leaf.name} ${tail} reads its options as !${leaf.file} does`);
    }
  }
  // By hand: the old words work inside the group, with other prefixes, and what the old command reads in its own way is read in its own way.
  call = await ran('!config prefix set ?!');
  assert.deepEqual([call.file, call.sub, call.values.new_prefix], ['prefix', 'set', '?!']);
  call = await ran(',config prefix set ?!');
  assert.equal(call.file, 'prefix', 'with another prefix too');
  call = await ran('!config prefix list');
  assert.deepEqual([call.file, call.sub], ['prefix', 'show'], 'the old word `list` of !prefix is `show` inside the group');
  call = await ran('!config prefix ?!');
  assert.deepEqual([call.sub, call.values.new_prefix], ['set', '?!'], 'and what !prefix does when it is not told what to do (`!prefix ?!`)');
  call = await ran('!config prefix');
  assert.deepEqual([call.file, call.sub], ['prefix', 'show'], '`!config prefix` alone is `!prefix` alone');
  call = await ran('!config language es');
  assert.deepEqual([call.file, call.values.language], ['language', 'es']);
  call = await ran('!config recommended');
  assert.equal(call.file, 'cmdconfig');
  call = await ran(`!protect honeypot add <#${ROOM}> ban`);
  assert.deepEqual([call.file, call.sub, call.values.channel], ['honeypot', 'add', ROOM]);
  call = await ran('!auto timer list');
  assert.deepEqual([call.file, call.sub], ['timer', 'list']);
  call = await ran('!auto ar list');
  assert.ok(call === null, '`ar` is not a word of /auto: autoresponder is not in it');
  call = await ran('!greet welcome status');
  assert.deepEqual([call.file, call.sub], ['welcome', 'status']);
  call = await ran(`!greet joinrole add <@&${MODS}>`);
  assert.deepEqual([call.file, call.sub, call.values.role], ['joinrole', 'add', MODS]);
  call = await ran('!bot votes top');
  assert.deepEqual([call.file, call.sub], ['votes', 'top']);
  call = await ran('!bot version');
  assert.equal(call.file, 'version');
  // The words (aliases) of the wrapped commands are words of the group (the ones that no group of the umbrella uses).
  for (const umbrella of Object.keys(UMBRELLAS)) {
    const command = commandFile(umbrella);
    for (const [word, route] of Object.entries(command.prefixWords)) {
      const name = route.command;
      assert.ok(wrappedNames.includes(name), `${umbrella}: ${word} goes to a command it wraps`);
      assert.equal(commandFile(name).data.name, name);
    }
    for (const name of [...Object.keys(UMBRELLAS[umbrella].groups), ...Object.values(UMBRELLAS[umbrella].flat)]) {
      for (const alias of commandFile(name).aliases ?? []) { // (the aliases that the command ended up with, its own and the default ones)
        if (UMBRELLAS[umbrella].groups[alias] !== undefined || UMBRELLAS[umbrella].flat[alias] !== undefined) continue;
        assert.equal(command.prefixWords[alias]?.command, name, `!${umbrella} ${alias} is !${name}`);
      }
    }
  }
  assert.equal(commandFile('prefix').aliases.includes('pfx'), true);
  call = await ran('!config pfx show');
  assert.deepEqual([call.file, call.sub], ['prefix', 'show'], 'an alias of the old command is a word of its group: `!config pfx show` is `!prefix show`');
  assert.ok((await ran('!config zzz show')) === null, 'a word that is not an alias of the command is not read');
  call = await ran(`!community suggestion setup <#${ROOM}>`);
  assert.deepEqual([call.file, call.sub], ['suggestion', 'setup']);
  call = await ran('!community confess I ate it');
  assert.deepEqual([call.file, call.values], ['confess', (await ran('!confess I ate it')).values], '`!community confess` reads the text as `!confess` does');
  call = await ran('!message send hello there');
  assert.equal(call.file, 'send', 'the raw reader of !send reads the message');
  call = await ran('!special counting config');
  assert.deepEqual([call.file, call.sub], ['counting', 'config']);
  restoreSpies();

  // `!config`, `!protect`... alone: the list of groups, not an error; and a word that is nothing is told.
  for (const umbrella of Object.keys(UMBRELLAS)) {
    const alone = await send(`!${umbrella}`);
    assert.equal(alone.called.length, 0);
    assert.equal(alone.sent.length, 1);
    for (const name of [...Object.keys(UMBRELLAS[umbrella].groups), ...Object.keys(UMBRELLAS[umbrella].flat)]) assert.ok(alone.sent[0].includes(`!${umbrella} ${name}\``), `the list of !${umbrella} names ${name}`);
    assert.match(alone.sent[0], /has these ways to use it/);
    assert.ok(alone.sent[0].length < 4000, `the list of !${umbrella} fits in a message (${alone.sent[0].length})`);
    assert.ok(!/is not part of/.test(alone.sent[0]), `!${umbrella} alone is not a mistake`);
    assert.equal((await send(`,${umbrella}`)).sent.length, 1);
    const wrong = await send(`!${umbrella} banana`);
    assert.equal(wrong.called.length, 0);
    assert.match(wrong.sent[0], /is not part of/, 'a word that is not a group or subcommand is told');
  }
  assert.ok((await send('!protect')).sent[0].includes('add, remove, panel'), 'a group lists the subcommands it holds');

  // Everyday words: `petto bot is down` is chat; `!bot` is a command with a symbol prefix.
  for (const word of ['bot', 'auto', 'message', 'special', 'community', 'config', 'protect', 'greet']) assert.equal(await event.knownNameChecker(client, '1')(word), false, `\`petto ${word} ...\` is chat, not a command`);
  assert.equal(await event.knownNameChecker(client, '1')('contrib'), true);
  assert.equal(await event.knownNameChecker(client, '1')('help'), true, 'the real commands are still known');
  spyOn(['version', 'prefix']);
  let chatMessage = await send('petto bot is down again');
  assert.deepEqual([chatMessage.called.length, chatMessage.sent.length], [0, 0], '`petto bot is down` is not answered');
  chatMessage = await send('petto auto sale tomorrow');
  assert.deepEqual([chatMessage.called.length, chatMessage.sent.length], [0, 0]);
  assert.ok((await send('!bot version')).ran, '`!bot` is a command with a symbol prefix');
  assert.ok((await send('petto contrib')).sent.length === 1, '`petto contrib` is a command with a word prefix');
  restoreSpies();

  // ------------------------------------------------------------ the old commands and their words are untouched
  spyOn(wrappedNames);
  for (const [content, file, subName] of [
    ['!prefix show', 'prefix', 'show'], ['!prefix set ?!', 'prefix', 'set'], ['!language es', 'language', null], ['!alias list', 'alias', 'list'], ['!honeypot list', 'honeypot', 'list'], ['!verify status', 'verify', 'status'],
    ['!welcome status', 'welcome', 'status'], ['!leave status', 'leave', 'status'], ['!boost status', 'boost', 'status'], ['!joinrole list', 'joinrole', 'list'], ['!timer list', 'timer', 'list'],
    ['!reaction list', 'reaction', 'list'], ['!sender list', 'sender', 'list'], ['!webhook list', 'webhook', 'list'], ['!panel list', 'panel', 'list'], ['!suggestion setup', 'suggestion', 'setup'],
    ['!confession config', 'confession', 'config'], ['!counting config', 'counting', 'config'], ['!imgonly list', 'imgonly', 'list'], ['!partner stats', 'partner', 'stats'], ['!uploads stats', 'uploads', 'stats'],
    ['!votes top', 'votes', 'top'], ['!uptime', 'uptime', null], ['!version', 'version', null], ['!premium status', 'premium', 'status'],
  ]) {
    const result = await ran(content);
    assert.ok(result, `${content} still runs`);
    assert.deepEqual([result.file, result.sub], [file, subName], `${content} still runs ${file}`);
  }
  assert.equal(client.commandRoutes.get('ytsearch').command, 'youtube', 'a route of an old command is still there');
  assert.equal(client.commandAliases.get('gw'), 'giveaway');
  for (const name of wrappedNames) assert.ok(client.commands.has(name) && !isSlashCommand(commandFile(name)), `!${name} is still a prefix-only command`);
  for (const name of ['afk', 'remind', 'rank', 'suggest', 'top', 'avatar', 'userinfo', 'ban', 'kick', 'purge', 'mod', 'staff', 'game', 'me', 'search', 'server', 'user']) assert.ok(isSlashCommand(commandFile(name)), `/${name} is still a slash command`);
  restoreSpies();

  // ------------------------------------------------------------ SECURITY: the permission of each wrapped command, slash and prefix
  spyOn(wrappedNames);
  const wrongFor = (flag) => (flag === 'ManageGuild' ? F.ManageMessages : F.ManageGuild);
  let checked = 0;
  for (const umbrella of Object.keys(UMBRELLAS)) {
    const command = commandFile(umbrella);
    for (const leaf of leavesOf(umbrella)) {
      const flag = PERMS[leaf.file];
      assert.notEqual(flag, undefined, `${leaf.file} has its permission written in this check`);
      const wanted = flag === null ? null : F[flag];
      const wrapped = commandFile(leaf.file).data.toJSON();
      const registeredBits = wrapped.default_member_permissions == null ? null : BigInt(wrapped.default_member_permissions);
      assert.equal(registeredBits, wanted, `!${leaf.file} asks for ${flag ?? 'nothing'}: what /${umbrella} asks for`);
      assert.equal(command.permissionForSubcommand(leaf.group ?? leaf.name, leaf.group ? leaf.name : null), wanted, `!help ${umbrella} ${leaf.group ?? leaf.name} says ${flag ?? 'anyone'}`);
      const typed = `!${umbrella} ${leaf.group ? `${leaf.group} ` : ''}${leaf.name} ${tailOf(leaf.node)}`.replace(/\s+/g, ' ').trimEnd();
      if (wanted === null) {
        assert.ok((await slash(umbrella, leaf.group, leaf.name, { perms: 0n })).ran, `/${umbrella} ${leaf.name} is for everybody`);
        assert.ok((await send(typed, { perms: 0n })).ran, `${typed} is for everybody`);
        continue;
      }
      checked += 1;
      assert.equal((await slash(umbrella, leaf.group, leaf.name, { perms: wanted })).ran?.file, leaf.file, `/${umbrella} ${leaf.group ?? ''} ${leaf.name} runs for a member with ${flag}`);
      for (const [label, perms] of [['nothing', 0n], ['another permission', wrongFor(flag)]]) {
        const denied = await slash(umbrella, leaf.group, leaf.name, { perms });
        assert.ok(refusedSlash(denied), `/${umbrella} ${leaf.group ?? ''} ${leaf.name} is refused to a member with ${label}`);
        assert.equal(denied.replies.length, 1, 'the refusal is the only answer: the wrapped command did not start');
        assert.match(text(denied.replies[0].payload), new RegExp(`You need the \\*\\*${flag}\\*\\* permission|${flag}`), `and says ${flag}`);
      }
      const got = await send(typed, { perms: wanted });
      assert.equal(got.ran?.file, leaf.file, `${typed} runs for a member with ${flag}: ${got.sent.join('')}`);
      const deniedPrefix = await send(typed, { perms: wrongFor(flag) });
      assert.ok(!deniedPrefix.ran && deniedPrefix.sent.length === 1 && deniedPrefix.sent[0].includes(`\`${flag.replace(/(?<!^)[A-Z]/g, (letter) => `_${letter}`).toLowerCase()}\``), `${typed} is refused to a member with another permission, saying ${flag}: the old command's own refusal`);
      assert.ok(!(await send(typed, { perms: 0n })).ran, `${typed} is refused to a member with nothing`);
    }
  }
  assert.ok(checked > 150, `${checked} privileged subcommands were tried with the exact, a wrong and no permission`);
  // The ones the owner would worry about: the honeypot bans, so it is for administrators; the configuration of Petto is for who manages the server.
  for (const perms of [F.BanMembers, F.ManageGuild, F.ManageRoles]) {
    assert.ok(refusedSlash(await slash('protect', 'honeypot', 'add', { perms })) && !(await send(`!protect honeypot add <#${ROOM}>`, { perms })).ran, 'the honeypot is for administrators only');
  }
  for (const name of ['prefix', 'disablecommand', 'restrictcommand', 'backup']) {
    const first = optionsOf(commandFile('config')).find((each) => each.name === name).options[0].name;
    assert.ok(refusedSlash(await slash('config', name, first, { perms: F.ManageMessages | F.ManageRoles | F.ManageChannels })), `/config ${name} is not for a member who only manages messages, roles or channels`);
  }
  // The roles chosen with `!moderation` are for the everyday moderation actions (ban, kick, mute, role, channel, voice, nuke...): none of the commands
  // wrapped here is one of them, so those roles never open anything of these umbrellas (the gate would honor one if it were added).
  const moderationPermissions = require('../src/utils/moderationPermissions');
  for (const name of wrappedNames) assert.equal(moderationPermissions.actionForCommand(name), null, `${name} has no role chosen with !moderation`);
  moderationRoles = { ban: [MODS], role: [MODS], channel: [MODS], voice: [MODS], nuke: [MODS] };
  assert.ok(refusedSlash(await slash('config', 'prefix', 'show', { perms: 0n, roles: [MODS] })) && refusedSlash(await slash('protect', 'honeypot', 'list', { perms: 0n, roles: [MODS] })), 'a moderation role does not open /config or /protect');
  moderationRoles = {};
  restoreSpies();

  // ------------------------------------------------------------ the rules of a server
  assert.deepEqual(commandRules.ruleNames(commandFile('protect'), { subcommand: 'add', group: 'honeypot' }), ['honeypot', 'protect']);
  assert.deepEqual(commandRules.ruleNames(commandFile('config'), { subcommand: 'recommended' }), ['cmdconfig', 'config']);
  assert.deepEqual(commandRules.ruleNames(commandFile('config'), { subcommand: 'show', group: 'prefix' }), ['prefix', 'config']);
  assert.deepEqual(commandRules.ruleNames(commandFile('config'), { subcommand: 'show', group: 'prefix', via: 'config' }), ['prefix', 'config']);
  assert.deepEqual(commandRules.permissionNames(commandFile('protect'), { subcommand: 'add', group: 'honeypot' }), ['protect', 'honeypot']);
  assert.deepEqual(commandRules.ruleNames(commandFile('act'), { subcommand: 'hug', group: 'love' }), ['hug', 'act'], '/act keeps its own way of naming the rule of an action');
  spyOn(wrappedNames);
  // A rule for the wrapped command stops that group, and only that one, for the slash command and the prefix.
  rules = [{ command: 'honeypot', channel_id: null }];
  let result = await slash('protect', 'honeypot', 'list');
  assert.ok(refusedSlash(result), '/protect honeypot is refused when honeypot is turned off');
  assert.ok(text(result.replies[0].payload).includes('/protect honeypot'), 'the notice names it');
  assert.ok((await slash('protect', 'verify', 'status')).ran, '/protect verify still runs');
  assert.ok(refusedPrefix(await send('!protect honeypot list')), '!protect honeypot is refused when honeypot is turned off');
  assert.ok((await send('!protect verify status')).ran, '!protect verify still runs');
  assert.ok(!(await ran('!honeypot list')), '!honeypot itself is refused too (as before)');
  rules = [{ command: 'language', channel_id: null }];
  assert.ok(refusedSlash(await slash('config', null, 'language')) && refusedPrefix(await send('!config language es')) && (await slash('config', 'prefix', 'show')).ran, 'a rule on a command without subcommands stops its subcommand');
  // The name of the umbrella turns off all of it, and not the old commands.
  for (const umbrella of Object.keys(UMBRELLAS)) {
    rules = [{ command: umbrella, channel_id: null }];
    for (const leaf of leavesOf(umbrella)) {
      assert.ok(refusedSlash(await slash(umbrella, leaf.group, leaf.name)), `/${umbrella} ${leaf.group ?? ''} ${leaf.name} is refused when ${umbrella} is turned off`);
    }
    const sample = leavesOf(umbrella)[0];
    assert.ok(refusedPrefix(await send(`!${umbrella} ${sample.group ? `${sample.group} ` : ''}${sample.name} ${tailOf(sample.node)}`.trim())), `!${umbrella} ${sample.group ?? ''} ${sample.name} is refused when ${umbrella} is turned off`);
    assert.ok(refusedPrefix(await send(`!${umbrella}`)), `!${umbrella} alone is refused too`);
  }
  assert.ok(await ran('!prefix show') && await ran('!honeypot list') && await ran('!timer list'), 'the old commands are not touched by it');
  rules = [{ command: 'timer', channel_id: ROOM }];
  result = await slash('auto', 'timer', 'list', { channelId: ROOM });
  assert.ok(refusedSlash(result) && text(result.replies[0].payload).includes(`<#${ROOM}>`), 'refused in that channel, naming it');
  assert.ok((await slash('auto', 'timer', 'list', { channelId: '666666666666666667' })).ran, 'allowed in another channel');
  assert.ok(refusedPrefix(await send('!auto timer list', { channelId: ROOM })) && (await send('!auto timer list', { channelId: '8' })).ran);
  rules = [];

  // A restriction to roles (`!restrictcommand`): the name of the wrapped command and the one of the umbrella.
  restrictions = { honeypot: [MODS] };
  result = await slash('protect', 'honeypot', 'list', { perms: F.Administrator });
  assert.ok((await slash('protect', 'honeypot', 'list')).ran, 'an administrator always can');
  result = await slash('protect', 'honeypot', 'list', { perms: F.Administrator & 0n | F.ManageGuild });
  assert.ok(!result.ran, 'a member who is not an administrator and has not the role is refused');
  assert.ok((await slash('protect', 'verify', 'status', { perms: F.ManageGuild })).ran, 'another group is not restricted');
  restrictions = { protect: [MODS] };
  assert.ok(!(await slash('protect', 'verify', 'status', { perms: F.ManageGuild })).ran && !(await send('!protect verify status', { perms: F.ManageGuild })).ran, 'a restriction on the umbrella asks for the role in every group, slash and prefix');
  assert.ok((await send('!verify status', { perms: F.ManageGuild })).ran, 'and not for the old commands');
  assert.ok((await slash('protect', 'verify', 'status', { perms: F.ManageGuild, roles: [MODS] })).ran, 'with the role it runs');
  restrictions = {};

  // A permission level (`!permissions`): the one of the wrapped command, and the one of the umbrella.
  levelDenied = new Set(['honeypot']);
  assert.ok(!(await slash('protect', 'honeypot', 'list')).ran && !(await ran('!protect honeypot list')) && (await slash('protect', 'verify', 'status')).ran && (await ran('!protect verify status')), 'the level of honeypot is asked of its group only');
  levelDenied = new Set(['protect']);
  assert.ok(!(await slash('protect', 'verify', 'status')).ran && !(await ran('!protect verify status')) && (await ran('!verify status')), 'the level of /protect is asked for all of it');
  levelDenied = new Set();
  restoreSpies();

  // ------------------------------------------------------------ the list of an option that is filled while it is typed
  const feed = commandFile('feed');
  const feedOption = feed.data.toJSON().options.find((each) => each.name === 'add').options.find((option) => option.autocomplete);
  assert.ok(feedOption, '!feed add has an option that is filled while it is typed');
  const lab = defineUmbrella({ name: 'lab', description: 'A test umbrella.', subcommands: [{ group: 'feed', wraps: 'feed' }, { name: 'language', wraps: 'language' }] });
  const labAdd = lab.data.toJSON().options.find((each) => each.name === 'feed').options.find((each) => each.name === 'add').options.find((option) => option.name === feedOption.name);
  assert.equal(labAdd.autocomplete, true, 'the umbrella keeps the option that is filled while it is typed');
  const originalAutocomplete = feed.autocomplete;
  const asked = [];
  feed.autocomplete = async (interaction) => { asked.push({ sub: interaction.options.getSubcommand(), group: interaction.options.getSubcommandGroup(false), commandName: interaction.commandName, focused: interaction.options.getFocused(true) }); return interaction.respond([{ name: 'one', value: '1' }]); };
  const typing = (group, subName, perms) => {
    const responses = [];
    const interaction = { commandName: 'lab', guildId: GUILD, member: memberWith(perms), options: { getSubcommand: () => subName, getSubcommandGroup: () => group, getFocused: () => ({ name: feedOption.name, value: 'ab' }) }, respond: async (choices) => { responses.push(choices); } };
    return { interaction, responses };
  };
  let typed = typing('feed', 'add', F.ManageGuild);
  await lab.autocomplete(typed.interaction);
  assert.deepEqual(typed.responses, [[{ name: 'one', value: '1' }]], 'the wrapped command fills the list');
  assert.deepEqual(asked, [{ sub: 'add', group: null, commandName: 'feed', focused: { name: feedOption.name, value: 'ab' } }], 'it is asked for the subcommand and the option being typed, as its own');
  typed = typing('feed', 'add', 0n);
  await lab.autocomplete(typed.interaction);
  assert.deepEqual([typed.responses, asked.length], [[[]], 1], 'a member who may not use it gets an empty list and the command is not asked');
  typed = typing(null, 'language', F.ManageGuild);
  await lab.autocomplete(typed.interaction);
  assert.deepEqual([typed.responses, asked.length], [[[]], 1], 'a wrapped command with no list answers an empty one');
  typed = typing(null, 'nothing', F.Administrator);
  await lab.autocomplete(typed.interaction);
  assert.deepEqual(typed.responses, [[]], 'and so does a subcommand that does not exist');
  feed.autocomplete = originalAutocomplete;
  // The handler sends the autocomplete of an umbrella to it (and never fails for the ones that wrap nothing with a list).
  const responses = [];
  const autocompleteBase = { isAutocomplete: () => true, commandName: 'config', commandType: 1, guildId: GUILD, member: memberWith(F.Administrator), options: { getSubcommand: () => 'show', getSubcommandGroup: () => 'prefix', getFocused: () => ({ name: 'x', value: '' }) }, respond: async (choices) => { responses.push(choices); }, client };
  await interactionCreate.execute(new Proxy(autocompleteBase, { get: (target, key) => (key in target ? target[key] : (typeof key === 'string' && /^is[A-Z]/.test(key) ? () => false : undefined)) }), client);
  assert.deepEqual(responses, [[]], '/config answers the autocomplete with an empty list when nothing it wraps has one');
  // Every type of option the wrapped commands use is one that is copied; one that is not is refused loudly, never dropped.
  assert.throws(() => copyOptions({}, [{ name: 'x', description: 'y', type: 99 }]), /cannot copy the option/);
  const types = new Set();
  const walkTypes = (node) => { if (node.type > 2) types.add(node.type); (node.options ?? []).forEach(walkTypes); };
  for (const name of wrappedNames) commandFile(name).data.toJSON().options?.forEach(walkTypes);
  assert.ok([...types].every((type) => [3, 4, 5, 6, 7, 8, 9, 10, 11].includes(type)), `option types in use: ${[...types]}`);

  // ------------------------------------------------------------ Discord: registered, translated, inside the limits
  assert.equal(registered.length, 71, '71 commands registered with Discord (the 38 there were, 9 umbrellas and 24 commands that have subcommands)');
  assert.equal(chat.length, 68, '68 of them slash commands (3 are menus)');
  assert.equal(new Set(chat.map((each) => each.name)).size, chat.length, 'no two slash commands share a name');
  const usage = slotUsage(registered);
  assert.deepEqual([usage.chat.used, usage.chat.limit, usage.chat.free], [68, 100, 32], '32 slots are free, more than the 20 that are kept');
  assert.ok(usage.chat.free >= 20);
  assert.ok(chat.every((each) => each.options.length <= LIMITS.subcommands));
  for (const name of ['botstatus', 'bots', 'guilddebug', 'guildsend', 'leaveguild', 'quests', 'welcomeconfig', 'prefixconfig', 'timerconfig', 'language']) assert.ok(!chat.some((each) => each.name === name), `/${name} stays prefix-only (private, or a generated card)`);
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
  for (const name of NEW_SLASH) {
    const json = registered.find((each) => each.name === name);
    assert.ok(json, `/${name} is registered with Discord, so deploy-commands.js sends it`);
    assert.ok(deployed.some((each) => each.name === name && each.options.length === json.options.length), `deploy-commands.js sends /${name} to Discord`);
    for (const locale of [null, ...LOCALES]) {
      let sum = 0;
      const add = (node) => {
        sum += size(node.name) + size((locale && node.description_localizations?.[locale]) || node.description);
        for (const choice of node.choices ?? []) sum += size(choice.name) + size(choice.value);
        for (const child of node.options ?? []) add(child);
      };
      add(json);
      assert.ok(sum < 8000, `/${name}${locale ? ` [${locale}]` : ''} is ${sum} characters (Discord allows 8000)`);
    }
  }
  for (const [umbrella, spec] of Object.entries(UMBRELLAS)) {
    const json = registered.find((each) => each.name === umbrella);
    walk(json, `/${umbrella}`);
    assert.notEqual(json.description_localizations['es-ES'], json.description);
    assert.notEqual(json.description_localizations['pt-BR'], json.description);
    // Every key of the English catalog of the umbrella has its Spanish and Portuguese text, and a group says what the old command says.
    for (const key of Object.keys(CATALOGS.en).filter((each) => each.startsWith(`cmd.${spec.category}.${umbrella}.`))) assert.ok(CATALOGS.es[key] && CATALOGS['pt-BR'][key], `${key} is in es and pt-BR`);
    for (const group of Object.keys(spec.groups)) {
      const own = json.options.find((each) => each.name === group);
      const oldCategory = path.basename(path.dirname(commandFile(group).filePath ?? require.resolve(`../src/commands/${spec.category}/${group}`)));
      assert.equal(own.description_localizations['es-ES'], CATALOGS.es[`cmd.${oldCategory}.${group}.desc`], `/${umbrella} ${group} is described in Spanish like !${group}`);
      assert.equal(own.description_localizations['pt-BR'], CATALOGS['pt-BR'][`cmd.${oldCategory}.${group}.desc`]);
      for (const subCommand of own.options) assert.equal(subCommand.description_localizations['es-ES'], CATALOGS.es[`cmd.${oldCategory}.${group}.${subCommand.name}.desc`], `/${umbrella} ${group} ${subCommand.name} is translated like !${group} ${subCommand.name}`);
    }
  }
  assert.ok(size(commandSize(registered.find((each) => each.name === 'config'))) > 0);

  // ------------------------------------------------------------ the short aliases
  for (const umbrella of Object.keys(UMBRELLAS)) {
    const own = Object.entries(SHORT_ALIAS_TABLE).filter(([, target]) => target.startsWith(`${umbrella} `));
    assert.ok(own.length >= leavesOf(umbrella).length * 0.5, `/${umbrella} has short aliases for its subcommands (${own.length} of ${leavesOf(umbrella).length})`);
    for (const [alias, target] of own) {
      const route = client.commandRoutes.get(alias);
      assert.ok(route && route.short && route.command === umbrella && route.subcommand === target.slice(umbrella.length + 1), `${alias} is the short alias of ${target}`);
      assert.ok(/^[a-z]{2,5}$/.test(alias), `${alias} is letters only`);
    }
  }
  // No word that already worked changed meaning: the table only grew.
  const before = require('node:child_process').execSync('git show HEAD:src/utils/short-aliases.json', { cwd: root, encoding: 'utf8' });
  for (const [alias, target] of Object.entries(JSON.parse(before))) assert.equal(SHORT_ALIAS_TABLE[alias], target, `${alias} is still ${target}`);
  spyOn(wrappedNames);
  const shortOf = (target) => Object.entries(SHORT_ALIAS_TABLE).find(([, value]) => value === target)[0];
  call = await ran(`!${shortOf('protect honeypot list')}`);
  assert.deepEqual([call.file, call.sub], ['honeypot', 'list'], 'a short alias runs the subcommand');
  assert.ok(!(await send(`!${shortOf('protect honeypot add')} <#${ROOM}>`, { perms: F.ManageGuild })).ran, 'a short alias asks for the permission too');
  assert.ok((await send(`!${shortOf('protect honeypot add')} <#${ROOM}>`, { perms: F.Administrator })).ran);
  restoreSpies();

  console.log('check-umbrellas-3: ok');
  setTimeout(() => process.exit(0), 10);
})().catch((err) => { console.error(err); process.exit(1); });
