// Fakes for the forum support checks: an in-memory index (the database layer of src/db/forums.js), a forum with tags, posts, members, a server,
// and the messages they send. Nothing talks to Discord or a database.
const path = require('node:path');
const { ChannelType, PermissionsBitField, PermissionFlagsBits, Collection } = require('discord.js');

process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const clock = { now: Date.now() };
const iso = (ms = clock.now) => new Date(ms).toISOString();

/** The database of the module, in memory. `store.setups` and `store.posts` can be read and changed by the check. */
function makeStore() {
  const store = { setups: [], posts: new Map(), nextId: 1, logs: [] };
  const db = {
    NAME: /^[a-z0-9][a-z0-9_-]{0,31}$/, OPEN: ['open', 'solved'],
    listSetups: async (guildId) => store.setups.filter((s) => s.guild_id === guildId),
    getSetup: async (guildId, ref) => store.setups.find((s) => s.guild_id === guildId && (String(s.id) === String(ref) || s.name === String(ref))) ?? null,
    getSetupById: async (id) => store.setups.find((s) => String(s.id) === String(id)) ?? null,
    getSetupByForum: async (guildId, forumId) => store.setups.find((s) => s.guild_id === guildId && s.forum_channel_id === forumId) ?? null,
    countSetups: async (guildId) => store.setups.filter((s) => s.guild_id === guildId).length,
    createSetup: async (guildId, row) => {
      const full = { ...require('../src/utils/forumConfig').DEFAULTS, id: store.nextId++, guild_id: guildId, panel_message_id: null, panel_channel_id: null, solved_tag_id: null, guidelines: null, first_message: null, ...row };
      store.setups.push(full);
      return full;
    },
    updateSetup: async (guildId, id, changes) => { const s = store.setups.find((x) => x.guild_id === guildId && x.id === Number(id)); if (!s) return null; Object.assign(s, changes); return s; },
    deleteSetup: async (guildId, id) => { store.setups = store.setups.filter((s) => !(s.guild_id === guildId && s.id === Number(id))); for (const [k, p] of store.posts) if (p.setup_id === Number(id)) store.posts.delete(k); },
    getPost: async (id) => store.posts.get(String(id)) ?? null,
    upsertPost: async (row) => { const old = store.posts.get(String(row.thread_id)); const next = { claimed_by: null, solved_at: null, closed_at: null, tag_deadline_at: null, opened_at: iso(), last_activity_at: iso(), status: 'open', ...old, ...row }; store.posts.set(String(row.thread_id), next); return next; },
    updatePost: async (id, changes) => { const p = store.posts.get(String(id)); if (!p) return null; Object.assign(p, changes); return p; },
    deletePost: async (id) => { store.posts.delete(String(id)); },
    memberState: async (setupId, authorId) => {
      const mine = [...store.posts.values()].filter((p) => p.setup_id === setupId && p.author_id === authorId).sort((a, b) => b.opened_at.localeCompare(a.opened_at));
      return { open: mine.filter((p) => ['open', 'solved'].includes(p.status)), lastOpenedAt: mine[0]?.opened_at ?? null };
    },
    listPosts: async (guildId, { status = null, setupId = null } = {}) => [...store.posts.values()].filter((p) => p.guild_id === guildId && (!status || (status === 'open' ? ['open', 'solved'].includes(p.status) : p.status === status)) && (!setupId || p.setup_id === Number(setupId))),
    countPosts: async (guildId, o) => (await db.listPosts(guildId, o)).length,
    touchActivity: async (id, everyMs = 300000) => { const p = store.posts.get(String(id)); if (!p || !['open', 'solved'].includes(p.status) || Date.parse(p.last_activity_at) >= clock.now - everyMs) return false; p.last_activity_at = iso(); return true; },
    transition: async (id, from, changes) => { const p = store.posts.get(String(id)); if (!p || !from.includes(p.status)) return null; Object.assign(p, changes); return p; },
    dueInactive: async (limit) => {
      const { inactiveDue } = require('../src/utils/forumAutomation');
      return [...store.posts.values()].filter((p) => { const s = store.setups.find((x) => x.id === p.setup_id); return s && inactiveDue(p, s, clock.now); }).slice(0, limit).map((p) => ({ ...p, action: store.setups.find((x) => x.id === p.setup_id).inactive_action }));
    },
    dueSolved: async (limit) => {
      const { solvedDue } = require('../src/utils/forumAutomation');
      return [...store.posts.values()].filter((p) => { const s = store.setups.find((x) => x.id === p.setup_id); return s && solvedDue(p, s, clock.now); }).slice(0, limit).map((p) => ({ ...p, action: store.setups.find((x) => x.id === p.setup_id).solved_action }));
    },
    dueTag: async (limit) => {
      const { tagDue } = require('../src/utils/forumAutomation');
      return [...store.posts.values()].filter((p) => tagDue(p, clock.now)).slice(0, limit);
    },
  };
  return { store, db };
}

/** Puts the fakes where the modules look for their database, the log and the languages. Call once, before requiring the module. */
function install() {
  const { store, db } = makeStore();
  stub('src/db/database.js', { from: () => ({}) });
  stub('src/db/forums.js', db);
  stub('src/db/guilds.js', { ensureGuild: async () => ({}), findGuildLanguage: async () => null, listGuildLanguages: async () => [] });
  stub('src/db/embedTemplates.js', { getTemplate: async () => null });
  stub('src/utils/logger.js', { info() {}, warn() {}, error() {}, debug() {} });
  stub('src/logging/engine.js', { AuditLogEvent: require('discord.js').AuditLogEvent, getAvatar: () => null, fetchMod: async () => null, fetchEntry: async () => null, prettyPermission: (n) => n, EVENTS: [], botLook: () => ({}), sanitizeEmbed: (e) => e, sendLog: async (client, guildId, event, embed, options) => { store.logs.push({ guildId, event, embed, options }); } });
  return store;
}

const ALL = Object.values(PermissionFlagsBits).reduce((sum, bit) => sum | bit, 0n);
const permissions = (names) => new PermissionsBitField(names.map((name) => PermissionFlagsBits[name]));

function makeMember(id, { roles = [], perms = [], top = 1, name = `user${id}`, guild = null } = {}) {
  const cache = new Collection(roles.map((r) => [r, { id: r }]));
  return {
    id, displayName: name, user: { id, username: name, tag: `${name}#0`, bot: false }, guild,
    roles: { cache, highest: { position: top } },
    permissions: permissions(perms),
  };
}

/** A server with a bot member that has `botPerms` everywhere. */
function makeGuild({ botPerms = ['ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'ManageThreads', 'CreatePublicThreads', 'ManageChannels', 'AttachFiles'] } = {}) {
  const sentByChannel = [];
  const guild = {
    id: '111111111111111111', name: 'Guild', ownerId: '900000000000000009', premiumTier: 0,
    client: { user: { id: '999999999999999999' } },
    channels: { cache: new Collection(), fetch: async (id) => guild.channels.cache.get(id) ?? null },
    members: { cache: new Collection(), fetch: async (id) => guild.members.cache.get(id) ?? null, me: null },
    sent: sentByChannel,
  };
  guild.client.guilds = { cache: new Collection([[guild.id, guild]]) };
  guild.members.me = makeMember(guild.client.user.id, { perms: botPerms, top: 50 });
  return guild;
}

let nextChannel = 700000000000000000n;
const newId = () => String(nextChannel++);

function makeForum(guild, { tags = [], botPerms = null, name = 'support', requireTag = false } = {}) {
  const forum = {
    id: newId(), name, type: ChannelType.GuildForum, guild, position: 1, availableTags: tags.map((tag, i) => ({ id: String(900 + i), moderated: false, emoji: null, ...tag })),
    flags: { has: () => requireTag },
    created: [],
    permissionsFor: (member) => (member.id === guild.members.me.id && botPerms ? permissions(botPerms) : (member.permissions?.has?.('Administrator') ? permissions(Object.keys(PermissionFlagsBits)) : member.id === guild.members.me.id ? guild.members.me.permissions : permissions(['ViewChannel', 'SendMessages']))),
    setAvailableTags: async (next) => { forum.availableTags = next.map((tag, i) => ({ id: tag.id ?? String(950 + i), moderated: false, emoji: null, ...tag })); return forum; },
    threads: {
      create: async (options) => {
        const thread = makeThread(guild, forum, { name: options.name, ownerId: guild.client.user.id, appliedTags: options.appliedTags ?? [], rateLimitPerUser: options.rateLimitPerUser ?? 0 });
        thread.starter = options.message;
        forum.created.push({ options, thread });
        return thread;
      },
    },
  };
  guild.channels.cache.set(forum.id, forum);
  return forum;
}

function makeThread(guild, forum, { name = 'Question', ownerId = null, appliedTags = [], locked = false, archived = false, rateLimitPerUser = 0, perms = null } = {}) {
  const thread = {
    id: newId(), name, guild, parent: forum, parentId: forum?.id, ownerId, appliedTags: [...appliedTags], locked, archived, rateLimitPerUser, type: ChannelType.PublicThread,
    isThread: () => true, isTextBased: () => true, client: guild.client, createdAt: new Date(clock.now), sent: [], calls: [],
    permissionsFor: (member) => (member.permissions?.has?.('Administrator') ? permissions(Object.keys(PermissionFlagsBits)) : (member.id === guild.members.me.id ? guild.members.me.permissions : (perms ? perms(member) : member.permissions))),
    send: async (payload) => { thread.sent.push(payload); thread.calls.push(['send']); return { id: newId(), url: `https://discord.com/channels/${guild.id}/${thread.id}/1`, channelId: thread.id }; },
    setLocked: async (value) => { thread.calls.push(['setLocked', value]); thread.locked = value; return thread; },
    setArchived: async (value) => { thread.calls.push(['setArchived', value]); thread.archived = value; return thread; },
    setName: async (value) => { thread.calls.push(['setName', value]); thread.name = value; return thread; },
    setAppliedTags: async (value) => { thread.calls.push(['setAppliedTags', value]); thread.appliedTags = [...value]; return thread; },
  };
  guild.channels.cache.set(thread.id, thread);
  return thread;
}

/** The pseudo interaction a prefix command gets: options, a reply that records, the member and the channel. */
function makeCommand(guild, channel, member, sub, values = {}, { group = null, reference = null } = {}) {
  const replies = [];
  const interaction = {
    guild, channel, channelId: channel.id, member, user: member.user, client: guild.client, typedPrefix: '!', pettoLang: 'en', replies,
    rawMessage: { reference, fetchReference: async () => reference?.message ?? null },
    options: {
      getSubcommand: () => sub, getSubcommandGroup: () => group,
      getString: (name, required) => { const v = values[name] ?? null; if (required && v === null) throw new Error(`missing ${name}`); return v; },
      getChannel: (name) => values[name] ?? null,
    },
    reply: async (payload) => { replies.push(payload); return payload; },
  };
  return interaction;
}

/** Every text of a Components V2 payload (or a plain one), joined. */
function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join('\n');
  if (!node || typeof node !== 'object') return typeof node === 'string' ? node : '';
  const json = typeof node.toJSON === 'function' ? node.toJSON() : node;
  const own = typeof json.content === 'string' ? json.content : '';
  return [own, textOf(json.components)].filter(Boolean).join('\n');
}

module.exports = { stub, clock, iso, install, makeStore, makeMember, makeGuild, makeForum, makeThread, makeCommand, textOf, permissions, ALL };
