// Checks the server log handlers that tell about webhooks, threads, stickers, scheduled events, AutoMod rules, timeouts,
// boosts, kicks and the details of role and channel changes, against a fake server and a fake audit log.
const assert = require('node:assert/strict');
const path = require('node:path');
const { AuditLogEvent, Collection, PermissionsBitField, PermissionFlagsBits } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const sent = [];
const entriesByType = new Map();
const engine = {
  sendLog: async (client, guildId, event, embed, options) => { sent.push({ guildId, event, embed, options }); },
  getAvatar: () => null,
  AuditLogEvent,
  prettyPermission: (name) => String(name).replace(/([a-z])([A-Z])/g, '$1 $2'),
  fetchMod: async (guild, type, id) => { const entry = (entriesByType.get(type) ?? []).find((e) => String(e.targetId) === String(id)); return entry?.executor ? `<@${entry.executor.id}>` : null; },
  fetchEntry: async (guild, type, id) => (entriesByType.get(type) ?? []).find((e) => String(e.targetId) === String(id)) ?? null,
};
stub('src/config.js', { dashboard: {}, web: {} });
stub('src/utils/logger.js', { info() {}, error() {}, warn() {} });
stub('src/db/postgres.js', { createPostgresClient() {}, getPrimaryPool() {} });
stub('src/logging/engine.js', engine);
stub('src/utils/inviteResolve.js', { resolveJoinInvite: async () => null });

const { handleWebhooksUpdate } = require('../src/logging/webhookLog');
const { handleThreadCreate, handleThreadDelete, handleThreadUpdate } = require('../src/logging/threadLog');
const { handleStickerCreate, handleStickerUpdate, handleStickerDelete } = require('../src/logging/emojiLog');
const { handleRuleCreate, handleRuleUpdate, handleRuleDelete } = require('../src/logging/automodRuleLog');
const server = require('../src/logging/serverLog');
const { handleMemberUpdate, handleMemberLeave } = require('../src/logging/memberLog');
const { EVENTS } = require('../src/db/logConfig');

const client = { user: { id: 'bot' } };
const last = () => sent.at(-1);
const field = (name) => last().embed.fields.find((f) => f.name === name)?.value;
const reset = () => { sent.length = 0; entriesByType.clear(); };

(async () => {
  assert.ok(EVENTS.includes('webhooks') && EVENTS.includes('threads'), 'the new categories can be chosen with !logs');

  // ---- webhooks: created, updated and deleted, each told once, and Petto's own ones left out
  const now = Date.now();
  const entry = (id, type, executor, changes, extra = {}) => ({ id, targetId: `w${id}`, executor: { id: executor }, createdTimestamp: now - 500, changes, target: { name: 'Hook', type: 1 }, actionType: type, ...extra });
  const guild = { id: '1', fetchAuditLogs: async ({ type }) => ({ entries: new Collection((entriesByType.get(type) ?? []).map((e) => [e.id, e])) }) };
  const channel = { id: '10', guild };
  entriesByType.set(AuditLogEvent.WebhookCreate, [entry('a', AuditLogEvent.WebhookCreate, 'u1', [{ key: 'channel_id', new: '10' }, { key: 'name', new: 'Hook' }]), entry('own', AuditLogEvent.WebhookCreate, 'bot', [{ key: 'channel_id', new: '10' }])]);
  entriesByType.set(AuditLogEvent.WebhookUpdate, [entry('b', AuditLogEvent.WebhookUpdate, 'u2', [{ key: 'name', old: 'Hook', new: 'Renamed' }, { key: 'channel_id', old: '10', new: '10' }])]);
  entriesByType.set(AuditLogEvent.WebhookDelete, [entry('c', AuditLogEvent.WebhookDelete, 'u3', [{ key: 'channel_id', old: '10' }]), entry('elsewhere', AuditLogEvent.WebhookDelete, 'u3', [{ key: 'channel_id', old: '99' }])]);
  await handleWebhooksUpdate(channel, client);
  assert.deepEqual(sent.map((s) => s.embed.author.name).sort(), ['Webhook Created', 'Webhook Deleted', 'Webhook Updated']);
  assert.ok(sent.every((s) => s.event === 'webhooks'));
  const created = sent.find((s) => s.embed.author.name === 'Webhook Created').embed;
  assert.ok(created.description.includes('`Hook`') && created.description.includes('<#10>'));
  assert.equal(created.fields.find((f) => f.name === 'By').value, '<@u1>');
  assert.ok(sent.find((s) => s.embed.author.name === 'Webhook Updated').embed.fields.some((f) => f.name === 'Name' && f.value.includes('Renamed')));
  const before = sent.length;
  await handleWebhooksUpdate(channel, client);
  assert.equal(sent.length, before, 'an audit entry is only told once');
  reset();
  const noAudit = { id: '1', fetchAuditLogs: async () => { throw new Error('Missing Permissions'); } };
  await handleWebhooksUpdate({ id: '10', guild: noAudit }, client);
  assert.equal(sent.length, 0, 'without View Audit Log nothing is invented');

  // ---- threads
  const thread = (extra = {}) => ({ id: 't1', name: 'Question', type: 11, parentId: '10', ownerId: 'u1', autoArchiveDuration: 1440, locked: false, archived: false, rateLimitPerUser: 0, guild: { id: '1', members: { fetch: async () => null } }, ...extra });
  await handleThreadCreate(thread(), true, client);
  assert.equal(last().event, 'threads'); assert.equal(last().embed.author.name, 'Thread Created');
  assert.equal(field('Started by'), '<@u1>'); assert.equal(field('Auto-archive'), '1 day');
  reset();
  await handleThreadCreate(thread({ ownerId: 'bot' }), true, client);
  await handleThreadCreate(thread(), false, client);
  assert.equal(sent.length, 0, "Petto's own threads and threads that only became visible are not told");
  await handleThreadUpdate(thread(), thread({ archived: true }), client);
  assert.equal(sent.length, 0, 'a thread that archives itself is not news');
  entriesByType.set(AuditLogEvent.ThreadUpdate, [{ targetId: 't1', executor: { id: 'u9' } }]);
  await handleThreadUpdate(thread(), thread({ archived: true, name: 'Solved' }), client);
  assert.equal(field('State'), 'Archived'); assert.equal(field('By'), '<@u9>'); assert.ok(field('Name').includes('Solved'));
  reset();
  entriesByType.set(AuditLogEvent.ThreadDelete, [{ targetId: 't1', executor: { id: 'u8' } }]);
  await handleThreadDelete(thread(), client);
  assert.equal(last().embed.author.name, 'Thread Deleted'); assert.equal(field('By'), '<@u8>');

  // ---- stickers go to the emoji category
  reset();
  const sticker = { id: 's1', name: 'wave', description: 'Hello', tags: '👋', format: 1, url: 'https://x.test/s.png', guild: { id: '1' } };
  await handleStickerCreate(sticker, client);
  assert.equal(last().event, 'emojis'); assert.equal(last().embed.author.name, 'Sticker Added'); assert.equal(last().embed.thumbnail.url, sticker.url);
  await handleStickerUpdate(sticker, { ...sticker, name: 'wave2' }, client);
  assert.ok(field('Name').includes('wave2'));
  const count = sent.length;
  await handleStickerUpdate(sticker, { ...sticker }, client);
  assert.equal(sent.length, count, 'no change, no log');
  await handleStickerDelete(sticker, client);
  assert.equal(last().embed.author.name, 'Sticker Removed');

  // ---- AutoMod rules
  reset();
  const rule = { id: 'r1', name: 'No links', enabled: true, triggerType: 1, actions: [{ type: 1 }, { type: 2 }], creatorId: 'u1', triggerMetadata: { keywordFilter: ['a'] }, guild: { id: '1' } };
  await handleRuleCreate(rule, client);
  assert.equal(last().event, 'automod'); assert.equal(field('Actions'), 'Block message, Send alert'); assert.equal(field('By'), '<@u1>');
  await handleRuleUpdate(rule, { ...rule, enabled: false }, client);
  assert.equal(field('Enabled'), 'Yes -> No');
  const total = sent.length;
  await handleRuleUpdate(rule, { ...rule }, client);
  assert.equal(sent.length, total);
  await handleRuleDelete(rule, client);
  assert.equal(last().embed.author.name, 'AutoMod Rule Deleted');

  // ---- scheduled events
  reset();
  const event = { id: 'e1', name: 'Movie night', description: 'Popcorn', scheduledStartTimestamp: 1_800_000_000_000, scheduledEndTimestamp: null, channelId: '20', entityMetadata: null, status: 1, creatorId: 'u1', guild: { id: '1' } };
  await server.handleScheduledEventCreate(event, client);
  assert.equal(last().event, 'server'); assert.equal(field('Where'), '<#20>'); assert.equal(field('By'), '<@u1>');
  await server.handleScheduledEventUpdate(event, { ...event, status: 2 }, client);
  assert.equal(field('Status'), 'Scheduled -> Active');
  await server.handleScheduledEventDelete(event, client);
  assert.equal(last().embed.author.name, 'Event Deleted');

  // ---- role permission details
  reset();
  const role = (perms, extra = {}) => ({ id: 'ro', name: 'Mod', color: 0, hoist: false, mentionable: false, icon: null, unicodeEmoji: null, permissions: new PermissionsBitField(perms), guild: { id: '1' }, ...extra });
  await server.handleRoleUpdate(role([PermissionFlagsBits.KickMembers]), role([PermissionFlagsBits.KickMembers, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.BanMembers]), client);
  assert.ok(field('Permissions granted').includes('Manage Messages') && field('Permissions granted').includes('Ban Members'));
  assert.equal(field('Permissions removed'), undefined);
  await server.handleRoleUpdate(role([PermissionFlagsBits.KickMembers]), role([]), client);
  assert.ok(field('Permissions removed').includes('Kick Members'));
  await server.handleRoleUpdate(role([]), role([], { icon: 'abc' }), client);
  assert.equal(field('Icon'), 'The role icon was changed');

  // ---- channel details and permission overwrites
  reset();
  const overwrite = (id, type, allow, deny) => ({ id, type, allow: new PermissionsBitField(allow), deny: new PermissionsBitField(deny) });
  const chan = (extra = {}, overwrites = []) => ({ id: 'c1', name: 'general', topic: null, parentId: null, nsfw: false, rateLimitPerUser: 0, guild: { id: '1' }, permissionOverwrites: { cache: new Collection(overwrites.map((o) => [o.id, o])) }, ...extra });
  await server.handleChannelUpdate(chan(), chan({ nsfw: true, rateLimitPerUser: 30 }), client);
  assert.equal(field('Age-restricted'), '`false` -> `true`'); assert.equal(field('Slowmode'), '0s -> 30s');
  await server.handleChannelUpdate(chan({}, [overwrite('r1', 0, [], [])]), chan({}, [overwrite('r1', 0, [PermissionFlagsBits.SendMessages], [PermissionFlagsBits.AddReactions]), overwrite('u2', 1, [], [PermissionFlagsBits.ViewChannel])]), client);
  const lines = field('Permissions');
  assert.ok(lines.includes('<@&r1>: allowed Send Messages; denied Add Reactions'), lines);
  assert.ok(lines.includes('Added for <@u2>'));
  await server.handleChannelUpdate(chan({}, [overwrite('r1', 0, [PermissionFlagsBits.SendMessages], [])]), chan(), client);
  assert.ok(field('Permissions').includes('Removed for <@&r1>'));
  const before2 = sent.length;
  await server.handleChannelUpdate(chan(), chan(), client);
  assert.equal(sent.length, before2, 'nothing changed, nothing told');

  // ---- members: timeout, boost, server avatar, kick
  reset();
  const member = (extra = {}) => ({ id: 'm1', user: { id: 'm1', username: 'liam' }, guild: { id: '1' }, roles: { cache: new Collection() }, nickname: null, avatar: null, premiumSinceTimestamp: null, communicationDisabledUntilTimestamp: null, joinedTimestamp: now - 86400000, ...extra });
  entriesByType.set(AuditLogEvent.MemberUpdate, [{ targetId: 'm1', executor: { id: 'mod' }, reason: 'Spam' }]);
  const until = now + 3600_000;
  await handleMemberUpdate(member(), member({ communicationDisabledUntilTimestamp: until }), client);
  assert.equal(last().embed.author.name, 'Member Timed Out'); assert.equal(field('By'), '<@mod>'); assert.equal(field('Reason'), 'Spam');
  await handleMemberUpdate(member({ communicationDisabledUntilTimestamp: until }), member(), client);
  assert.equal(last().embed.author.name, 'Timeout Removed');
  await handleMemberUpdate(member(), member({ premiumSinceTimestamp: now }), client);
  assert.equal(last().embed.author.name, 'Started Boosting');
  await handleMemberUpdate(member({ premiumSinceTimestamp: now }), member(), client);
  assert.equal(last().embed.author.name, 'Stopped Boosting');
  await handleMemberUpdate(member(), member({ avatar: 'hash' }), client);
  assert.equal(last().embed.author.name, 'Server Avatar Changed');
  const before3 = sent.length;
  await handleMemberUpdate(member({ communicationDisabledUntilTimestamp: now - 1000 }), member({ communicationDisabledUntilTimestamp: now - 500 }), client);
  assert.equal(sent.length, before3, 'an old, expired timeout is not news');
  reset();
  entriesByType.set(AuditLogEvent.MemberKick, [{ targetId: 'm1', executor: { id: 'mod' }, reason: 'Rule 3' }]);
  await handleMemberLeave(member(), client);
  assert.equal(last().embed.author.name, 'Member Kicked'); assert.equal(field('Reason'), 'Rule 3');
  entriesByType.clear();
  await handleMemberLeave(member(), client);
  assert.equal(last().embed.author.name, 'Member Left');

  console.log('Checked the log handlers: webhooks, threads, stickers, events, AutoMod rules, permissions, timeouts, boosts and kicks.');
})().catch((error) => { console.error(error); process.exit(1); });
