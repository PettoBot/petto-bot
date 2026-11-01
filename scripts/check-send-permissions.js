// Who may make Petto post a message for them (`!send`, `/message send` and every route that reaches them), tested with honest fakes: REAL PermissionsBitField
// objects, channel overwrites computed the way Discord computes them, and the real pipelines (prefix: messageCreateCommands, slash: interactionCreate and the
// umbrella). Nothing here answers "allowed" by default. What is decided here:
//   - `send` needs Manage Messages in the SERVER (what the default permission of the command means) AND to see, write and have Manage Messages in the channel it
//     posts to: a permission that only a channel overwrite gives is not enough, the prefix and the slash command decide the same way;
//   - the check happens before anything is read or sent, on every route (`!send`, `petto send`, `@Petto send`, `!message send`, the short alias, a server alias,
//     `/message send`), a refusal is private (ephemeral for the slash command) and names the permission;
//   - a member that cannot be read (no permissions, a raw string, null) is a member who may not;
//   - `!restrictcommand`, a permission level (`!permission`) and a `!moderation` role can only add limits: they never open `send`.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Collection, PermissionFlagsBits: F, PermissionsBitField } = require('discord.js');

const root = path.join(__dirname, '..');
function stub(relative, exports) {
  const resolved = require.resolve(path.join(root, relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
function patch(relative, overrides) { return Object.assign(require(path.join(root, relative)), overrides); }
global.fetch = async () => { throw new Error('no network in the checks'); };

// ---------------------------------------------------------------- the rules of the server, in memory (the tests change them)
const rules = { restricted: {}, levels: {}, groups: [], disabled: new Set() };
// The database answers from `rules` for the tables of the permission levels (the real functions of src/db/permissions.js run on top of it), and nothing for the rest.
function chain(table) {
  const state = { single: false, filters: {} };
  const answer = () => {
    if (table === 'command_permission_levels') {
      const level = rules.levels[state.filters.command_name];
      return state.single ? { data: level === undefined ? null : { required_level: level }, error: null } : { data: [], error: null };
    }
    if (table === 'permission_groups') return { data: rules.groups.map(({ members, ...group }) => ({ guild_id: GUILD, ...group })), error: null };
    if (table === 'permission_group_members') return { data: rules.groups.flatMap((group) => group.members.map((member) => ({ group_id: group.id, ...member }))), error: null };
    return { data: state.single ? null : [], error: null, count: 0 };
  };
  const proxy = new Proxy(function chained() {}, {
    get(target, key) {
      if (key === 'then') return (resolve) => resolve(answer());
      if (typeof key === 'symbol') return undefined;
      return (...args) => {
        if (key === 'single' || key === 'maybeSingle') state.single = true;
        if (key === 'eq') state.filters[args[0]] = args[1];
        return proxy;
      };
    },
  });
  return proxy;
}
stub('src/db/database.js', { from: (table) => chain(table), rpc: () => chain('rpc') });
const guildRow = { prefix: '!', prefixes: ['!', 'petto'], language: 'en' };
patch('src/db/guilds.js', { ensureGuild: async () => guildRow, getGuild: async () => guildRow });
patch('src/db/commandAliases.js', { get: async () => null });
patch('src/db/customCommands.js', { getCommand: async () => null });
patch('src/db/disabledCommands.js', { findCached: async (guildId, name) => (rules.disabled.has(name) ? { channel_id: null } : null), canonicalizeStored: async () => 0 });
patch('src/db/commandRestrictions.js', { restrictionMap: async () => rules.restricted });
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
const { t } = require('../src/i18n');

// ---------------------------------------------------------------- a server with honest permissions
const GUILD = '444444444444444444';
const ROOM = '666666666666666666';
const OTHER = '666666666666666667';
const BOT = '123';
const ids = { owner: '1', plain: '111111111111111111', sender: '111111111111111112', channelOnly: '111111111111111113', guildOnly: '111111111111111114', admin: '111111111111111115', staff: '111111111111111116', restricted: '111111111111111117', nobody: '111111111111111118' };
const ROLES = { everyone: GUILD, staff: '555000000000000001', restricted: '555000000000000002', admin: '555000000000000003', mods: '555000000000000004' };

const posts = []; // everything Petto posted in a channel (not as a reply): `{ channel, payload }`
const changes = []; // everything else a command changed in the server
const mut = (name) => async () => { changes.push(name); return { id: '999999999999999999' }; };
const fakeUser = (id) => ({ id, username: `user${id.slice(-3)}`, bot: false, tag: `user${id.slice(-3)}`, globalName: null, discriminator: '0', createdTimestamp: 1_600_000_000_000, toString: () => `<@${id}>`, displayAvatarURL: () => 'https://example.com/a.png', bannerURL: () => null, send: async (payload) => { posts.push({ channel: `dm:${id}`, payload }); return {}; }, flags: { toArray: () => [] }, fetch: async function fetched() { return this; } });
const client = { user: { id: BOT, ...fakeUser(BOT) }, users: { fetch: async (id) => fakeUser(id), cache: new Collection() }, ws: { ping: 42 }, shard: null, guilds: { cache: new Collection() }, channels: { cache: new Collection(), fetch: async () => null }, fetchInvite: async () => null, application: { commands: { fetch: async () => new Collection() }, fetch: async () => ({ owner: null }) }, uptime: 360_000, readyTimestamp: Date.now() - 360_000 };
loadCommands(client);

const guild = {
  id: GUILD, name: 'Petto Test', ownerId: ids.owner, memberCount: 12, preferredLocale: 'en-US', features: [],
  members: { cache: new Collection(), fetch: async (id) => (typeof id === 'string' ? guild.members.cache.get(id) ?? Promise.reject(new Error('Unknown Member')) : guild.members.cache), ban: mut('guild.members.ban'), kick: mut('guild.members.kick') },
  roles: { cache: new Collection(), fetch: async () => guild.roles.cache, create: mut('guild.roles.create'), edit: mut('guild.roles.edit'), delete: mut('guild.roles.delete') },
  channels: { cache: new Collection(), fetch: async (id) => (id ? guild.channels.cache.get(id) ?? null : guild.channels.cache), create: mut('guild.channels.create') },
  emojis: { cache: new Collection(), fetch: async () => new Collection() }, stickers: { cache: new Collection(), fetch: async () => new Collection() },
  invites: { fetch: async () => new Collection() }, bans: { fetch: async () => new Collection() }, scheduledEvents: { cache: new Collection() }, commands: { fetch: async () => new Collection() },
  fetchWebhooks: async () => new Collection(), iconURL: () => null, bannerURL: () => null, toString: () => 'Petto Test',
};
const role = (id, name, permissions, position = 1) => { const value = { id, name, position, managed: false, mentionable: false, permissions: new PermissionsBitField(permissions), toString: () => `<@&${id}>` }; guild.roles.cache.set(id, value); return value; };
role(GUILD, '@everyone', F.ViewChannel | F.SendMessages | F.ReadMessageHistory);
role(ROLES.staff, 'Staff', F.ManageMessages, 5);
role(ROLES.restricted, 'Helpers', 0n, 3);
role(ROLES.admin, 'Admins', F.Administrator, 9);
role(ROLES.mods, 'Mods', F.ManageGuild, 6);

/** What Discord computes for a member in a channel: the permissions of the roles, then the overwrites of @everyone, the roles and the member. */
function permissionsIn(channel, member) {
  if (!member) return null;
  if (guild.ownerId === member.id) return new PermissionsBitField(PermissionsBitField.All);
  let bits = 0n;
  for (const each of member.roles.cache.values()) bits |= each.permissions.bitfield;
  if (bits & F.Administrator) return new PermissionsBitField(PermissionsBitField.All);
  const overwrites = channel.overwrites ?? [];
  const apply = (entries) => { for (const entry of entries) { bits &= ~entry.deny; bits |= entry.allow; } };
  apply(overwrites.filter((entry) => entry.id === GUILD));
  const roleEntries = overwrites.filter((entry) => member.roles.cache.has(entry.id) && entry.id !== GUILD);
  for (const entry of roleEntries) bits &= ~entry.deny;
  for (const entry of roleEntries) bits |= entry.allow;
  apply(overwrites.filter((entry) => entry.id === member.id));
  return new PermissionsBitField(bits);
}
function makeMember(id, roleIds = []) {
  const cache = new Collection();
  cache.set(GUILD, guild.roles.cache.get(GUILD));
  for (const roleId of roleIds) cache.set(roleId, guild.roles.cache.get(roleId));
  const user = fakeUser(id);
  const member = {
    id, user, guild, nickname: null, displayName: user.username, joinedTimestamp: 1_650_000_000_000, premiumSince: null, roles: { cache, highest: [...cache.values()].sort((a, b) => b.position - a.position)[0], add: mut('member.roles.add'), remove: mut('member.roles.remove') },
    displayAvatarURL: () => 'https://example.com/a.png', toString: () => `<@${id}>`, voice: { channel: null }, manageable: false, kickable: false, bannable: false, moderatable: false,
    kick: mut('member.kick'), ban: mut('member.ban'), timeout: mut('member.timeout'), setNickname: mut('member.setNickname'),
    // The guild-wide permissions, as `GuildMember#permissions` of discord.js: the roles only, never the overwrites of a channel.
    get permissions() { return permissionsIn({ overwrites: [] }, member); },
  };
  guild.members.cache.set(id, member);
  return member;
}
function makeChannel(id, name, overwrites = []) {
  const channel = {
    id, name, type: 0, guild, guildId: GUILD, parentId: null, overwrites, nsfw: false, rateLimitPerUser: 0, position: 1, createdTimestamp: 1_600_000_000_000, url: `https://discord.com/channels/${GUILD}/${id}`, toString: () => `<#${id}>`,
    isTextBased: () => true, isVoiceBased: () => false, isThread: () => false, isDMBased: () => false, sendable: true,
    permissionsFor: (who) => permissionsIn(channel, who && typeof who === 'object' && who.roles ? who : who ? guild.members.cache.get(who.id ?? who) : null),
    permissionOverwrites: { cache: new Collection(), edit: mut(`${name}.permissionOverwrites.edit`), set: mut(`${name}.permissionOverwrites.set`), create: mut(`${name}.permissionOverwrites.create`), delete: mut(`${name}.permissionOverwrites.delete`) },
    messages: { cache: new Collection(), fetch: async () => new Collection(), delete: mut(`${name}.messages.delete`) },
    send: async (payload) => { posts.push({ channel: id, payload }); return { id: '888888888888888888', url: `https://discord.com/channels/${GUILD}/${id}/888888888888888888`, edit: mut('message.edit'), delete: mut('message.delete'), react: mut('message.react') }; },
    edit: mut(`${name}.edit`), delete: mut(`${name}.delete`), setName: mut(`${name}.setName`), setTopic: mut(`${name}.setTopic`), bulkDelete: mut(`${name}.bulkDelete`), createWebhook: mut(`${name}.createWebhook`), fetchWebhooks: async () => new Collection(),
    sendTyping: async () => {}, threads: { create: mut(`${name}.threads.create`), cache: new Collection(), fetchActive: async () => ({ threads: new Collection() }) }, createInvite: mut(`${name}.createInvite`), fetch: async () => channel,
  };
  guild.channels.cache.set(id, channel);
  return channel;
}
const room = makeChannel(ROOM, 'room');
makeChannel(OTHER, 'other');
const me = makeMember(BOT);
me.roles.cache.set('role-bot', { id: 'role-bot', position: 99, permissions: new PermissionsBitField(PermissionsBitField.All), toString: () => '<@&role-bot>' });
guild.members.me = me;
client.guilds.cache.set(GUILD, guild);

makeMember(ids.owner);
makeMember(ids.nobody);
makeMember(ids.plain);
makeMember(ids.sender);
makeMember(ids.channelOnly);
makeMember(ids.guildOnly, [ROLES.staff]);
makeMember(ids.admin, [ROLES.admin]);
makeMember(ids.staff, [ROLES.staff]);
makeMember(ids.restricted, [ROLES.restricted]);
// `nobody` has no permission at all, not even to see the channel (a role-less member of a server where @everyone is bare): the roles are emptied below.
guild.members.cache.get(ids.nobody).roles.cache.clear();


// ---------------------------------------------------------------- the two ways in
const flat = (value) => { try { return JSON.stringify(value, (key, item) => (typeof item === 'bigint' ? String(item) : item)); } catch { return String(value); } };
const MARK = 'PWNED-MARK';
const EPHEMERAL = 64;
const isEphemeral = (payload) => { const f = payload?.flags; return Boolean(payload?.ephemeral) || (Array.isArray(f) ? f.includes(EPHEMERAL) : typeof f === 'number' && (f & EPHEMERAL) === EPHEMERAL); };
let seq = 0;
/** A message typed by a member in the room: `{ posts, replies, changes }`: what Petto posted in a channel, what it answered, and what it changed. */
async function typed(content, { as = ids.plain, channel = room } = {}) {
  seq += 1;
  posts.length = 0; changes.length = 0;
  const replies = [];
  const member = guild.members.cache.get(as);
  const sendTo = channel.send;
  const message = {
    id: `7${String(seq).padStart(17, '0')}`, content, author: member.user, guild, client, member, mentions: { users: new Map(), roles: new Map(), channels: new Map(), members: new Map() }, attachments: new Map(), reference: null,
    channel: Object.assign(Object.create(channel), { send: sendTo }), channelId: channel.id,
    reply: async (payload) => { replies.push(payload); return { id: '1', createdTimestamp: Date.now() + 20, delete: async () => {}, edit: async (edit) => { replies.push(edit); } }; },
    delete: mut('message.delete'),
  };
  event.setCachedPrefix(GUILD, guildRow.prefixes);
  await Promise.race([event.execute(message), new Promise((resolve) => setTimeout(resolve, 3000))]);
  return { posts: [...posts], replies, changes: [...changes] };
}
/** A slash command: `{ commandName, sub, group, values }` by a member, through interactionCreate. */
async function slash({ commandName, sub = null, group = null, values = {}, as = ids.plain, channel = room }) {
  seq += 1;
  posts.length = 0; changes.length = 0;
  const replies = [];
  const member = guild.members.cache.get(as);
  const get = (name, required) => { const value = values[name] ?? null; if (value === null && required) throw new Error(`Missing ${name}`); return value; };
  const base = {
    id: `8${String(seq).padStart(17, '0')}`, commandName, commandType: 1, user: member.user, member, guild, guildId: GUILD, channel, channelId: channel.id, locale: 'en-US', guildLocale: 'en-US', pettoLang: 'en', typedPrefix: '/', client,
    createdTimestamp: Date.now(), deferred: false, replied: false,
    options: { getSubcommand: (required = true) => { if (!sub && required) throw new Error('No subcommand'); return sub; }, getSubcommandGroup: (required = true) => { if (!group && required) throw new Error('No group'); return group; }, getString: get, getInteger: get, getNumber: get, getBoolean: get, getUser: get, getChannel: get, getRole: get, getAttachment: get, getMentionable: get, getMember: () => null, getFocused: () => '', data: [] },
    isChatInputCommand: () => true, isRepliable: () => true, isAutocomplete: () => false, isButton: () => false, isStringSelectMenu: () => false, isModalSubmit: () => false, isMessageContextMenuCommand: () => false, isUserContextMenuCommand: () => false,
    reply: async (payload) => { replies.push(payload); base.replied = true; return { id: '1' }; },
    deferReply: async (payload) => { replies.push({ ...(payload ?? {}), deferred: true }); base.deferred = true; },
    editReply: async (payload) => { replies.push(payload); return { id: '1' }; }, followUp: async (payload) => { replies.push(payload); return { id: '1' }; }, fetchReply: async () => ({ id: '1' }), deleteReply: async () => {}, showModal: async () => { replies.push({ modal: true }); }, respond: async () => {},
  };
  const interaction = new Proxy(base, { get: (target, key) => (key in target ? target[key] : (typeof key === 'string' && /^is[A-Z]/.test(key) ? () => false : undefined)) });
  await Promise.race([interactionCreate.execute(interaction, client), new Promise((resolve) => setTimeout(resolve, 3000))]);
  return { posts: [...posts], replies, changes: [...changes] };
}

const { permissionLabels } = require('../src/utils/permissions');
const moderationPermissions = require('../src/utils/moderationPermissions');
const commandAliasesDb = require('../src/db/commandAliases');

const LOCKED = '666666666666666668';
const room2 = makeChannel(LOCKED, 'locked', [{ id: ROLES.staff, allow: 0n, deny: F.SendMessages }]);
// `channelOnly` has Manage Messages in the room only because the channel gives it to them (an overwrite for that member), never in the server.
room.overwrites.push({ id: ids.channelOnly, allow: F.ManageMessages, deny: 0n });
guild.members.cache.get(ids.nobody).roles.cache.clear();
assert.equal(guild.members.cache.get(ids.channelOnly).permissions.has(F.ManageMessages), false, 'channelOnly has no Manage Messages in the server');
assert.equal(room.permissionsFor(guild.members.cache.get(ids.channelOnly)).has(F.ManageMessages), true, 'and has it in the room (the fake computes overwrites)');
assert.equal(room2.permissionsFor(guild.members.cache.get(ids.staff)).has(F.SendMessages), false, 'staff cannot write in the locked channel');

const refusalNeedsManageMessages = permissionLabels(F.ManageMessages, 'en');
const text = (value) => flat(value);
const isRefusal = (result) => result.replies.some((reply) => text(reply).includes(`You need the **${refusalNeedsManageMessages}** permission`) || text(reply).includes('missing') || text(reply).includes('Manage Messages'));
const posted = (result) => result.posts.filter((post) => !post.channel.startsWith('dm:'));
const marked = (result) => posted(result).filter((post) => text(post.payload).includes(MARK));

// ---------------------------------------------------------------- the routes that reach `send`, for the prefix and for the slash command
const slashSend = (extra = {}) => (context) => slash({ commandName: 'message', sub: 'send', values: { message: MARK, ...extra }, ...context });
const other = guild.channels.cache.get(OTHER);
const ROUTES = {
  '!send': (context) => typed(`!send ${MARK}`, context),
  '!SEND (capitals)': (context) => typed(`!SEND ${MARK}`, context),
  'petto send': (context) => typed(`petto send ${MARK}`, context),
  '@Petto send': (context) => typed(`<@${BOT}> send ${MARK}`, context),
  '!send #other': (context) => typed(`!send <#${OTHER}> ${MARK}`, context),
  '!send text #other': (context) => typed(`!send ${MARK} <#${OTHER}>`, context),
  '!message send': (context) => typed(`!message send ${MARK}`, context),
  '!MESSAGE   SEND (spaces, capitals)': (context) => typed(`!MESSAGE   SEND ${MARK}`, context),
  '!msen (short alias)': (context) => typed(`!msen ${MARK}`, context),
  '!message send #other': (context) => typed(`!message send <#${OTHER}> ${MARK}`, context),
  '/message send': slashSend(),
  '/message send channel:#other': slashSend({ channel: other }),
};
const ALLOWED = new Set(['staff', 'admin', 'owner']);
const WHO = ['nobody', 'plain', 'sender', 'channelOnly', 'restricted', 'staff', 'admin', 'owner'];

const runs = [];
async function main() {
  // ---------------------------------------------------------- 1. who may use each route, and that a refusal posts nothing and is private
  for (const [name, route] of Object.entries(ROUTES)) {
    for (const who of WHO) {
      const result = await route({ as: ids[who] });
      const label = `${name} by ${who}`;
      assert.deepEqual(result.changes, [], `${label}: nothing in the server changes`);
      if (ALLOWED.has(who)) {
        assert.equal(marked(result).length, 1, `${label}: a member with Manage Messages posts once`);
        assert.equal(posted(result).length, 1, `${label}: and only once`);
        assert.equal(posted(result)[0].channel, name.includes('#other') || name.includes('channel:#other') ? OTHER : ROOM, `${label}: where it was asked`);
      } else {
        assert.deepEqual(posted(result), [], `SECURITY ${label}: a member without Manage Messages in the server posts nothing`);
        assert.ok(isRefusal(result), `${label}: the member is told why (${text(result.replies).slice(0, 200)})`);
        if (name.startsWith('/')) assert.ok(result.replies.every(isEphemeral), `${label}: the refusal of the slash command is private`);
        else assert.ok(!text(result.replies).includes(MARK), `${label}: the refusal does not repeat the text`);
      }
      runs.push(label);
    }
  }
  // The refusal names the permission in the language of the member, for the slash command (en, es, pt-BR).
  for (const lang of ['en', 'es', 'pt-BR']) {
    const expected = t(lang, 'core.moderate.youNeed', { permission: permissionLabels(F.ManageMessages, lang) });
    assert.ok(expected.includes(permissionLabels(F.ManageMessages, lang)), `${lang}: the refusal names the permission`);
  }

  // ---------------------------------------------------------- 2. the server and the channel both count
  // Staff (Manage Messages in the server) cannot post where an overwrite takes Send Messages away; in a channel they can write, they can.
  for (const [name, route] of Object.entries({
    '!send #locked': (context) => typed(`!send <#${LOCKED}> ${MARK}`, context),
    '/message send channel:#locked': slashSend({ channel: room2 }),
  })) {
    const result = await route({ as: ids.staff });
    assert.deepEqual(posted(result), [], `${name}: a channel where the member cannot write takes nothing`);
    assert.ok(text(result.replies).includes('write there'), `${name}: and it says so (${text(result.replies).slice(0, 160)})`);
  }
  // Manage Messages that only a channel gives (overwrite for the member), and nothing in the server: refused in the channel that gives it, by every route.
  for (const [name, route] of Object.entries({ '!send': ROUTES['!send'], '!message send': ROUTES['!message send'], '/message send': ROUTES['/message send'] })) {
    const result = await route({ as: ids.channelOnly });
    assert.deepEqual(posted(result), [], `SECURITY ${name}: Manage Messages in one channel only is not Manage Messages in the server`);
  }
  // A channel that cannot say what the member may do (permissionsFor gives nothing) is a no.
  const real = room.permissionsFor;
  room.permissionsFor = (who) => (who?.id === BOT ? real(who) : null);
  for (const [name, route] of Object.entries({ '!send': ROUTES['!send'], '/message send': ROUTES['/message send'] })) {
    const result = await route({ as: ids.staff });
    assert.deepEqual(posted(result), [], `${name}: permissionsFor that answers nothing is a refusal`);
  }
  room.permissionsFor = real;

  // ---------------------------------------------------------- 3. a member that cannot be read is a member who may not (no `?? true` anywhere)
  const target = guild.members.cache.get(ids.plain);
  const shapes = { undefined: undefined, null: null, 'a string with every permission': '2251799813685247', 'an object': {}, 'a string with Administrator': '8' };
  for (const [shape, value] of Object.entries(shapes)) {
    Object.defineProperty(target, 'permissions', { get: () => value, configurable: true });
    for (const [name, route] of Object.entries({ '!send': ROUTES['!send'], '!message send': ROUTES['!message send'], '/message send': ROUTES['/message send'] })) {
      let result;
      try { result = await route({ as: ids.plain }); } catch (error) { assert.fail(`${name} with permissions ${shape}: the pipeline must answer, not throw (${error.message})`); }
      assert.deepEqual(posted(result), [], `SECURITY ${name} with permissions as ${shape}: nothing is posted`);
      assert.ok(result.replies.length >= 1, `${name} with permissions as ${shape}: the member is answered`);
    }
  }
  delete target.permissions;
  Object.defineProperty(target, 'permissions', { get: () => permissionsIn({ overwrites: [] }, target), configurable: true });
  // Calling the command itself with a member that cannot be read (the umbrella, a prefix interaction, a raw one) never posts either.
  const send = require('../src/commands/config/send');
  for (const member of [null, undefined, { id: ids.plain, permissions: '8' }, { id: ids.plain, permissions: null }]) {
    const replies = [];
    const interaction = {
      guild, guildId: GUILD, channel: room, channelId: ROOM, member, user: { id: ids.nobody }, client, pettoLang: 'en', deferred: false, replied: false,
      options: { getString: (name) => (name === 'message' ? MARK : null), getChannel: () => null, getAttachment: () => null },
      reply: async (payload) => { replies.push(payload); }, deferReply: async () => {}, editReply: async (payload) => { replies.push(payload); },
    };
    posts.length = 0;
    await send.execute(interaction);
    assert.deepEqual(posted({ posts }), [], 'send.execute with a member that cannot be read posts nothing');
    assert.ok(replies.length === 1 && replies.every(isEphemeral), 'and refuses in private');
  }
  // A raw member of an interaction is looked up in the server (a real member with its roles), and then judged by what its roles give.
  {
    const replies = [];
    const raw = { id: ids.staff, permissions: '8192', roles: [ROLES.staff] };
    const interaction = { guild, guildId: GUILD, channel: room, channelId: ROOM, member: raw, user: { id: ids.staff }, client, pettoLang: 'en', deferred: false, replied: false, options: { getString: (name) => (name === 'message' ? MARK : null), getChannel: () => null, getAttachment: () => null }, reply: async (payload) => { replies.push(payload); }, deferReply: async () => {}, editReply: async (payload) => { replies.push(payload); } };
    posts.length = 0;
    await send.execute(interaction);
    assert.equal(marked({ posts }).length, 1, 'a raw member whose roles give Manage Messages is found in the server and may post');
    posts.length = 0;
    await send.execute({ ...interaction, member: { id: ids.plain, permissions: '8192' }, user: { id: ids.plain } });
    assert.deepEqual(posted({ posts }), [], 'a raw member that says it has the permission (the channel gives it) but whose roles do not, may not');
  }

  // ---------------------------------------------------------- 4. the rules of the server only add limits
  // A permission level that the plain member reaches, a `!moderation` role for send, and a restriction to a role they have: none opens `send`.
  rules.levels = { send: 10, message: 10 };
  rules.groups = [{ id: 1, name: 'everyone', level: 100, is_base: true, members: [] }, { id: 2, name: 'fans', level: 100, is_base: false, members: [{ subject_type: 'user', subject_id: ids.plain }, { subject_type: 'role', subject_id: GUILD }] }];
  rules.restricted = { send: [GUILD], message: [GUILD] };
  const realRole = moderationPermissions.hasConfiguredRole;
  moderationPermissions.hasConfiguredRole = async () => true;
  for (const [name, route] of Object.entries({ '!send': ROUTES['!send'], 'petto send': ROUTES['petto send'], '!message send': ROUTES['!message send'], '!msen': ROUTES['!msen (short alias)'], '/message send': ROUTES['/message send'] })) {
    for (const who of ['plain', 'nobody', 'channelOnly']) {
      const result = await route({ as: ids[who] });
      assert.deepEqual(posted(result), [], `SECURITY ${name} by ${who} with a level, a role and a restriction that they meet: still refused`);
    }
    assert.equal(marked(await route({ as: ids.staff })).length, 1, `${name}: staff who meets the level and the role posts`);
  }
  moderationPermissions.hasConfiguredRole = realRole;
  // A level that the member does not reach, or a restriction to a role they lack, closes `send` for staff too (not for administrators).
  rules.groups = []; rules.levels = { send: 50 }; rules.restricted = {};
  assert.deepEqual(posted(await ROUTES['!send']({ as: ids.staff })), [], 'a permission level the staff member does not reach closes !send');
  assert.deepEqual(posted(await ROUTES['/message send']({ as: ids.staff })), [], 'and /message send');
  assert.equal(marked(await ROUTES['!send']({ as: ids.admin })).length, 1, 'administrators always pass a level');
  rules.levels = {}; rules.restricted = { send: [ROLES.mods] };
  assert.deepEqual(posted(await ROUTES['!message send']({ as: ids.staff })), [], '!restrictcommand send @Mods closes !message send for staff without that role');
  assert.deepEqual(posted(await ROUTES['/message send']({ as: ids.staff })), [], 'and /message send');
  rules.restricted = { message: [ROLES.mods] };
  assert.deepEqual(posted(await ROUTES['!msen (short alias)']({ as: ids.staff })), [], 'and restricting the umbrella closes its short alias');
  rules.restricted = {}; rules.disabled = new Set(['send']);
  assert.deepEqual(posted(await ROUTES['!send']({ as: ids.admin })), [], '!disablecommand send turns it off');
  rules.disabled = new Set();
  assert.equal(marked(await ROUTES['!send']({ as: ids.staff })).length, 1, 'back to normal with no rules');

  // ---------------------------------------------------------- 5. server aliases: an alias of the server is the command it stands for, with its permission
  const table = { say: 'send {0}', say2: 'message send {0}', say3: 'msen {0}', send: 'send {0}', talk: 'config send {0}' };
  const realAlias = commandAliasesDb.get;
  commandAliasesDb.get = async (guildId, name) => (table[name] ? { command: table[name] } : null);
  for (const word of Object.keys(table)) {
    const plainResult = await typed(`!${word} ${MARK}`, { as: ids.plain });
    assert.deepEqual(posted(plainResult), [], `SECURITY alias !${word}: a plain member posts nothing`);
    const staffResult = await typed(`!${word} ${MARK}`, { as: ids.staff });
    if (word !== 'talk') assert.equal(marked(staffResult).length, 1, `alias !${word}: staff posts`);
  }
  commandAliasesDb.get = realAlias;

  // ---------------------------------------------------------- 6. every word Petto answers to, typed by a plain member, posts nothing and changes nothing
  const words = new Set([...client.commands.keys(), ...client.commandAliases.keys(), ...(client.commandRoutes?.keys() ?? [])]);
  assert.ok(words.size > 1500, `${words.size} words (commands, aliases, routes and short aliases)`);
  const OWN_TICKET = new Set(['guild.channels.create']); // `!ticket open` (and its short words) opens the member's own ticket
  let probes = 0;
  for (const word of words) {
    for (const body of [`${MARK}`, `<#${OTHER}> ${MARK}`, `send <#${OTHER}> ${MARK}`]) {
      probes += 1;
      let result;
      try { result = await typed(`!${word} ${body}`, { as: ids.plain }); } catch { continue; }
      assert.deepEqual(posted(result), [], `SECURITY !${word} ${body}: a plain member makes Petto post in a channel`);
      assert.deepEqual(result.changes.filter((change) => !OWN_TICKET.has(change)), [], `SECURITY !${word} ${body}: a plain member changes the server`);
    }
  }
  assert.ok(probes > 4500, `${probes} words probed`);
  // The first word of every umbrella with every one of its subcommands, with the three ways to start a command.
  let leafProbes = 0;
  for (const command of client.commands.values().filter((each) => each.umbrella)) {
    const json = command.data.toJSON();
    const leaves = (json.options ?? []).flatMap((option) => (option.type === 1 ? [[option.name]] : option.type === 2 ? (option.options ?? []).map((sub) => [option.name, sub.name]) : []));
    for (const leaf of leaves) {
      for (const prefix of ['!', 'petto ', `<@${BOT}> `]) {
        leafProbes += 1;
        const result = await typed(`${prefix}${json.name} ${leaf.join(' ')} <#${OTHER}> ${MARK}`, { as: ids.plain });
        assert.deepEqual(posted(result), [], `SECURITY ${prefix}${json.name} ${leaf.join(' ')}: a plain member makes Petto post in a channel`);
        assert.deepEqual(result.changes.filter((change) => !OWN_TICKET.has(change)), [], `SECURITY ${prefix}${json.name} ${leaf.join(' ')}: a plain member changes the server`);
      }
    }
  }
  assert.ok(leafProbes > 600, `${leafProbes} umbrella subcommands probed`);

  // ---------------------------------------------------------- 7. the slash commands, as they reach the code
  // Discord decides who sees a command with `default_member_permissions` (and a server can open it in Integrations); the code of these commands asks for nothing
  // more. They are listed here so they are known (they are what `!` refuses at runtime): a command that has no check of its own and is not in the list fails.
  const ADMIN_ONLY_AT_DISCORD = new Set(['honeypot add', 'partnerconfig welcome', 'logs add', 'verify setup', 'webhook create', 'channel lock', 'channel unlock', 'channel lock-all', 'channel unlock-all', 'channel topic', 'ticket open']);
  const optionValue = (option) => {
    const T = require('discord.js').ApplicationCommandOptionType;
    switch (option.type) {
      case T.String: return option.choices?.length ? option.choices[0].value : MARK.slice(0, option.max_length ?? 99);
      case T.Integer: case T.Number: return Math.min(Math.max(option.min_value ?? 3, 3), option.max_value ?? 1000);
      case T.Boolean: return true;
      case T.User: case T.Mentionable: return guild.members.cache.get(ids.nobody).user;
      case T.Channel: return other;
      case T.Role: return guild.roles.cache.get(ROLES.staff);
      case T.Attachment: return { url: 'https://example.com/a.png', name: 'a.png', size: 100 };
      default: return null;
    }
  };
  const slashHits = new Set();
  let slashProbes = 0;
  for (const command of client.commands.values()) {
    const json = command.data.toJSON();
    if ((json.type ?? 1) !== 1) continue;
    const top = json.options ?? [];
    const leaves = top.some((option) => option.type <= 2)
      ? top.flatMap((option) => (option.type === 1 ? [{ group: null, sub: option.name, node: option }] : option.type === 2 ? (option.options ?? []).map((sub) => ({ group: option.name, sub: sub.name, node: sub })) : []))
      : [{ group: null, sub: null, node: json }];
    for (const leaf of leaves) {
      slashProbes += 1;
      const values = Object.fromEntries((leaf.node.options ?? []).filter((option) => option.type > 2).map((option) => [option.name, optionValue(option)]));
      let result;
      try { result = await slash({ commandName: json.name, sub: leaf.sub, group: leaf.group, values, as: ids.plain }); } catch { continue; }
      if (posted(result).length || result.changes.some((change) => !OWN_TICKET.has(change) || json.name !== 'ticket')) slashHits.add(`${json.name} ${leaf.sub ?? ''}`.trim());
    }
  }
  assert.ok(slashProbes > 700, `${slashProbes} slash subcommands probed as a plain member`);
  const unexpected = [...slashHits].filter((hit) => !ADMIN_ONLY_AT_DISCORD.has(hit));
  assert.deepEqual(unexpected, [], 'SECURITY: a slash command that a plain member can run posts in a channel or changes the server, and it is not a command that Discord keeps for the staff');
  for (const hit of ADMIN_ONLY_AT_DISCORD) {
    if (hit === 'ticket open') continue;
    const [name] = hit.split(' ');
    assert.notEqual(client.commands.get(name).data.toJSON().default_member_permissions ?? null, null, `${hit} is only kept from members by Discord: it must declare a permission`);
  }

  // ---------------------------------------------------------- 8. what is registered
  const data = send.data.toJSON();
  assert.equal(BigInt(data.default_member_permissions), F.ManageMessages, '`send` declares Manage Messages (the prefix reads it)');
  assert.equal(data.dm_permission, false, '`send` is not for DMs');
  assert.ok(!collectCommandData().some((entry) => entry.name === 'send'), '`send` is not its own slash command: its slash way is /message send');
  const message = client.commands.get('message').data.toJSON();
  assert.equal(message.default_member_permissions ?? null, null, '/message is open at Discord (a command is gated as a whole): each subcommand asks inside');
  assert.ok(message.options.some((option) => option.name === 'send' && option.type === 1), '/message send exists');
  assert.equal(String(require('../src/utils/umbrella').permissionBitsOf(require('../src/utils/umbrella').loadByName, client.commands.get('message').leaves.find((leaf) => leaf.name === 'send'))), String(F.ManageMessages), '/message send asks for Manage Messages');
  const source = fs.readFileSync(path.join(root, 'src', 'commands', 'config', 'send.js'), 'utf8');
  assert.ok(source.indexOf('ManageMessages') < source.indexOf('channel.send('), 'the permission is checked before the message is sent');
  assert.ok(!/permissions\??\.has\??\.?\([^)]*\)\s*\?\?\s*true/.test(source), 'no permission turns into "allowed" with `?? true`');

  console.log(`Checked who may send as Petto: ${runs.length} route and member pairs, ${probes} words, ${leafProbes} umbrella subcommands and ${slashProbes} slash subcommands as a plain member.`);
}
main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
