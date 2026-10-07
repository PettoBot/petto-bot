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
const extra = require('../src/logging/extraLog');
const { EVENTS } = require('../src/db/logConfig');

const client = { user: { id: 'bot' } };
const last = () => sent.at(-1);
const field = (name) => last().embed.fields.find((f) => f.name === name)?.value;
const reset = () => { sent.length = 0; entriesByType.clear(); };
const member2 = () => ({ id: 'b1', guild: { id: '1' }, roles: { cache: new Collection() }, joinedTimestamp: Date.now() - 1000 });

(async () => {
  for (const category of ['webhooks', 'threads', 'integrations', 'commands']) assert.ok(EVENTS.includes(category), `${category} can be chosen with !logs`);

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
  await server.handleChannelUpdate(chan(), chan({ nsfw: true, rateLimitPerUser: 30 }), client, { waitMs: 0 });
  assert.equal(field('Age-restricted'), '`false` -> `true`'); assert.equal(field('Slowmode'), '0s -> 30s');
  await server.handleChannelUpdate(chan({}, [overwrite('r1', 0, [], [])]), chan({}, [overwrite('r1', 0, [PermissionFlagsBits.SendMessages], [PermissionFlagsBits.AddReactions]), overwrite('u2', 1, [], [PermissionFlagsBits.ViewChannel])]), client, { waitMs: 0 });
  const lines = field('Permissions');
  assert.ok(lines.includes('<@&r1>: allowed Send Messages; denied Add Reactions'), lines);
  assert.ok(lines.includes('Added for <@u2>'));
  await server.handleChannelUpdate(chan({}, [overwrite('r1', 0, [PermissionFlagsBits.SendMessages], [])]), chan(), client, { waitMs: 0 });
  assert.ok(field('Permissions').includes('Removed for <@&r1>'));
  const before2 = sent.length;
  await server.handleChannelUpdate(chan(), chan(), client, { waitMs: 0 });
  assert.equal(sent.length, before2, 'nothing changed, nothing told');

  // Several permission changes a few moments apart are told as one message: the channel before the first and after the last.
  const sentBefore = sent.length;
  const step0 = chan({}, []);
  const step1 = chan({}, [overwrite('everyone', 0, [], [PermissionFlagsBits.ManageChannels])]);
  const step2 = chan({}, [overwrite('everyone', 0, [], [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])]);
  const step3 = chan({}, [overwrite('everyone', 0, [PermissionFlagsBits.ViewChannel], [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageWebhooks])]);
  await Promise.all([server.handleChannelUpdate(step0, step1, client, { waitMs: 30 }), server.handleChannelUpdate(step1, step2, client, { waitMs: 30 }), server.handleChannelUpdate(step2, step3, client, { waitMs: 30 })]);
  assert.equal(sent.length, sentBefore + 1, 'three changes of the same channel, one message');
  const merged = field('Permissions');
  assert.ok(merged.includes('allowed View Channel') && merged.includes('denied Manage Channels, Manage Roles, Manage Webhooks'), merged);
  // A channel that keeps changing is still told after the longest wait.
  const sentBeforeMax = sent.length;
  const slow = (async () => { for (let i = 0; i < 4; i += 1) { await server.handleChannelUpdate(chan(), chan({ topic: `t${i}` }), client, { waitMs: 40, maxMs: 90 }); } })();
  await slow;
  assert.ok(sent.length >= sentBeforeMax + 1, 'it is told');
  // Two different channels are not mixed.
  const sentBeforeTwo = sent.length;
  const other = (extra, overwrites) => ({ ...chan(extra, overwrites), id: 'c2', name: 'other' });
  await Promise.all([server.handleChannelUpdate(chan(), chan({ nsfw: true }), client, { waitMs: 20 }), server.handleChannelUpdate(other(), other({ topic: 'x' }), client, { waitMs: 20 })]);
  assert.equal(sent.length, sentBeforeTwo + 2, 'one message for each channel');

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


  // ---- pins
  reset();
  const msg = { id: 'pm1', content: 'Rules here', author: { id: 'u5' } };
  const pinChannel = { id: '10', messages: { fetch: async (id) => (id === 'pm1' ? msg : null) }, guild: { id: '1', fetchAuditLogs: async ({ type }) => ({ entries: new Collection((entriesByType.get(type) ?? []).map((e) => [e.id, e])) }) } };
  entriesByType.set(AuditLogEvent.MessagePin, [{ id: 'p1', executor: { id: 'mod' }, createdTimestamp: Date.now() - 300, extra: { channel: { id: '10' }, messageId: 'pm1' } }]);
  entriesByType.set(AuditLogEvent.MessageUnpin, [{ id: 'p2', executor: { id: 'mod' }, createdTimestamp: Date.now() - 300, extra: { channel: { id: '99' }, messageId: 'zz' } }]);
  await extra.handleChannelPins(pinChannel, client);
  assert.equal(sent.length, 1, 'the unpin in another channel is not this one');
  assert.equal(last().event, 'messages'); assert.equal(last().embed.author.name, 'Message Pinned');
  assert.equal(field('Message'), 'Rules here'); assert.ok(field('Link').includes('/1/10/pm1')); assert.equal(field('By'), '<@mod>');
  await extra.handleChannelPins(pinChannel, client);
  assert.equal(sent.length, 1, 'an entry is told once');

  // ---- stage
  reset();
  const stage = { id: 'st1', topic: 'Q&A', channelId: '30', guild: { id: '1' } };
  await extra.handleStage('create', stage, null, client);
  assert.equal(last().event, 'voice'); assert.equal(last().embed.author.name, 'Stage Started');
  await extra.handleStage('update', { ...stage, topic: 'AMA' }, stage, client);
  assert.equal(field('Topic'), 'Q&A -> AMA');
  const stageCount = sent.length;
  await extra.handleStage('update', stage, { ...stage }, client);
  assert.equal(sent.length, stageCount);
  await extra.handleStage('delete', stage, null, client);
  assert.equal(last().embed.author.name, 'Stage Ended');

  // ---- soundboard
  reset();
  const sound = { soundId: 'sd1', name: 'airhorn', volume: 0.5, emoji: { name: '📣', id: null }, user: { id: 'u6' }, guild: { id: '1' } };
  await extra.handleSound('create', sound, null, client);
  assert.equal(last().event, 'emojis'); assert.equal(last().embed.author.name, 'Sound Added'); assert.equal(field('Volume'), '50%'); assert.equal(field('By'), '<@u6>');
  await extra.handleSound('update', { ...sound, name: 'horn' }, sound, client);
  assert.ok(field('Name').includes('horn'));
  const soundCount = sent.length;
  await extra.handleSound('update', sound, { ...sound }, client);
  assert.equal(sent.length, soundCount);

  // ---- integrations and bots
  reset();
  entriesByType.set(AuditLogEvent.IntegrationCreate, [{ id: 'i1', createdTimestamp: Date.now() - 200, executor: { id: 'u7' }, target: { name: 'YouTube', type: 'youtube' }, targetId: 'int1', changes: [] }]);
  await extra.handleIntegrationsUpdate({ id: '1', fetchAuditLogs: async ({ type }) => ({ entries: new Collection((entriesByType.get(type) ?? []).map((e) => [e.id, e])) }) }, client);
  assert.equal(last().event, 'integrations'); assert.equal(last().embed.author.name, 'Integration Added'); assert.equal(field('By'), '<@u7>');
  reset();
  entriesByType.set(AuditLogEvent.BotAdd, [{ targetId: 'b1', executor: { id: 'u7' } }]);
  const bot = { id: 'b1', user: { id: 'b1', bot: true, username: 'otherbot', createdTimestamp: Date.now() - 1e9 }, guild: { id: '1' }, permissions: { has: () => true } };
  await extra.handleBotAdded(bot, client);
  assert.equal(last().embed.author.name, 'Bot Added'); assert.equal(field('Added by'), '<@u7>'); assert.ok(field('Warning').includes('Administrator'));
  const botCount = sent.length;
  await extra.handleBotAdded({ ...bot, user: { ...bot.user, bot: false } }, client);
  assert.equal(sent.length, botCount, 'a person is not a bot');
  await extra.handleBotRemoved(bot, client);
  assert.equal(last().embed.author.name, 'Bot Removed');
  await handleMemberLeave({ ...member2(), user: { id: 'b1', bot: true, username: 'otherbot' } }, client);
  assert.ok(sent.some((s) => s.event === 'integrations' && s.embed.author.name === 'Bot Removed'), 'a bot that leaves goes to integrations too');

  // ---- command use: only the name, never what was typed
  reset();
  await extra.handleCommandUsed({ guild: { id: '1' }, user: { id: 'u1', bot: false, displayAvatarURL: () => null }, channel: { id: '10' }, name: 'role', prefix: '!', subcommand: 'add' }, client);
  assert.equal(last().event, 'commands'); assert.equal(field('Command'), '`!role add`'); assert.equal(field('How'), 'Message prefix');
  assert.ok(!JSON.stringify(last().embed).includes('secret'));
  await extra.handleCommandUsed({ guild: { id: '1' }, user: { id: 'u1', bot: false }, channel: { id: '10' }, name: 'ban', prefix: '/', subcommand: null }, client);
  assert.equal(field('How'), 'Slash command');
  const commandCount = sent.length;
  await extra.handleCommandUsed({ guild: { id: '1' }, user: { id: 'u2', bot: true }, channel: { id: '10' }, name: 'ping', prefix: '!' }, client);
  await extra.handleCommandUsed({ guild: null, user: { id: 'u1' }, name: 'ping', prefix: '!' }, client);
  assert.equal(sent.length, commandCount, 'bots and direct messages are not logged');
  assert.doesNotThrow(() => extra.logCommandUse({ guild: null }, client));

  // ---- server settings
  reset();
  const guildState = (extra2 = {}) => ({ id: '1', name: 'Home', icon: null, banner: null, description: null, vanityURLCode: null, widgetEnabled: false, premiumTier: 1, verificationLevel: 1, explicitContentFilter: 0, defaultMessageNotifications: 1, mfaLevel: 0, systemChannelId: null, rulesChannelId: null, publicUpdatesChannelId: null, afkChannelId: null, afkTimeout: 300, preferredLocale: 'en-US', iconURL: () => null, ...extra2 });
  await server.handleGuildUpdate(guildState(), guildState({ vanityURLCode: 'home', verificationLevel: 3, premiumTier: 2, widgetEnabled: true, systemChannelId: '40' }), client);
  assert.equal(field('Vanity URL'), '*None* -> discord.gg/home'); assert.equal(field('Verification level'), 'Low -> High');
  assert.equal(field('Boost level'), '1 -> 2'); assert.equal(field('Widget'), 'Enabled'); assert.equal(field('System messages channel'), '*None* -> <#40>');
  const guildCount = sent.length;
  await server.handleGuildUpdate(guildState(), guildState(), client);
  assert.equal(sent.length, guildCount);

  console.log('Checked the log handlers: webhooks, threads, stickers, events, AutoMod rules, permissions, timeouts, boosts, kicks, pins, stages, sounds, integrations, bots, command use and server settings.');
})().catch((error) => { console.error(error); process.exit(1); });
