// Checks that every member can use the commands that are for everybody, and that nobody can use the ones that change the server:
//   - a plain member (no permissions, no roles, in a server with no rules at all) goes through the REAL pipelines: the prefix (`messageCreateCommands`:
//     the word prefixes, `knownNameChecker`/`commonWords`, the aliases and routes, `prefixWords`, cooldowns, disabled and restricted commands, permission
//     levels and the permission the command declares) and the slash command (`interactionCreate` and the permission an umbrella asks for each subcommand);
//   - every command is in ONE of three lists written here: the ones for everybody (EVERYDAY), the ones that are open at Discord but ask for the permission
//     of each subcommand inside (SELF_GATED, with what a plain member may do) and the private tools of the team (TEAM); everything else MUST declare a
//     permission (the table of what a plain member cannot use is printed with `node scripts/check-member-access.js --table`);
//   - every leaf (subcommand) that a plain member can start is run against fakes that record what it writes (the database layers) and what it changes in the
//     server (ban, roles, channels, messages...): only what is in OWN_DATA may write, and nothing may change the server;
//   - `ping` and the everyday commands answer a plain member through both pipelines, and the 15 most used commands build their answer end to end;
//   - the design of ALL the registered commands as Discord and the people see them: required options come first, names and descriptions are fine in
//     en, es and pt-BR, nothing is longer than Discord accepts.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const DEV = '900000000000000001';
process.env.PETTO_DEVELOPER_IDS = DEV;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ApplicationCommandOptionType, Collection, MessageFlags, PermissionFlagsBits, PermissionsBitField } = require('discord.js');

const root = path.join(__dirname, '..');
const SHOW_TABLE = process.argv.includes('--table');
function stub(relative, exports) {
  const resolved = require.resolve(path.join(root, relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
function patch(relative, overrides) {
  return Object.assign(require(path.join(root, relative)), overrides);
}

// ---------------------------------------------------------------- a server with no rules at all, in memory
// The database is a chain that answers nothing (no rows) to every query, and records the writes while a leaf is probed.
const queryWrites = [];
function chain(table, state = { single: false }) {
  const proxy = new Proxy(function chained() {}, {
    get(target, key) {
      if (key === 'then') return (resolve) => resolve({ data: state.single ? null : [], error: null, count: 0 });
      if (typeof key === 'symbol') return undefined;
      return (...args) => {
        if (probing && ['insert', 'update', 'upsert', 'delete'].includes(key)) queryWrites.push(`database.${table}.${key}`);
        if (key === 'single' || key === 'maybeSingle') state.single = true;
        return proxy;
      };
    },
  });
  return proxy;
}
let probing = false;
stub('src/db/database.js', { from: (table) => chain(table), rpc: (name) => chain(`rpc:${name}`) });
const guildRow = { prefix: '!', prefixes: ['!', 'petto'], language: 'en' };
patch('src/db/guilds.js', { ensureGuild: async () => guildRow, getGuild: async () => guildRow });
patch('src/db/commandAliases.js', { get: async () => null });
patch('src/db/customCommands.js', { getCommand: async () => null });
patch('src/db/disabledCommands.js', { findCached: async () => null, canonicalizeStored: async () => 0 });
patch('src/db/commandRestrictions.js', { restrictionMap: async () => ({}) });
patch('src/db/permissions.js', { hasCommandPermission: async () => true, listGroups: async () => [] });
patch('src/utils/sharedCooldown.js', { getRemainingCooldownShared: async () => 0 });
patch('src/utils/userPrefixAccess.js', { activeUserPrefix: async () => null });
patch('src/utils/codeTriggers.js', { findTrigger: async () => null });
patch('src/utils/codeCommands.js', { runCodeCommand: async () => true });
patch('src/logging/extraLog.js', { logCommandUse() {} });
patch('src/utils/cardService.js', { plainMessage: async (text) => ({ content: text }) });
patch('src/utils/logger.js', { info() {}, warn() {}, error() {} });
patch('src/utils/moderationPermissions.js', { hasConfiguredRole: async () => false });

// Every function of the database layers is wrapped before the commands load (they keep what they destructure): the ones that write something (by their
// name) are recorded while a leaf is probed and do nothing; any other can be replaced by a fake (`fakes`, `'module.function'`) for the end to end runs.
const writes = [];
const fakes = new Map();
const WRITE = /^(set|create|add|insert|update|upsert|delete|remove|save|reset|clear|enable|disable|toggle|record|give|grant|revoke|block|unblock|cancel|bump|increment|register|store|put|append|purge|wipe|apply|import|publish|post|open|close|claim|unclaim|rename|transfer|move|lock|unlock|ban|kick|mute|unmute|warn|log)([A-Z0-9_]|$)/;
for (const file of fs.readdirSync(path.join(root, 'src', 'db'))) {
  if (!file.endsWith('.js') || file === 'database.js' || file === 'postgres.js') continue;
  let module;
  try { module = require(path.join(root, 'src', 'db', file)); } catch { continue; }
  for (const [name, fn] of Object.entries(module)) {
    if (typeof fn !== 'function' || Object.getOwnPropertyDescriptor(module, name)?.writable === false) continue;
    const key = `${file.slice(0, -3)}.${name}`;
    const isWrite = WRITE.test(name);
    module[name] = function wrapped(...args) {
      if (probing && isWrite) writes.push(key);
      if (fakes.has(key)) return fakes.get(key).apply(this, args);
      if (probing && isWrite) return Promise.resolve({ id: 1 });
      return fn.apply(this, args);
    };
  }
}

const { loadCommands, collectCommandData, isSlashCommand } = require('../src/handlers/commandHandler');
const event = require('../src/events/messageCreateCommands');
const interactionCreate = require('../src/events/interactionCreate');
const { permissionBitsOf } = require('../src/utils/umbrella');
const { t, CATALOGS } = require('../src/i18n');

const F = PermissionFlagsBits;
const GUILD = '444444444444444444';
const ROOM = '666666666666666666';
const ANA = '111111111111111111';
const BEA = '222222222222222222';
const fakeUser = (id) => ({ id, username: `user${id.slice(-3)}`, bot: false, tag: `user${id.slice(-3)}`, globalName: null, discriminator: '0', createdTimestamp: 1_600_000_000_000, toString: () => `<@${id}>`, displayAvatarURL: () => 'https://example.com/a.png', bannerURL: () => null, send: async () => ({}), flags: { toArray: () => [] }, fetch: async function fetched() { return this; } });
const client = { user: { id: '123', ...fakeUser('123') }, users: { fetch: async (id) => fakeUser(id), cache: new Collection() }, ws: { ping: 42 }, shard: null, guilds: { cache: new Collection() }, channels: { cache: new Collection(), fetch: async () => null }, fetchInvite: async () => null, application: { commands: { fetch: async () => new Collection() }, fetch: async () => ({ owner: null }) }, uptime: 360_000, readyTimestamp: Date.now() - 360_000 };
loadCommands(client);
const all = [...client.commands.values()].filter((command) => (command.data.toJSON().type ?? 1) === 1);
const byName = new Map(all.map((command) => [command.data.name, command]));
const json = (command) => command.data.toJSON();
const leavesOf = (command) => {
  const top = json(command).options ?? [];
  if (!top.some((option) => option.type === 1 || option.type === 2)) return [{ path: [], node: json(command) }];
  return top.flatMap((option) => (option.type === 1 ? [{ path: [option.name], node: option }] : option.type === 2 ? (option.options ?? []).map((sub) => ({ path: [option.name, sub.name], node: sub })) : []));
};
/** The names a rule can be saved under for a subcommand of an umbrella (`!disablecommand`, `!restrictcommand`): the old command it wraps, and any other it also stands for. */
const commandRulesOf = (command, sub) => require('../src/utils/commandRules').ruleNames(command, { subcommand: sub });
const permissionName = (raw) => (raw == null ? null : new PermissionsBitField(BigInt(raw)).toArray().join(' + ') || null);

// ---------------------------------------------------------------- what was decided (written here, apart from the commands)
// Open at Discord and in the code, for everybody (read something, or work on the member's own data).
const EVERYDAY = new Set([
  'ping', 'help', 'avatar', 'banner', 'userinfo', 'serverinfo', 'roleinfo', 'channelinfo', 'emojiinfo', 'inviteinfo', 'botinfo', 'uptime', 'version', 'snowflake', 'spotify', 'usercosmetics',
  'channels', 'roles', 'emojis', 'boosters', 'inrole', 'firstmessage', 'color', 'permissions', 'activity', 'summary', 'votes', 'premium', 'globalranking', 'cmdconfig',
  'afk', 'remind', 'poll', 'rank', 'top', 'birthday', 'suggest', 'time', 'calc', 'choose', 'roll', 'weather', 'wiki', 'jumbo', 'confess', 'profile', 'myprefix', 'profilehistory',
  '8ball', 'coinflip', 'neverhaveiever', 'quote', 'rps', 'ship', 'truthordare', 'uwu', 'wouldyourather', 'act', 'image',
  'anilist', 'animal', 'chess', 'crypto', 'currency', 'deezer', 'github', 'itunes', 'lastfm', 'minecraft', 'modrinth', 'package', 'pokemon', 'roblox', 'steam', 'tmdb', 'twitch', 'wikipedia', 'youtube',
  'partner', 'request', 'review', 'uploads', 'stats',
  // /server and /user: lookups (their subcommands are the old info commands); `/server steal` asks for Manage Guild Expressions inside.
  'server', 'user',
  // /ai (`!ask`, `/ai ask`, `/ai usage`): open to every member on purpose. `ask` has a daily limit for free members inside (scripts/check-ask.js); `usage` only reads.
  'ai',
]);
// Open at Discord but each subcommand asks for what it needs inside: `MEMBER` is what a plain member may start (everyone, or the author of the ticket, the post or
// the voice channel; the rest asks for Manage Server or a staff role and refuses a plain member).
const SELF_GATED = {
  ticket: { MEMBER: ['open', 'close', 'request-close', 'add', 'remove', 'rename', 'transcript', 'claim', 'unclaim', 'reopen', 'delete', 'note', 'priority', 'transfer'], why: 'a member opens and manages their own ticket; the setup is for the staff' },
  forum: { MEMBER: ['lock', 'unlock', 'close', 'reopen', 'solved', 'unsolved', 'rename', 'tag', 'claim', 'unclaim', 'move', 'list'], why: 'the author of a post manages it; the setup is for the staff' },
  form: { MEMBER: [], why: 'forms are managed by Manage Server or the reviewers' },
  voicemaster: { MEMBER: ['info', 'panel', 'lock', 'unlock', 'ghost', 'reveal', 'claim', 'delete', 'rename', 'transfer', 'limit', 'permit', 'reject', 'disconnect', 'activity'], why: 'the owner of a voice channel manages it; the setup is for the staff' },
  confession: { MEMBER: [], why: 'anybody confesses with `confess`; setup is for Manage Server, the review for the staff roles' },
  suggestion: { MEMBER: [], why: 'anybody suggests with `suggest`; setup is for Manage Server, the review for the staff roles' },
  quickreply: { MEMBER: ['send', 'list'], why: 'quick replies are used by anybody who may; adding them is for the staff' },
  rollouts: { MEMBER: ['list', 'help'], why: 'the setup is for Manage Server' },
  imgonly: { MEMBER: ['list'], why: 'the setup is for Manage Server' },
  urlonly: { MEMBER: ['list', 'sites'], why: 'the setup is for Manage Server' },
  counting: { MEMBER: ['stats', 'leaderboard', 'next', 'config'], why: 'the setup is for Manage Server' },
  boosterrole: { MEMBER: ['create', 'color', 'rename', 'icon', 'random', 'remove', 'share', 'unshare', 'shared'], why: 'boosters manage their own role; admin and filter are for the staff' },
  report: { MEMBER: ['send'], why: 'anybody reports; the setup and the review are for the staff' },
  rep: { MEMBER: ['give', 'view', 'leaderboard'], why: 'reputation is given by members; reset is for Manage Server' },
  invites: { MEMBER: ['user', 'top', 'who', 'list', 'codes'], why: 'members look at the invites; bonus, config, reward and reset are for Manage Server' },
};
// The private tools of the Petto team: open in the pipeline, they answer only to the owner and PETTO_DEVELOPER_IDS inside.
const TEAM = new Set(['bots', 'botstatus', 'guildsend', 'leaveguild', 'quests', 'guilddebug', 'music']);


// ---------------------------------------------------------------- a fake Discord for the probes: it records what changes the server
const mutations = [];
const mut = (name) => async () => { if (probing) mutations.push(name); return { id: '999999999999999999', toString: () => '<@&999999999999999999>' }; };
const plainPerms = new PermissionsBitField(0n);
function makeMember(id, { perms = plainPerms } = {}) {
  const cache = new Collection();
  const user = { ...fakeUser(id), send: mut('user.send') };
  return {
    id, user, guild: null, nickname: null, displayName: user.username, joinedTimestamp: 1_650_000_000_000, premiumSince: null, permissions: perms, roles: { cache, highest: { position: 1, id: 'role0' }, add: mut('member.roles.add'), remove: mut('member.roles.remove'), set: mut('member.roles.set') },
    displayAvatarURL: () => 'https://example.com/a.png', toString: () => `<@${id}>`, kick: mut('member.kick'), ban: mut('member.ban'), timeout: mut('member.timeout'), setNickname: mut('member.setNickname'), edit: mut('member.edit'),
    manageable: false, kickable: false, bannable: false, moderatable: false, voice: { channel: null, channelId: null }, presence: null, communicationDisabledUntilTimestamp: null,
  };
}
function makeServer() {
  const guild = {
    id: GUILD, name: 'Petto Test', ownerId: '1', memberCount: 12, description: null, premiumTier: 0, premiumSubscriptionCount: 0, createdTimestamp: 1_600_000_000_000, vanityURLCode: null, preferredLocale: 'en-US',
    iconURL: () => 'https://example.com/i.png', bannerURL: () => null, splashURL: () => null, features: [], verificationLevel: 1, afkChannelId: null, systemChannelId: null, rulesChannelId: null, publicUpdatesChannelId: null,
    members: { cache: new Collection(), fetch: async (id) => (typeof id === 'string' ? guild.members.cache.get(id) ?? Promise.reject(new Error('Unknown Member')) : guild.members.cache), ban: mut('guild.members.ban'), kick: mut('guild.members.kick'), unban: mut('guild.members.unban'), edit: mut('guild.members.edit'), prune: mut('guild.members.prune') },
    roles: { cache: new Collection(), fetch: async () => guild.roles.cache, create: mut('guild.roles.create'), edit: mut('guild.roles.edit'), delete: mut('guild.roles.delete') },
    channels: { cache: new Collection(), fetch: async () => guild.channels.cache, create: mut('guild.channels.create'), edit: mut('guild.channels.edit'), delete: mut('guild.channels.delete'), setPositions: mut('guild.channels.setPositions') },
    emojis: { cache: new Collection(), fetch: async () => new Collection(), create: mut('guild.emojis.create') }, stickers: { cache: new Collection(), fetch: async () => new Collection() },
    invites: { fetch: async () => new Collection(), create: mut('guild.invites.create'), delete: mut('guild.invites.delete') }, bans: { fetch: async () => new Collection(), create: mut('guild.bans.create'), remove: mut('guild.bans.remove') },
    scheduledEvents: { cache: new Collection(), fetch: async () => new Collection() }, commands: { fetch: async () => new Collection() },
    edit: mut('guild.edit'), setName: mut('guild.setName'), leave: mut('guild.leave'), fetchOwner: async () => guild.members.cache.get('1'), fetchWebhooks: async () => new Collection(), fetchAuditLogs: async () => ({ entries: new Collection() }),
    autoModerationRules: { cache: new Collection(), fetch: async () => new Collection(), create: mut('guild.autoModerationRules.create'), delete: mut('guild.autoModerationRules.delete'), edit: mut('guild.autoModerationRules.edit') },
    toString: () => 'Petto Test',
  };
  const everyone = { id: GUILD, name: '@everyone', position: 0, managed: false, permissions: new PermissionsBitField(0n), toString: () => '@everyone', members: new Collection() };
  guild.roles.cache.set(GUILD, everyone);
  guild.roles.everyone = everyone;
  const owner = makeMember('1', { perms: new PermissionsBitField(PermissionsBitField.All) });
  const plain = makeMember(ANA);
  const other = makeMember(BEA);
  const me = makeMember('123', { perms: new PermissionsBitField(PermissionsBitField.All) });
  for (const member of [owner, plain, other, me]) { member.guild = guild; guild.members.cache.set(member.id, member); }
  guild.members.me = me;
  client.guilds.cache.set(GUILD, guild);
  const channel = {
    id: ROOM, name: 'room', type: 0, guild, guildId: GUILD, parentId: null, topic: null, nsfw: false, rateLimitPerUser: 0, position: 1, createdTimestamp: 1_600_000_000_000, toString: () => `<#${ROOM}>`,
    isTextBased: () => true, isVoiceBased: () => false, isThread: () => false, isDMBased: () => false, permissionsFor: (who) => who?.permissions ?? new PermissionsBitField(PermissionsBitField.All),
    permissionOverwrites: { cache: new Collection(), edit: mut('channel.permissionOverwrites.edit'), set: mut('channel.permissionOverwrites.set'), create: mut('channel.permissionOverwrites.create'), delete: mut('channel.permissionOverwrites.delete') },
    messages: { cache: new Collection(), fetch: async () => new Collection(), delete: mut('channel.messages.delete') },
    send: mut('channel.send'), edit: mut('channel.edit'), delete: mut('channel.delete'), setName: mut('channel.setName'), setTopic: mut('channel.setTopic'), setParent: mut('channel.setParent'), bulkDelete: mut('channel.bulkDelete'),
    setRateLimitPerUser: mut('channel.setRateLimitPerUser'), createWebhook: mut('channel.createWebhook'), fetchWebhooks: async () => new Collection(), sendTyping: async () => {}, threads: { create: mut('channel.threads.create'), cache: new Collection(), fetchActive: async () => ({ threads: new Collection() }) },
    createInvite: mut('channel.createInvite'), fetch: async () => channel,
  };
  guild.channels.cache.set(ROOM, channel);
  return { guild, channel, plain, other, me, owner };
}
/** What a person types for each option, by its type: the same value every time, inside the limits of the option. */
function valueFor(option, { guild, channel }) {
  switch (option.type) {
    case ApplicationCommandOptionType.String: return option.choices?.length ? option.choices[0].value : `v-${option.name}`.slice(0, option.max_length ?? 99);
    case ApplicationCommandOptionType.Integer: case ApplicationCommandOptionType.Number: return Math.min(Math.max(option.min_value ?? 3, 3), option.max_value ?? 1000);
    case ApplicationCommandOptionType.Boolean: return true;
    case ApplicationCommandOptionType.User: case ApplicationCommandOptionType.Mentionable: return guild.members.cache.get(BEA).user;
    case ApplicationCommandOptionType.Channel: return channel;
    case ApplicationCommandOptionType.Role: return guild.roles.cache.get(GUILD);
    case ApplicationCommandOptionType.Attachment: return { url: 'https://example.com/a.png', name: 'a.png', contentType: 'image/png', size: 100 };
    default: return null;
  }
}
/** A slash interaction of a member for one leaf: `{ interaction, replies }`. */
function interactionFor(server, member, leaf, { command = null, values: given = {} } = {}) {
  const replies = [];
  const sub = leaf.path.at(-1) ?? null;
  const group = leaf.path.length === 2 ? leaf.path[0] : null;
  const values = { ...Object.fromEntries((leaf.node.options ?? []).filter((option) => option.type > 2).map((option) => [option.name, valueFor(option, server)])), ...given };
  const get = (name, required) => {
    const value = values[name] ?? null;
    if (value === null && required) throw new Error(`Missing ${name}`);
    return value;
  };
  const base = {
    id: '777777777777777701', commandName: command?.data.name ?? 'x', commandType: 1, user: member.user, member, guild: server.guild, guildId: GUILD, channel: server.channel, channelId: ROOM,
    locale: 'en-US', guildLocale: 'en-US', pettoLang: 'en', typedPrefix: '/', client, createdTimestamp: Date.now(), deferred: false, replied: false, ephemeral: false,
    options: {
      getSubcommand: (required = true) => { if (!sub && required) throw new Error('No subcommand'); return sub; },
      getSubcommandGroup: (required = true) => { if (!group && required) throw new Error('No group'); return group; },
      getString: get, getInteger: get, getNumber: get, getBoolean: get, getUser: get, getChannel: get, getRole: get, getAttachment: get, getMentionable: get,
      getMember: (name) => (values[name] ? server.guild.members.cache.get(values[name].id) ?? null : null), getFocused: () => '', data: [],
    },
    isChatInputCommand: () => true, isRepliable: () => true,
    reply: async (payload) => { replies.push(payload); base.replied = true; return { id: '1', createMessageComponentCollector: () => ({ on() {} }), awaitMessageComponent: async () => { throw new Error('timeout'); } }; },
    deferReply: async (payload) => { replies.push(payload ?? {}); base.deferred = true; },
    editReply: async (payload) => { replies.push(payload); return { id: '1', createMessageComponentCollector: () => ({ on() {} }) }; },
    followUp: async (payload) => { replies.push(payload); return { id: '1' }; },
    fetchReply: async () => ({ id: '1', createdTimestamp: Date.now() + 20 }), deleteReply: async () => {}, showModal: async () => { replies.push({ modal: true }); }, respond: async () => {},
  };
  const interaction = new Proxy(base, { get: (target, key) => (key in target ? target[key] : (typeof key === 'string' && /^is[A-Z]/.test(key) ? () => false : undefined)) });
  return { interaction, replies };
}
const textOf = (payload) => JSON.stringify(JSON.parse(JSON.stringify(payload ?? {})));

// ---------------------------------------------------------------- the inventory
const registered = new Set(collectCommandData().map((entry) => entry.name));
const listOf = (command) => (EVERYDAY.has(command.data.name) ? 'everyday' : SELF_GATED[command.data.name] ? 'self-gated' : TEAM.has(command.data.name) ? 'team' : null);
const open = []; // the commands with no permission at Discord
const declared = []; // the ones that declare it: what a plain member cannot use
for (const command of all) {
  const raw = json(command).default_member_permissions;
  if (command.umbrella || command.permissionForSubcommand) open.push(command); // an umbrella is open and asks for each subcommand inside
  else if (raw == null) open.push(command);
  else declared.push(command);
}


// What a plain member may write: their own data, nothing else. `command leaf`: why.
const OWN_DATA = {
  'lastfm unlink': 'forgets their own Last.fm name', 'afk set': 'their own AFK status', 'birthday set': 'their own birthday', 'birthday remove': 'their own birthday',
  'globalranking on': 'their own visibility in the public ranking', 'globalranking off': 'their own visibility in the public ranking',
  'me birthday': 'their own birthday', 'me birthday-remove': 'their own birthday', 'me prefix-reset': 'their own prefix', 'me history-clear': 'their own saved names',
  'me history-record': 'their own choice to save names', 'me names': 'their own names (it saves the current one)', 'me nicknames': 'their own nicknames (it saves the current one)',
  'me ranking-on': 'their own visibility in the public ranking', 'me ranking-off': 'their own visibility in the public ranking', 'me lastfm-unlink': 'forgets their own Last.fm name',
  'me rep-give': 'giving a reputation point is for every member', 'myprefix reset': 'their own prefix', 'profilehistory clear': 'their own saved names',
  'profilehistory record': 'their own choice to save names', 'profilehistory names': 'their own names (it saves the current one)', 'profilehistory nicknames': 'their own nicknames (it saves the current one)',
  'remind cancel': 'their own reminder', 'rep give': 'giving a reputation point is for every member',
  'review remove': 'their own review', 'community review remove': 'their own review',
};
const FLAGS_EPHEMERAL = 64;
const isEphemeral = (payload) => { const f = payload?.flags; return Boolean(payload?.ephemeral) || (Array.isArray(f) ? f.includes(FLAGS_EPHEMERAL) : typeof f === 'number' && (f & FLAGS_EPHEMERAL) === FLAGS_EPHEMERAL); };
const flatText = (value) => { const out = []; const walk = (node) => { if (Array.isArray(node)) node.forEach(walk); else if (node && typeof node === 'object') { for (const key of ['content', 'description', 'title', 'name', 'value', 'text']) if (typeof node[key] === 'string') out.push(node[key]); Object.values(node).forEach(walk); } }; walk(JSON.parse(JSON.stringify(value ?? {}))); return out.join(' ').replace(/\s+/g, ' ').trim(); };

// The permission a command that is for the staff declares (checked one by one, the rest is listed in the table).
const DECLARED = {
  ban: 'BanMembers', unban: 'BanMembers', softban: 'BanMembers', tempban: 'BanMembers', hardban: 'BanMembers', kick: 'KickMembers', warn: 'ModerateMembers', mute: 'ModerateMembers', timeout: 'ModerateMembers', unmute: 'ModerateMembers',
  tempmute: 'ModerateMembers', jail: 'ModerateMembers', note: 'ModerateMembers', case: 'ModerateMembers', history: 'ModerateMembers', automod: 'ModerateMembers', purge: 'ManageMessages', snipe: 'ManageMessages', channel: 'ManageChannels', nuke: 'ManageChannels',
  role: 'ManageRoles', nickname: 'ManageNicknames', thread: 'ManageThreads', lockdown: 'Administrator', massban: 'Administrator', masskick: 'Administrator', stripstaff: 'Administrator', antinuke: 'Administrator', honeypot: 'Administrator',
  prefix: 'ManageGuild', setup: 'ManageGuild', level: 'ManageGuild', giveaway: 'ManageGuild', embed: 'ManageGuild', customcommand: 'ManageGuild', disablecommand: 'ManageGuild', restrictcommand: 'ManageGuild', permission: 'ManageGuild', logs: 'ManageGuild',
  language: 'ManageGuild', alias: 'ManageGuild', backup: 'ManageGuild', moderation: 'ManageGuild', feed: 'ManageGuild', starboard: 'ManageGuild', identity: 'ManageGuild', timer: 'ManageGuild', antiscam: 'ManageGuild', vanity: 'ManageGuild',
  reactionrole: 'ManageRoles', stickyroles: 'ManageRoles', joinrole: 'ManageRoles', welcome: 'ManageGuild', leave: 'ManageGuild', boost: 'ManageGuild', webhook: 'ManageWebhooks', counter: 'ManageChannels', autothread: 'ManageChannels', send: 'ManageMessages',
};
// `/serverinfo`, `/userinfo`, `/avatar`, `/unban`, `/purge` and `/timeout` are not slash commands any more (their umbrella subcommand has every option and action of
// them): what is left are the ones whose old command has more than the umbrella wraps (`/ban` has 7 subcommands, `/kick` 2, `/warn` 3, `/channel` 13).
const UMBRELLA_TWINS = ['mod ban = /ban', 'mod kick = /kick', 'mod warn = /warn', 'mod lock = /channel', 'mod unlock = /channel', 'mod slowmode = /channel'];
const REMOVED_TWINS = { serverinfo: 'server info', userinfo: 'user info', avatar: 'user avatar', unban: 'mod unban', purge: 'mod purge', timeout: 'mod tempmute' };

// ---------------------------------------------------------------- the fake message of the prefix, and what the pipelines did
const executed = [];
const spied = [];
function spyOn(commands) {
  // The subcommands an umbrella answers by itself (`/server icon`) are recorded like the ones that run a wrapped command.
  for (const command of commands.concat(all.filter((each) => each.permissionForSubcommand))) {
    for (const entry of command.subcommands ?? []) {
      if (!entry.run || entry.spied) continue;
      entry.spied = true;
      entry.run = async function ownRun(interaction) { executed.push({ name: command.data.name, sub: entry.name, group: null, user: interaction.user.id }); };
    }
  }
  for (const command of commands) {
    spied.push([command, command.execute]);
    command.execute = async function spy(interaction) {
      executed.push({ name: command.data.name, sub: interaction.options.getSubcommand(false), group: interaction.options.getSubcommandGroup?.(false) ?? null, user: interaction.user.id });
    };
  }
}
const unspy = () => { for (const [command, original] of spied.splice(0)) command.execute = original; };
let seq = 0;
const missingPermission = t('en', 'core.missingPermission', { permission: 'XXXX' }).split('XXXX')[0];
/** A message typed by a member in a server with no rules: `{ sent, ran, denied }` (denied: the missing-permission answer; ran: a command of Petto started). */
async function typed(content, { as = ANA, perms = 0n, guildId = null } = {}) {
  seq += 1;
  const sent = [];
  const before = executed.length;
  const id = guildId ?? `5${String(seq).padStart(12, '0')}`;
  const guild = { id, name: 'Petto Test', ownerId: '1', members: { cache: new Collection(), fetch: async () => new Collection() }, channels: { cache: new Collection() }, roles: { cache: new Collection() } };
  const message = {
    content, author: { id: as, bot: false, toString: () => `<@${as}>` }, guild, client,
    member: { id: as, guild: { ownerId: '1' }, permissions: new PermissionsBitField(perms), roles: { cache: new Collection(), highest: { position: 1 } } },
    mentions: { users: new Map(), roles: new Map(), channels: new Map(), members: new Map() }, attachments: new Map(), reference: null,
    channel: { id: ROOM, sendTyping: async () => {}, send: async (payload) => { sent.push(flatText(payload)); return {}; } },
    reply: async (payload) => { sent.push(flatText(payload)); return { id: '1', createdTimestamp: Date.now() + 20, delete: async () => {}, edit: async (edit) => { sent.push(flatText(edit)); } }; },
  };
  event.setCachedPrefix(guild.id, guildRow.prefixes);
  await event.execute(message);
  const texts = sent.map((text) => text);
  return { sent: texts, ran: executed.slice(before), denied: texts.some((text) => text.includes(missingPermission.trim())), isCommand: await event.isCommandMessage(message) };
}
/** `/command leaf` typed by a plain member through interactionCreate: `{ ran, replies }`. */
async function slashOf(command, leaf, { perms = 0n } = {}) {
  seq += 1;
  const server = makeServer();
  const member = makeMember(ANA, { perms: new PermissionsBitField(perms) });
  member.guild = server.guild;
  const { interaction, replies } = interactionFor(server, member, leaf, { command });
  interaction.commandName = command.data.name;
  const before = executed.length;
  await interactionCreate.execute(interaction, client);
  return { ran: executed.slice(before), replies };
}

(async () => {
  const table = [];
  // ---------------------------------------------------------- 1. every command is in a list, and what is open is on purpose
  const unclassified = [];
  const wronglyDeclared = [];
  for (const command of all) {
    const name = command.data.name;
    const raw = json(command).default_member_permissions;
    const isUmbrella = Boolean(command.umbrella || command.permissionForSubcommand);
    const listed = listOf(command);
    if (raw == null && !isUmbrella && !listed) unclassified.push(name);
    if (raw != null && (listed || isUmbrella)) wronglyDeclared.push(`${name} (${listed ?? 'umbrella'}) declares ${permissionName(raw)} but is meant for everybody`);
  }
  assert.deepEqual(wronglyDeclared, [], 'a command that is meant for everybody declares a permission: a plain member cannot use it');
  assert.deepEqual(unclassified, [], `commands open to everybody that nobody listed as meant to be (add them to EVERYDAY, SELF_GATED or TEAM here if they are, or give them a permission): ${unclassified.join(', ')}`);
  for (const name of [...EVERYDAY, ...Object.keys(SELF_GATED), ...TEAM]) assert.ok(byName.has(name) || name === 'music' && byName.has('music'), `${name} is in a list here but is not a command (any more)`);
  for (const [name, spec] of Object.entries(SELF_GATED)) {
    const leaves = leavesOf(byName.get(name)).map((leaf) => leaf.path.join(' '));
    for (const sub of spec.MEMBER) assert.ok(leaves.some((leaf) => leaf === sub || leaf.startsWith(`${sub} `)), `${name} ${sub} is a subcommand a plain member may use, and it does not exist`);
    assert.match(fs.readFileSync(require.resolve(`../src/commands/${byName.get(name).category}/${name}.js`), 'utf8'), /permissions\??\.has\(|requireManageGuild|canManage|isPettoOperator|canUseRollouts/, `${name} asks for the permission of its staff subcommands inside`);
  }
  // The ones that declare a permission, as in the table of what a plain member cannot use.
  for (const command of declared) {
    const raw = json(command).default_member_permissions;
    table.push([command.data.name, command.category, permissionName(raw), 'declares it']);
    if (DECLARED[command.data.name]) {
      const expected = new PermissionsBitField(F[DECLARED[command.data.name]]).bitfield;
      assert.ok((BigInt(raw) & expected) === expected, `${command.data.name} asks for ${DECLARED[command.data.name]} and asks for ${permissionName(raw)}`);
    }
  }
  for (const name of Object.keys(DECLARED)) assert.ok(byName.has(name), `${name} is a command`);
  // The generated `!<name>config` cards of the commands for everybody are for who manages the server.
  for (const command of all.filter((each) => each.generatedCard)) assert.equal(BigInt(json(command).default_member_permissions), F.ManageGuild, `${command.data.name} asks for Manage Server`);
  // A staff leaf of an umbrella asks for what the command it wraps asks for (the umbrellas are open, so this is where it is decided).
  const staffLeaves = [];
  for (const command of open.filter((each) => each.permissionForSubcommand)) {
    for (const leaf of leavesOf(command)) {
      let bits = null;
      try { bits = command.permissionForSubcommand(leaf.path[0], leaf.path[1]); } catch { bits = null; }
      if (bits != null) { table.push([`${command.data.name} ${leaf.path.join(' ')}`, command.category, permissionName(bits), 'asks for it when it runs']); staffLeaves.push(`${command.data.name} ${leaf.path.join(' ')}`); }
    }
  }
  assert.ok(staffLeaves.length > 200, `the umbrellas ask for a permission in ${staffLeaves.length} subcommands`);
  for (const must of ['mod ban', 'mod kick', 'mod purge', 'mod warn', 'mod lock', 'staff massban', 'staff nuke', 'config prefix', 'config disablecommand', 'protect honeypot', 'greet welcome']) {
    assert.ok(staffLeaves.some((leaf) => leaf.startsWith(must)), `${must} asks for a permission`);
  }
  if (SHOW_TABLE) console.log(table.map((row) => row.join(' | ')).join('\n'));

  // ---------------------------------------------------------- 2. what a plain member can start changes nothing outside their own data
  const server = makeServer();
  const found = [];
  for (const command of open) {
    for (const leaf of leavesOf(command)) {
      writes.length = 0; mutations.length = 0; queryWrites.length = 0;
      const { interaction, replies } = interactionFor(server, server.plain, leaf, { command });
      probing = true;
      let error = null;
      try { await command.execute.call(command, interaction, client); } catch (err) { error = err; }
      probing = false;
      found.push({ name: command.data.name, leaf: leaf.path.join(' '), writes: [...new Set([...writes, ...queryWrites])], mutations: [...new Set(mutations)], replies, error: error?.message ?? null, userFacing: Boolean(error?.userFacing) });
    }
  }
  assert.ok(found.length > 700, `${found.length} subcommands were run as a plain member`);
  // (a refusal thrown on purpose reaches the member as it is; a database that is not there is the only thing that cannot be faked)
  const crashed = found.filter((entry) => entry.error && !entry.userFacing && !/ECONNREFUSED/.test(entry.error));
  assert.deepEqual(crashed.map((entry) => `${entry.name} ${entry.leaf}: ${entry.error}`), [], 'a plain member never makes a command fail: it is answered');
  const changedServer = found.filter((entry) => entry.mutations.length);
  assert.deepEqual(changedServer.map((entry) => `${entry.name} ${entry.leaf}: ${entry.mutations.join(', ')}`), [], 'SECURITY: nothing that a plain member can start changes the server (bans, roles, channels, messages...)');
  const wrote = found.filter((entry) => entry.writes.length && !OWN_DATA[`${entry.name} ${entry.leaf}`.trim()]);
  assert.deepEqual(wrote.map((entry) => `${entry.name} ${entry.leaf}: ${entry.writes.join(', ')}`), [], 'SECURITY: a plain member only writes their own data (OWN_DATA says which)');
  for (const key of Object.keys(OWN_DATA)) assert.ok(found.some((entry) => `${entry.name} ${entry.leaf}`.trim() === key && entry.writes.length), `${key} is in OWN_DATA and writes nothing (any more)`);
  // The staff subcommands of a command open at Discord refuse a plain member (ephemeral on the slash command, so the channel does not see it).
  const MUST_REFUSE = ['form create', 'form delete', 'form set', 'form panel', 'rollouts enable', 'rollouts role', 'invites bonus', 'invites config', 'invites reward add', 'invites reset', 'counting setup', 'counting disable', 'counting reset', 'quickreply add', 'quickreply remove',
    'imgonly add', 'imgonly remove', 'urlonly add', 'urlonly remove', 'rep reset', 'report config', 'report disable', 'forum setup', 'forum panel', 'forum delete', 'ticket panel create', 'ticket category add', 'ticket setup', 'confession setup', 'suggestion setup',
    'voicemaster setup', 'voicemaster disable', 'boosterrole admin set', 'boosterrole admin remove', 'boosterrole admin base', 'boosterrole admin cooldown', 'boosterrole filter add', 'premium grant', 'premium revoke', 'server steal', 'mod ban', 'mod purge', 'staff massban', 'config prefix set', 'protect honeypot add', 'greet welcome setup', 'auto timer'];
  const publicRefusals = [];
  for (const key of MUST_REFUSE) {
    const entry = found.find((each) => `${each.name} ${each.leaf}`.trim().startsWith(key) || `${each.name} ${each.leaf}`.trim() === key);
    assert.ok(entry, `${key} is a subcommand`);
    assert.ok(!entry.writes.length && !entry.mutations.length, `${key} changed something for a plain member`);
    if (entry.replies.length && !entry.replies.some(isEphemeral) && !entry.error) publicRefusals.push(key);
  }
  assert.deepEqual(publicRefusals, [], 'a refusal is told in private on the slash command');

  // ---------------------------------------------------------- 2b. `ask` and `ai usage` are open to a plain member on purpose, in every way they are typed (a fake model and a fake count)
  {
    const askAi = require('../src/utils/askAi');
    const ticketAi = require('../src/utils/ticketAi');
    const askUsage = require('../src/db/askUsage');
    const originalChat = ticketAi.chat;
    const originalUsage = { consume: askUsage.consume, refund: askUsage.refund, usedOn: askUsage.usedOn };
    const counts = new Map();
    const modelSaw = [];
    process.env.GROQ_API_KEY = 'check-only-key';
    process.env.ASK_COOLDOWN_FREE_SECONDS = '0';
    ticketAi.chat = async (messages) => { modelSaw.push(messages.at(-1).content); return { ok: true, content: 'Cats are small mammals.' }; };
    Object.assign(askUsage, {
      consume: async (user, day, limit) => { const used = counts.get(user) ?? 0; if (used >= limit) return { ok: false, used }; counts.set(user, used + 1); return { ok: true, used: used + 1 }; },
      refund: async (user) => { counts.set(user, Math.max(0, (counts.get(user) ?? 0) - 1)); },
      usedOn: async (user) => counts.get(user) ?? 0,
    });
    try {
      const ai = byName.get('ai');
      assert.ok(ai && EVERYDAY.has('ai'), '/ai is a command, listed as open to everybody');
      assert.equal(json(ai).default_member_permissions ?? null, null, '/ai declares no permission');
      assert.deepEqual([ai.permissionForSubcommand('ask'), ai.permissionForSubcommand('usage')], [null, null], 'and asks for none inside');
      for (const text of ['!ask what is a cat?', 'petto ask what is a cat?', '<@123> ask what is a cat?', '!ai ask what is a cat?']) {
        askAi.resetState();
        modelSaw.length = 0;
        const result = await typed(text);
        assert.equal(result.denied, false, `a plain member typing \`${text}\` is not refused for a permission`);
        assert.equal(modelSaw.length, 1, `\`${text}\` reaches the model for a plain member`);
        assert.ok(result.sent.length === 1 && result.sent[0].includes('Cats are small mammals.') && result.sent[0].includes('Answered by AI'), `and is answered (${result.sent[0]})`);
      }
      for (const text of ['!ai usage', '!askusage', 'petto askusage']) {
        askAi.resetState();
        const result = await typed(text);
        assert.equal(result.denied, false); assert.ok(result.sent.length === 1 && /questions? left today/.test(result.sent[0]), `\`${text}\` tells a plain member how many are left (${result.sent[0]})`);
      }
      assert.ok((await typed('!ai')).sent.length === 1, '`!ai` alone lists what it holds');
      assert.equal((await typed('petto ai is cool')).sent.length, 0, '`petto ai` is chat');
      for (const leaf of leavesOf(ai)) {
        askAi.resetState();
        counts.clear();
        const result = await slashOf(ai, leaf);
        assert.ok(result.replies.length >= 1, `/ai ${leaf.path.join(' ')} answers a plain member`);
        const text = result.replies.map(flatText).join(' / ');
        assert.ok(leaf.path[0] === 'ask' ? text.includes('Cats are small mammals.') : /questions? left today/.test(text), `/ai ${leaf.path.join(' ')} for a plain member: ${text.slice(0, 120)}`);
      }
      // A plain member only writes their own count, and Premium and the team are not counted.
      assert.deepEqual([...counts.keys()].filter((id) => id !== ANA), [], 'only the count of the member who asked is written');
    } finally {
      ticketAi.chat = originalChat;
      Object.assign(askUsage, originalUsage);
      askAi.resetState();
      delete process.env.GROQ_API_KEY; delete process.env.ASK_COOLDOWN_FREE_SECONDS;
    }
  }

  // ---------------------------------------------------------- 3. the real pipelines, as a plain member
  spyOn(all.filter((command) => !command.permissionForSubcommand));
  const results = new Map();
  for (const command of all) {
    const name = command.data.name;
    const isUmbrella = Boolean(command.permissionForSubcommand);
    const raw = json(command).default_member_permissions;
    if (command.hiddenEverywhere) { assert.deepEqual((await typed(`!${name}`)).sent, [], `!${name} is not a command for a plain member (check-music-hidden.js)`); continue; }
    const result = await typed(`!${name}`);
    results.set(name, result);
    if (command.slashOnly) { assert.equal(result.ran.length, 0, `!${name} is slash only`); continue; }
    if (raw != null) assert.equal(result.denied, true, `a plain member typing !${name} is told what permission is missing (${permissionName(raw)})`);
    else assert.equal(result.denied, false, `a plain member typing !${name} is not refused for a permission`);
    if (raw == null && !isUmbrella && !command.privateGuildId) assert.ok(result.ran.length === 1 || result.sent.length > 0, `!${name} answers a plain member (it runs, or it says how to write it)`);
    if (isUmbrella && command.prefixDefaultSubcommand) assert.ok(result.ran.length === 1, `!${name} alone runs its default subcommand`);
    else if (isUmbrella) assert.ok(result.sent.length === 1, `!${name} alone lists what it holds`);
  }
  // Slash: a plain member starts every leaf of the commands the pipeline lets through; the umbrellas refuse the staff ones, in private, and run nothing.
  let slashRun = 0;
  let slashRefused = 0;
  for (const command of open.filter((each) => isSlashCommand(each))) {
    const isUmbrella = Boolean(command.permissionForSubcommand);
    for (const leaf of leavesOf(command)) {
      let bits = null;
      if (isUmbrella) { try { bits = command.permissionForSubcommand(leaf.path[0], leaf.path[1]); } catch { bits = null; } }
      if (isUmbrella && !command.execute.length && false) continue;
      const result = await slashOf(command, leaf);
      if (isUmbrella) {
        if (bits == null) { assert.equal(result.ran.length, 1, `/${command.data.name} ${leaf.path.join(' ')} is for everybody and a plain member starts it`); slashRun += 1; }
        else { assert.equal(result.ran.length, 0, `/${command.data.name} ${leaf.path.join(' ')} asks for ${permissionName(bits)} and a plain member cannot start it`); assert.ok(result.replies.length === 1 && isEphemeral(result.replies[0]), `and is told in private`); slashRefused += 1; }
      } else {
        assert.equal(result.ran.length, 1, `/${command.data.name} reaches its code for a plain member`);
        slashRun += 1;
      }
    }
  }
  assert.ok(slashRun > 300 && slashRefused > 150, `${slashRun} slash subcommands start for a plain member and ${slashRefused} are refused`);
  // The prefix and the word prefix reach what is for everybody (a word that is also everyday speech is chat after a word prefix, and works with a symbol).
  const chatWords = [];
  for (const command of all.filter((each) => !each.slashOnly && !each.privateGuildId && !each.hiddenEverywhere && json(each).default_member_permissions == null && !TEAM.has(each.data.name))) {
    const name = command.data.name;
    const word = await typed(`petto ${name}`);
    const symbol = results.get(name);
    if (!(word.ran.length || word.sent.length)) { chatWords.push(name); assert.ok(symbol.ran.length || symbol.sent.length, `!${name} works with a symbol prefix`); }
    for (const alias of (command.aliases ?? [])) {
      const through = await typed(`!${alias}`);
      assert.ok(through.ran.length === 1 || through.sent.length > 0 || command.permissionForSubcommand, `!${alias} (alias of ${name}) works`);
    }
  }
  // The words that are everyday speech after a word prefix (`petto me ayudas`) are exactly the ones in the list of common words: nothing else is swallowed.
  const { isCommonWord } = require('../src/utils/commonWords');
  assert.deepEqual(chatWords.filter((name) => !isCommonWord(name)), [], 'only everyday words (utils/commonWords.js) are chat after a word prefix; every other command word starts the command');
  unspy();

  // ---------------------------------------------------------- 4. ping, in every way a member types it
  assert.equal(client.commandAliases.get('p'), 'ping', '`p` is the alias of ping');
  assert.ok(!client.commandRoutes.has('p') && !client.commandRoutes.has('ping') && !client.commands.has('p'), 'nothing else takes `p` or `ping`');
  assert.ok(!isCommonWord('ping') && !isCommonWord('p'), 'ping and p are not everyday words: they work after a word prefix too');
  const ping = byName.get('ping');
  assert.equal(json(ping).default_member_permissions ?? null, null, 'ping declares no permission');
  assert.equal(ping.cooldownMs ?? 3000, 3000, 'ping has the usual cooldown');
  assert.equal(isSlashCommand(ping), true, '/ping is registered with Discord');
  assert.ok(registered.has('ping'), '/ping is in the commands sent to Discord');
  assert.equal(ping.data.toJSON().default_member_permissions ?? null, null);
  spyOn([ping]);
  for (const text of ['!ping', '!PING', '!p', 'petto ping', 'PETTO ping', 'petto p', '<@123> ping', '<@!123> p', '!ping extra words']) {
    const result = await typed(text);
    assert.equal(result.ran.length, 1, `\`${text}\` runs ping for a plain member (${JSON.stringify(result.sent)})`);
    assert.equal(result.denied, false);
  }
  assert.equal((await slashOf(ping, { path: [], node: json(ping) })).ran.length, 1, '/ping runs for a plain member');
  unspy();
  // End to end with the real ping: the prefix path answers with both latencies, and so does the slash command.
  const pinged = await typed('!ping');
  assert.ok(pinged.sent.length >= 1 && /ms/.test(pinged.sent.at(-1)), `!ping answers with the latencies: ${pinged.sent.at(-1)}`);
  const pingSlash = interactionFor(server, server.plain, { path: [], node: json(ping) }, { command: ping });
  await ping.execute(pingSlash.interaction);
  assert.ok(/ms/.test(flatText(pingSlash.replies.at(-1))), '/ping answers with the latencies');
  // What a member sees when something of the server stops it (the only ways, as a table of what the code answers).
  const refusals = {
    disabled: t('en', 'core.disabled.server', { emoji: '', command: '!ping' }).trim(),
    restricted: t('en', 'core.restricted', { command: 'ping', roles: '<@&1>' }),
    level: t('en', 'core.missingLevel', { prefix: '!', command: 'ping' }),
    cooldown: t('en', 'core.cooldown', { seconds: '3', prefix: '!', command: 'ping' }),
  };
  for (const text of Object.values(refusals)) assert.ok(text.length > 10, 'each refusal is a sentence');
  {
    // !disablecommand ping, !restrictcommand ping and !permissions command ping 5: each gives its own answer, never silence.
    const disabledDb = require('../src/db/disabledCommands');
    const restrictionsDb = require('../src/db/commandRestrictions');
    const permissionsDb = require('../src/db/permissions');
    spyOn([ping]);
    const originals = { find: disabledDb.findCached, restricted: restrictionsDb.restrictionMap, level: permissionsDb.hasCommandPermission };
    try {
      disabledDb.findCached = async (guildId, name) => (name === 'ping' ? { channel_id: null } : null);
      let r = await typed('!ping');
      assert.equal(r.ran.length, 0); assert.ok(r.sent.length === 1 && /turned off|disabled/i.test(r.sent[0]), `!disablecommand ping: the member is told it is turned off (${r.sent[0]})`);
      disabledDb.findCached = originals.find;
      permissionsDb.hasCommandPermission = async (guildId, name) => name !== 'ping';
      r = await typed('!ping');
      assert.equal(r.ran.length, 0); assert.ok(r.sent.length === 1 && /permission level/i.test(r.sent[0]), `!permissions command ping 5: the member is told the level is missing (${r.sent[0]})`);
      permissionsDb.hasCommandPermission = originals.level;
      // !restrictcommand ping @Role: only that role (administrators always can); a plain member is told which roles.
      restrictionsDb.restrictionMap = async () => ({ ping: ['900000000000000009'] });
      r = await typed('!ping');
      assert.equal(r.ran.length, 0); assert.ok(r.sent.length === 1 && /Only members with/i.test(r.sent[0]), `!restrictcommand ping: the member is told which roles may use it (${r.sent[0]})`);
    } finally {
      disabledDb.findCached = originals.find; restrictionsDb.restrictionMap = originals.restricted; permissionsDb.hasCommandPermission = originals.level;
    }
    unspy();
  }

  // ---------------------------------------------------------- 4b. the everyday commands are open for everybody, in the slash command and with the prefix; /ping is global
  {
    const { Routes } = require('discord.js');
    const config = require('../src/config');
    const { deployCommands } = require('../src/handlers/deployCommands');
    const { collectPrivateGuildCommandData } = require('../src/handlers/commandHandler');
    // `ping`, `help`, `uptime`, `version` and the three that moved into /server and /user: no permission at Discord, no team gate, no private server.
    const OPEN = ['ping', 'help', 'avatar', 'userinfo', 'serverinfo', 'uptime', 'version'];
    for (const name of OPEN) {
      const command = byName.get(name);
      assert.ok(command, `${name} is a command`);
      assert.equal(json(command).default_member_permissions ?? null, null, `${name} declares no permission`);
      assert.ok(!command.privateGuildId && !command.hiddenEverywhere && !command.hiddenFromHelp && !command.slashOnly, `${name} is not private, hidden or slash only`);
      assert.ok(!TEAM.has(name), `${name} is not a tool of the team`);
      spyOn([command]);
      for (const text of [`!${name}`, `petto ${name}`, `<@123> ${name}`]) {
        const result = await typed(text);
        assert.equal(result.denied, false, `a plain member typing \`${text}\` is not refused`);
        assert.equal(result.ran.length, 1, `\`${text}\` runs ${name} for a plain member (${JSON.stringify(result.sent)})`);
      }
      for (const alias of command.aliases ?? []) assert.equal((await typed(`!${alias}`)).ran.length, 1, `!${alias} (alias of ${name}) runs it for a plain member`);
      unspy();
    }
    // Slash: `/ping` and `/help` themselves, and the umbrella subcommand that replaced the other three (open, no permission asked inside).
    spyOn([byName.get('ping'), byName.get('help'), byName.get('serverinfo'), byName.get('userinfo'), byName.get('avatar')]);
    for (const name of ['ping', 'help']) {
      assert.ok(isSlashCommand(byName.get(name)), `/${name} is a slash command`);
      assert.equal((await slashOf(byName.get(name), { path: [], node: json(byName.get(name)) })).ran.length, 1, `/${name} runs for a plain member`);
    }
    for (const [umbrella, sub, ran] of [['server', 'info', 'serverinfo'], ['user', 'info', 'userinfo'], ['user', 'avatar', 'avatar']]) {
      const command = byName.get(umbrella);
      const leaf = leavesOf(command).find((each) => each.path[0] === sub);
      assert.equal(command.permissionForSubcommand?.(sub) ?? null, null, `/${umbrella} ${sub} asks for no permission`);
      const result = await slashOf(command, leaf);
      assert.deepEqual(result.ran.map((entry) => entry.name), [ran], `/${umbrella} ${sub} runs ${ran} for a plain member`);
    }
    unspy();
    // The slash commands the umbrellas replaced are not registered, and the old command keeps its prefix, its aliases and the rules by name.
    const inDiscord = new Set(collectCommandData().map((entry) => entry.name));
    for (const [old, replacement] of Object.entries(REMOVED_TWINS)) {
      assert.ok(byName.has(old) && !inDiscord.has(old) && !isSlashCommand(byName.get(old)), `/${old} is not a slash command any more (${replacement} replaces it) and !${old} is still loaded`);
      const [umbrella, sub] = replacement.split(' ');
      const rules = commandRulesOf(byName.get(umbrella), sub);
      assert.ok(rules.includes(old), `a rule saved for ${old} also reaches /${replacement} (${rules.join(', ')})`);
    }
    // /ping in the registration: no default_member_permissions, no dm-only or team contexts, in the global commands and in no private server.
    const pingJson = collectCommandData().find((entry) => entry.name === 'ping');
    assert.ok(pingJson, '/ping is registered');
    assert.ok(!('default_member_permissions' in pingJson) || pingJson.default_member_permissions == null, '/ping has no default_member_permissions');
    assert.ok(!pingJson.contexts && !pingJson.integration_types, '/ping does not narrow where it can be used');
    assert.ok(!collectPrivateGuildCommandData().some((entry) => entry.data.name === 'ping'), '/ping is not a command of one private server');
    const puts = [];
    const fakeRest = { get: async () => [], put: async (route, { body }) => { puts.push({ route, names: body.map((entry) => entry.name) }); return body; } };
    const fakeSettings = { getSetting: async () => null, setSetting: async () => {} };
    const saved = config.devGuildIds; const savedOne = config.devGuildId;
    config.devGuildIds = []; config.devGuildId = null;
    try { await deployCommands({ force: true, strict: true, rest: fakeRest, settings: fakeSettings }); } finally { config.devGuildIds = saved; config.devGuildId = savedOne; }
    const global = puts.find((entry) => entry.route === Routes.applicationCommands(config.clientId));
    assert.ok(global && global.names.includes('ping') && global.names.includes('help'), 'with no test server set, /ping is in the GLOBAL registration, so every server has it');
    assert.ok(!puts.some((entry) => entry.route !== Routes.applicationCommands(config.clientId) && entry.names.includes('ping')), '/ping is not registered in one server only');
  }

  // ---------------------------------------------------------- 5. the design of every command as Discord and the people see it
  const data = collectCommandData();
  const problems = [];
  const walk = (node, where) => {
    const options = node.options ?? [];
    let optional = false;
    for (const option of options.filter((each) => each.type > 2)) {
      if (!option.required) optional = true;
      else if (optional) problems.push(`${where}: the required option ${option.name} comes after an optional one (Discord refuses it)`);
    }
    for (const child of options) {
      const label = `${where} ${child.name}`;
      if (!/^[-_\p{L}\p{N}]{1,32}$/u.test(child.name) || child.name !== child.name.toLowerCase()) problems.push(`${label}: odd name`);
      if (!child.description || child.description.length > 100) problems.push(`${label}: its description is empty or longer than 100 characters`);
      for (const lang of ['es-ES', 'pt-BR']) if ((child.type <= 2) && !child.description_localizations?.[lang]) problems.push(`${label}: no ${lang} description`);
      if ((child.choices?.length ?? 0) > 25) problems.push(`${label}: more than 25 choices`);
      if (child.type <= 2) walk(child, label);
    }
    if ((options.filter((each) => each.type <= 2).length) > 25) problems.push(`${where}: more than 25 subcommands`);
  };
  for (const entry of data) {
    if ((entry.type ?? 1) !== 1) continue;
    for (const lang of ['es-ES', 'pt-BR']) if (!entry.description_localizations?.[lang]) problems.push(`/${entry.name}: no ${lang} description`);
    if (!entry.description || entry.description.length > 100) problems.push(`/${entry.name}: its description is empty or longer than 100 characters`);
    walk(entry, `/${entry.name}`);
  }
  assert.deepEqual(problems, [], 'every registered command: required options first, clear names, descriptions in en, es and pt-BR');
  // No command has an absurd cooldown (the slash and the prefix use the same one).
  const slow = all.filter((command) => (command.cooldownMs ?? 0) > 10_000).map((command) => `${command.data.name}: ${command.cooldownMs}ms`);
  assert.deepEqual(slow, [], 'no cooldown above 10 seconds');
  // The commands that are in two places: an umbrella subcommand and the old command, both slash commands (kept on purpose, a decision of the owner for later).
  const slashNames = new Set(data.map((entry) => entry.name));
  const twins = [];
  for (const command of all) for (const [sub, wrapped] of Object.entries(command.ruleKeys ?? {})) if (slashNames.has(wrapped)) twins.push(`${command.data.name} ${sub} = /${wrapped}`);
  assert.deepEqual(twins, UMBRELLA_TWINS, 'the umbrella subcommands that also exist as a slash command of their own (the list is written here so a new one is a decision)');

  // ---------------------------------------------------------- 6. the 15 most used commands, end to end: the answer is built, with no error
  {
    const level = { enabled: true, xp_per_message: 15, xp_curve: 'default', rank_style: 'embed', base_xp: 100, xp_multiplier: 1.2 };
    fakes.set('levelConfig.getConfig', async () => level);
    fakes.set('levelUsers.getUser', async (guildId, userId) => ({ guild_id: guildId, user_id: userId, xp: 1500, level: 5, voice_xp: 0, voice_level: 0, messages: 40 }));
    fakes.set('levelUsers.getRank', async () => 2);
    fakes.set('levelUsers.countRanked', async () => 14);
    fakes.set('levelUsers.getLeaderboardPage', async () => [{ user_id: BEA, xp: 1500, level: 5 }, { user_id: ANA, xp: 900, level: 3 }]);
    fakes.set('reminders.createReminder', async (row) => ({ id: 7, ...row }));
    fakes.set('reminders.listActive', async () => [{ id: 7, remind_at: new Date(Date.now() + 3_600_000), message: 'water' }]);
    fakes.set('afk.setStatus', async () => ({}));
    fakes.set('modActions.createCase', async (row) => ({ ...row, case_number: 42, created_at: new Date(), id: 1 }));
    fakes.set('modActions.getActiveSanction', async () => null);
    fakes.set('warns.addWarn', async (row) => ({ modCase: { ...row, type: 'warn', case_number: 43, created_at: new Date(), id: 2 }, warnCount: 1 }));
    const live = makeServer();
    const moderator = makeMember('777777777777777777', { perms: new PermissionsBitField(PermissionsBitField.All) });
    moderator.guild = live.guild; moderator.roles.highest = { position: 10, id: 'mod' }; live.guild.members.cache.set(moderator.id, moderator);
    const target = live.other;
    Object.assign(target, { manageable: true, kickable: true, bannable: true, moderatable: true, send: async () => ({}) });
    target.roles.highest = { position: 5, id: 'low' };
    live.guild.members.me.roles.highest = { position: 30, id: 'me' };
    Object.assign(live.guild.members.me, { permissions: new PermissionsBitField(PermissionsBitField.All) });
    live.guild.members.ban = async (id) => { banned.push(id); return {}; };
    const banned = [];
    Object.assign(target, { ban: async () => { banned.push(target.id); }, kick: async () => { kicked.push(target.id); } });
    const kicked = [];
    const answered = [];
    const GENERIC = t('en', 'core.error');
    async function endToEnd(name, path, values, who = live.plain, { include = null } = {}) {
      const command = byName.get(name);
      const leaf = { path, node: path.length ? (json(command).options ?? []).find((option) => option.name === path[0]) : json(command) };
      const { interaction, replies } = interactionFor(live, who, leaf, { command, values });
      interaction.user = who.user;
      await command.execute.call(command, interaction, client);
      const text = replies.map(flatText).join(' / ');
      assert.ok(replies.length >= 1 && text.length > 0, `${name} ${path.join(' ')} answers`);
      assert.ok(!text.includes(GENERIC), `${name} ${path.join(' ')} does not answer "${GENERIC}" (${text.slice(0, 160)})`);
      if (include) assert.match(text, include, `${name} ${path.join(' ')}: ${text.slice(0, 200)}`);
      answered.push(name);
      return { replies, text };
    }
    await endToEnd('ping', [], {}, live.plain, { include: /ms/ });
    await endToEnd('help', [], {}, live.plain, { include: /./ });
    await endToEnd('help', [], { command: 'ban' }, live.plain, { include: /ban/i });
    await endToEnd('help', [], { command: 'ping' }, live.plain, { include: /ping/i });
    await endToEnd('avatar', [], {}, live.plain, { include: /avatar/i });
    await endToEnd('userinfo', [], {}, live.plain, { include: /user/i });
    await endToEnd('serverinfo', [], { server: null }, live.plain, { include: /Petto Test/ });
    await endToEnd('rank', [], {}, live.plain, { include: /level|rank|XP/i });
    await endToEnd('top', [], {}, live.plain, { include: /./ });
    {
      // The buttons of /top: somebody else pressing one is told whose it is (it used to fail without a word), and the author turns the page.
      const command = byName.get('top');
      const { interaction } = interactionFor(live, live.plain, { path: [], node: json(command) }, { command, values: { page: 1, type: null, period: null } });
      const handlers = {};
      interaction.editReply = async () => ({ createMessageComponentCollector: () => ({ on: (name, fn) => { handlers[name] = fn; }, stop() {} }), edit: async () => {} });
      interaction.typedPrefix = '!';
      await command.execute.call(command, interaction, client);
      assert.equal(typeof handlers.collect, 'function', 'the ranking has page buttons (14 members, 2 pages)');
      const pressed = [];
      const press = (userId, customId) => ({ user: { id: userId }, customId, reply: async (payload) => { pressed.push(['reply', payload]); }, update: async (payload) => { pressed.push(['update', payload]); } });
      await handlers.collect(press(BEA, 'top_next'));
      assert.equal(pressed.length, 1);
      assert.equal(pressed[0][0], 'reply', 'somebody else is answered, not ignored');
      assert.ok(isEphemeral(pressed[0][1]) && pressed[0][1].content === t('en', 'leveling.top.notYours', { prefix: '!' }), 'in private, with what to do');
      for (const lang of ['es', 'pt-BR']) assert.ok(t(lang, 'leveling.top.notYours', { prefix: '!' }).includes('!top') && t(lang, 'leveling.top.notYours', { prefix: '!' }) !== t('en', 'leveling.top.notYours', { prefix: '!' }), `translated to ${lang}`);
      await handlers.collect(press(ANA, 'top_next'));
      assert.equal(pressed[1][0], 'update', 'the author turns the page');
    }
    await endToEnd('afk', ['set'], { reason: 'lunch' }, live.plain, { include: /lunch/ });
    await endToEnd('remind', ['add'], { duration: '1h', message: 'water' }, live.plain, { include: /#7|1 hour|1h/i });
    await endToEnd('remind', ['list'], {}, live.plain, { include: /water/ });
    await endToEnd('poll', [], {}, live.plain, { include: /./ });
    await endToEnd('ban', ['user'], { user: target.user, reason: 'spam' }, moderator, { include: /./ });
    await endToEnd('kick', ['user'], { user: target.user, reason: 'spam' }, moderator, { include: /./ });
    await endToEnd('warn', ['user'], { user: target.user, reason: 'spam' }, moderator, { include: /./ });
    await endToEnd('mute', ['user'], { user: target.user, reason: 'spam' }, moderator, { include: /./ });
    await endToEnd('purge', [], { amount: 5, user: null, filter: null, text: null, starts_with: null, ends_with: null, before: null, after: null }, moderator, { include: /./ });
    assert.deepEqual([...new Set(answered)].sort(), ['afk', 'avatar', 'ban', 'help', 'kick', 'mute', 'ping', 'poll', 'purge', 'rank', 'remind', 'serverinfo', 'top', 'userinfo', 'warn'], 'the 15 most used commands were run');
    // A plain member typing the moderation commands is told what is missing, with the permission, and nothing happens.
    for (const [name, path] of [['ban', ['user']], ['kick', ['user']], ['warn', ['user']], ['mute', ['user']], ['purge', []]]) {
      const command = byName.get(name);
      const leaf = { path, node: path.length ? json(command).options.find((option) => option.name === path[0]) : json(command) };
      const { interaction, replies } = interactionFor(live, live.plain, leaf, { command, values: { user: target.user, reason: 'x', amount: 5, filter: null, text: null, starts_with: null, ends_with: null, before: null, after: null } });
      const before = banned.length + kicked.length;
      await command.execute.call(command, interaction, client).catch(() => {});
      assert.equal(banned.length + kicked.length, before, `${name}: a plain member did not ban or kick anybody`);
      assert.ok(replies.length && /need|permission/i.test(replies.map(flatText).join(' ')), `${name}: a plain member is told which permission is missing (${replies.map(flatText).join(' ').slice(0, 120)})`);
    }
    assert.ok(banned.length >= 1 && kicked.length >= 1, 'the moderator really banned and kicked in the fake server');
    fakes.clear();
  }

  console.log('check-member-access: ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
