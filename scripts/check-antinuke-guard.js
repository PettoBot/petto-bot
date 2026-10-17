// The guard protections of the anti-nuke, with Discord, the audit log and the database replaced: a role or channel given
// dangerous permissions (answered at once and put back), edits in a row, the server name and icon put back, @everyone floods,
// webhook floods, prunes, the audit log read again when it is late (and never blamed twice), never touching an account above
// Petto, the trusted admins, "owner only", the DM to the owner, panic mode (alone and from Anti Raid) and the restore retry.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const { Collection, PermissionFlagsBits, AuditLogEvent, WebhookType } = require('discord.js');

const stub = (file, exports) => { const p = require.resolve(file); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
let config = {};
let rules = [];
const events = [];
const logs = [];
const lockdowns = [];
let lockdownActive = null;
stub('../src/db/antinuke', { getConfig: async () => config, getRules: async () => rules, createEvent: async (e) => { const saved = { id: events.length + 1, ...e }; events.push(saved); return saved; } });
stub('../src/logging/engine', { sendLog: async (_c, _g, _e, embed, extra) => { logs.push({ embed, extra }); } });
stub('../src/db/lockdown', { getActive: async () => lockdownActive });
stub('../src/utils/lockdown', { startLockdown: async (guild, options) => { lockdowns.push(options); lockdownActive = { guild_id: guild.id }; return { locked: 1, failed: 0 }; } });
stub('../src/db/automod', { getConfig: async () => ({ anti_raid_enabled: true, raid_join_threshold: 3, raid_window_seconds: 10, raid_action: 'alert' }) });
stub('../src/utils/logger', { info() {}, warn() {}, error() {}, debug() {} });

const { setCachedGuildLanguage } = require('../src/i18n');
setCachedGuildLanguage('g1', 'en');
const { resetAntiNuke, aboveMe } = require('../src/utils/antiNuke');
const { resetPanic, panicSettings } = require('../src/utils/antiNukePanic');
const { canRestore, restoreEvent } = require('../src/utils/antiNukeRestore');
const { gainedFlags, DANGEROUS_ROLE_FLAGS } = require('../src/utils/antiNukeDanger');
const roleUpdate = require('../src/events/roleUpdateAntiNuke');
const channelUpdate = require('../src/events/channelUpdateAntiNuke');
const guildUpdate = require('../src/events/guildUpdateAntiNuke');
const messageCreate = require('../src/events/messageCreateAntiNuke');
const auditEntry = require('../src/events/guildAuditLogEntryCreateAntiNuke');
const webhooksUpdate = require('../src/events/webhooksUpdateAntiNuke');
const antiRaid = require('../src/events/guildMemberAddAntiRaid');

// ---- a server, its members, its roles and channels, and an audit log the check fills
const calls = [];
const dms = [];
let audit = []; // entries the log shows right now
let auditReads = 0;
let auditLateBy = 0; // how many reads still miss the entry (the log is late)
let nextEntry = 1;
const entry = (action, executor, targetId, extra = {}) => ({ id: `e${nextEntry++}`, action, executor, executorId: executor.id, targetId, createdTimestamp: Date.now(), ...extra });

const roleObj = (id, position, managed = false) => ({ id, position, managed });
function member(id, roleIds = [], { position = 1, bot = false } = {}) {
  const cache = new Collection(roleIds.map((r) => [r, roleObj(r, position, r.startsWith('managed'))]));
  return {
    id, user: { id, bot }, manageable: true, kickable: true, bannable: true,
    roles: { cache, highest: { position }, set: async (r) => calls.push(['roles.set', id, r]), remove: async (r) => calls.push(['roles.remove', id, r]) },
    kick: async () => calls.push(['kick', id]),
  };
}
const human = { id: 'u1', bot: false, username: 'mallory' };
const members = new Map([
  ['u1', member('u1', ['rA', 'managed1'])],
  ['u2', member('u2', ['rA'], { position: 50 })], // above Petto
  ['admin1', member('admin1', ['rA'])],
  ['owner', member('owner')],
]);
const roles = new Map([['g1', { id: 'g1', name: '@everyone' }]]);
const channels = new Map();
const client = {
  user: { id: 'petto' },
  users: { fetch: async (id) => ({ id, bot: false, username: id }) },
  deleteWebhook: async (id) => calls.push(['deleteWebhook', id]),
};
const guild = {
  id: 'g1', name: 'Test', ownerId: 'owner', client,
  members: {
    cache: members, me: { roles: { highest: { position: 10 } } },
    fetch: async (id) => members.get(id) ?? null,
    ban: async (id) => calls.push(['ban', id]), kick: async (id) => calls.push(['kick', id]),
  },
  roles: { cache: roles, everyone: { id: 'g1' } },
  channels: { cache: channels, fetch: async () => null },
  fetchAuditLogs: async ({ type } = {}) => {
    auditReads += 1;
    if (auditLateBy > 0) { auditLateBy -= 1; return { entries: new Collection() }; }
    return { entries: new Collection(audit.filter((e) => type === undefined || e.action === type).map((e) => [e.id, e])) };
  },
  fetchOwner: async () => ({ send: async (payload) => dms.push(payload) }),
  edit: async (patch) => calls.push(['guild.edit', patch]),
};
const perms = (...names) => ({ bitfield: names.reduce((acc, n) => acc | PermissionFlagsBits[n], 0n), has: () => false });
function makeRole(id, name, permNames) {
  const role = { id, name, color: 0, hoist: false, mentionable: false, permissions: perms(...permNames), guild, client, editable: true, edit: async (patch) => calls.push(['role.edit', id, patch]) };
  roles.set(id, role);
  return role;
}
const overwrites = (list) => ({ cache: new Map(list.map((o) => [o.id, { id: o.id, type: o.type ?? 0, allow: { bitfield: o.allow ?? 0n }, deny: { bitfield: o.deny ?? 0n } }])), set: async (o) => calls.push(['overwrites.set', o]) });
function makeChannel(id, name, list = []) {
  const ch = { id, name, topic: null, nsfw: false, guild, client, isThread: () => false, permissionOverwrites: overwrites(list), edit: async (patch) => calls.push(['channel.edit', id, patch]), messages: { delete: async (mid) => calls.push(['message.delete', mid]) } };
  channels.set(id, ch);
  return ch;
}
const ruleRow = (rule, extra = {}) => ({ rule, enabled: true, threshold: 3, window_seconds: 10, action: 'quarantine', alert_channel_id: null, whitelist_ids: [], whitelist_role_ids: [], ...extra });
function reset(nextRules, nextConfig = {}) {
  resetAntiNuke(); resetPanic();
  calls.length = 0; events.length = 0; logs.length = 0; dms.length = 0; lockdowns.length = 0; lockdownActive = null;
  audit = []; auditReads = 0; auditLateBy = 0;
  rules = nextRules; config = { whitelist_ids: [], whitelist_role_ids: [], ...nextConfig };
}
const kinds = () => calls.map((c) => c[0]);

(async () => {
  // ---- the helpers
  assert.deepEqual(gainedFlags(0n, PermissionFlagsBits.Administrator, DANGEROUS_ROLE_FLAGS), ['Administrator']);
  assert.deepEqual(gainedFlags(PermissionFlagsBits.Administrator, PermissionFlagsBits.Administrator | PermissionFlagsBits.BanMembers, DANGEROUS_ROLE_FLAGS), [], 'a role that was already admin gains nothing new');
  assert.deepEqual(gainedFlags(0n, PermissionFlagsBits.SendMessages, DANGEROUS_ROLE_FLAGS), []);
  assert.equal(aboveMe(guild, members.get('u2')), true);
  assert.equal(aboveMe(guild, members.get('u1')), false);
  assert.deepEqual(panicSettings(null), { enabled: false, threshold: 2, windowMinutes: 10, lockdownMinutes: 30, onRaid: true }, 'panic mode starts off');

  // ---- a protection that is off does nothing, even for a role given Administrator
  reset([]);
  const mods = makeRole('r1', 'Mods', ['SendMessages']);
  const modsAdmin = { ...mods, permissions: perms('SendMessages', 'Administrator') };
  audit = [entry(AuditLogEvent.RoleUpdate, human, 'r1')];
  await roleUpdate.execute(mods, modsAdmin);
  assert.equal(calls.length, 0, 'off means off');

  // ---- Anti Role Changes: a role given Administrator is put back at once and the account answers, even under the limit
  reset([ruleRow('role_update')]);
  audit = [entry(AuditLogEvent.RoleUpdate, human, 'r1')];
  await roleUpdate.execute(mods, modsAdmin);
  assert.deepEqual(kinds(), ['role.edit', 'roles.set'], 'the role goes back first, then the account is quarantined');
  assert.equal(calls[0][2].permissions, mods.permissions.bitfield, 'with its old permissions');
  assert.deepEqual(calls[1][2], ['managed1'], 'managed roles stay, the rest is taken');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].previous_roles, ['rA'], 'and kept to give back');
  assert.match(events[0].detail, /Administrator/);
  assert.equal(dms.length, 1, 'the owner hears about it in DMs');
  assert.ok(logs.length === 1 && /mallory|u1/.test(logs[0].embed.description), 'the incident card names the account');

  // a second escalation inside the window is still put back, without a second alert
  audit = [entry(AuditLogEvent.RoleUpdate, human, 'r1')];
  await roleUpdate.execute(mods, modsAdmin);
  assert.deepEqual(kinds().slice(2), ['role.edit'], 'undone again, not punished twice');
  assert.equal(events.length, 1);

  // ---- edits in a row: three renames, back to the name before the first one
  reset([ruleRow('role_update', { action: 'alert' })]);
  const names = ['Mods', 'nuked1', 'nuked2', 'nuked3'];
  for (let i = 0; i < 3; i += 1) {
    audit = [entry(AuditLogEvent.RoleUpdate, human, 'r1')];
    await roleUpdate.execute({ ...mods, name: names[i] }, { ...mods, name: names[i + 1] });
  }
  assert.deepEqual(kinds(), ['role.edit'], 'one revert, alert only');
  assert.equal(calls[0][2].name, 'Mods', 'to the oldest name');

  // ---- Anti Channel Changes: @everyone given Mention Everyone in a channel is closed again at once
  reset([ruleRow('channel_update')]);
  const before = makeChannel('c1', 'general', [{ id: 'g1', deny: PermissionFlagsBits.SendMessages }]);
  const after = { ...before, permissionOverwrites: overwrites([{ id: 'g1', allow: PermissionFlagsBits.MentionEveryone }]) };
  audit = [entry(AuditLogEvent.ChannelOverwriteUpdate, human, 'c1')];
  await channelUpdate.execute(before, after);
  assert.deepEqual(kinds(), ['channel.edit', 'overwrites.set', 'roles.set']);
  assert.deepEqual(calls[1][1], [{ id: 'g1', type: 0, allow: 0n, deny: PermissionFlagsBits.SendMessages }], 'the old overwrites come back');
  // a channel edited once by somebody, under the limit, is left alone
  reset([ruleRow('channel_update')]);
  audit = [entry(AuditLogEvent.ChannelUpdate, human, 'c1')];
  await channelUpdate.execute(before, { ...before, name: 'renamed' });
  assert.equal(calls.length, 0);

  // ---- Anti Server Changes: the name and the icon go back, the vanity is reported
  reset([ruleRow('guild_update', { threshold: 2, action: 'alert' })]);
  const g = (name, icon, vanity) => ({ ...guild, name, icon, vanityURLCode: vanity, iconURL: () => `https://cdn/${icon}.png` });
  audit = [entry(AuditLogEvent.GuildUpdate, human, 'g1')];
  await guildUpdate.execute(g('Test', 'i1', 'cool'), g('NUKED', 'i1', 'cool'));
  audit = [entry(AuditLogEvent.GuildUpdate, human, 'g1')];
  await guildUpdate.execute(g('NUKED', 'i1', 'cool'), g('NUKED', 'i2', 'stolen'));
  assert.deepEqual(kinds(), ['guild.edit']);
  assert.deepEqual(calls[0][1], { name: 'Test', icon: 'https://cdn/i1.png', reason: calls[0][1].reason });
  assert.match(logs[0].embed.description, /cool/, 'the old vanity is named so the owner can set it back');

  // ---- Anti Mass Mention: two @everyone pings, deleted and punished; bots and the owner are left alone
  reset([ruleRow('mention_everyone', { threshold: 2, window_seconds: 30 })]);
  makeChannel('c2', 'chat');
  const ping = (id, author) => messageCreate.execute({ id, guild, client, channelId: 'c2', author, mentions: { everyone: true } });
  await ping('m0', { id: 'bot9', bot: true, username: 'announcer' });
  await ping('m1', { id: 'owner', bot: false, username: 'owner' });
  await ping('m2', { id: 'owner', bot: false, username: 'owner' });
  assert.equal(calls.length, 0, 'bots and the owner never answer to it');
  await ping('m3', human);
  assert.equal(calls.length, 0, 'one ping is fine');
  await ping('m4', human);
  assert.deepEqual(kinds().sort(), ['message.delete', 'message.delete', 'roles.set']);
  assert.match(logs[0].embed.description, /2 pings/);

  // ---- Anti Webhook Spam: a person's webhook flooding is deleted and the person answers; a bot's webhook is left alone
  reset([ruleRow('webhook_spam', { threshold: 3 })]);
  const hookOf = (id, owner) => async () => ({ id, name: `hook-${id}`, type: WebhookType.Incoming, applicationId: null, owner });
  for (let i = 0; i < 3; i += 1) await messageCreate.execute({ id: `w${i}`, guild, client, webhookId: 'wh1', fetchWebhook: hookOf('wh1', { id: 'bot7', bot: true, username: 'pk' }), mentions: {} });
  assert.equal(calls.length, 0, 'a webhook of a bot (PluralKit and the like) is not touched');
  for (let i = 0; i < 3; i += 1) await messageCreate.execute({ id: `x${i}`, guild, client, webhookId: 'wh2', fetchWebhook: hookOf('wh2', human), mentions: {} });
  assert.deepEqual(kinds(), ['deleteWebhook', 'roles.set']);
  assert.equal(calls[0][1], 'wh2');
  // with the protection off, the webhook is not even looked up
  reset([]);
  let looked = 0;
  for (let i = 0; i < 5; i += 1) await messageCreate.execute({ id: `y${i}`, guild, client, webhookId: 'wh3', fetchWebhook: async () => { looked += 1; return null; }, mentions: {} });
  assert.equal(looked, 0);

  // ---- Anti Prune: read from the audit log entry itself
  reset([ruleRow('prune', { threshold: 1, action: 'kick' })]);
  await auditEntry.execute({ action: AuditLogEvent.MemberPrune, executor: human, executorId: 'u1', extra: { removed: 120 } }, guild);
  assert.deepEqual(kinds(), ['kick']);
  assert.match(events[0].detail, /120/);

  // ---- never an account above Petto
  reset([ruleRow('prune', { threshold: 1, action: 'ban' })]);
  await auditEntry.execute({ action: AuditLogEvent.MemberPrune, executor: { id: 'u2', bot: false, username: 'high' }, extra: { removed: 3 } }, guild);
  assert.equal(calls.length, 0, 'not banned: its role is above Petto');
  assert.match(logs[0].embed.description, /above mine/);

  // ---- trusted admins are never touched
  reset([ruleRow('prune', { threshold: 1, action: 'ban' })], { admin_ids: ['admin1'] });
  await auditEntry.execute({ action: AuditLogEvent.MemberPrune, executor: { id: 'admin1', bot: false, username: 'a' }, extra: {} }, guild);
  assert.equal(calls.length + events.length, 0);

  // ---- the audit log arrives late: it is read again; one entry is never blamed twice
  reset([ruleRow('webhook', { threshold: 2, action: 'alert' })]);
  audit = [entry(AuditLogEvent.WebhookCreate, human, 'wh9', { target: { channelId: 'c2' } })];
  auditLateBy = 1;
  await webhooksUpdate.execute({ guild, client, id: 'c2' });
  assert.equal(auditReads, 2, 'read again when the entry was not there yet');
  await webhooksUpdate.execute({ guild, client, id: 'c2' }); // the same creation fires again (an edit)
  await webhooksUpdate.execute({ guild, client, id: 'c2' });
  assert.equal(events.length, 0, 'the same creation is not counted three times');
  audit.push(entry(AuditLogEvent.WebhookCreate, human, 'wh10', { target: { channelId: 'c2' } }));
  await webhooksUpdate.execute({ guild, client, id: 'c2' });
  assert.equal(events.length, 1, 'a second real creation reaches the limit');

  // ---- the DM to the owner can be turned off
  reset([ruleRow('prune', { threshold: 1, action: 'alert' })], { dm_owner: false });
  await auditEntry.execute({ action: AuditLogEvent.MemberPrune, executor: human, extra: {} }, guild);
  assert.equal(events.length, 1);
  assert.equal(dms.length, 0);

  // ---- panic mode: the second incident within the window locks the server down, invites paused, for the minutes chosen
  reset([ruleRow('prune', { threshold: 1, action: 'alert' })], { panic_enabled: true, panic_threshold: 2, panic_window_minutes: 10, panic_lockdown_minutes: 45 });
  await auditEntry.execute({ action: AuditLogEvent.MemberPrune, executor: human, extra: {} }, guild);
  assert.equal(lockdowns.length, 0);
  await auditEntry.execute({ action: AuditLogEvent.MemberPrune, executor: { id: 'u3', bot: false, username: 'other' }, extra: {} }, guild);
  assert.equal(lockdowns.length, 1);
  assert.equal(lockdowns[0].minutes, 45);
  assert.equal(lockdowns[0].pauseInvites, true);
  assert.equal(lockdowns[0].startedBy, 'petto');
  assert.match(logs[1].embed.description, /Panic mode/);
  await auditEntry.execute({ action: AuditLogEvent.MemberPrune, executor: { id: 'u4', bot: false, username: 'x' }, extra: {} }, guild);
  assert.equal(lockdowns.length, 1, 'once');

  // ---- panic mode from Anti Raid (raid action alert), and not when panic mode is off
  reset([], { panic_enabled: false });
  const joiner = (id) => ({ id, guild, client, user: { id, bot: false, username: id } });
  for (let i = 0; i < 3; i += 1) await antiRaid.execute(joiner(`j${i}`));
  assert.equal(lockdowns.length, 0, 'panic off: a raid only alerts');
  reset([], { panic_enabled: true });
  await new Promise((r) => setTimeout(r, 5)); // a new burst
  for (let i = 0; i < 3; i += 1) await antiRaid.execute({ ...joiner(`k${i}`), guild: { ...guild, id: 'g2' } });
  assert.equal(lockdowns.length, 1, 'panic on: a raid locks the server down');

  // ---- who may restore and change the anti-nuke
  const asMember = (id, admin) => ({ id, guild: { ownerId: 'owner' }, permissions: { has: () => admin } });
  assert.equal(canRestore(asMember('x', true), {}), true, 'administrators by default');
  assert.equal(canRestore(asMember('x', true), { owner_only: true }), false, 'not with owner only');
  assert.equal(canRestore(asMember('admin1', false), { owner_only: true, admin_ids: ['admin1'] }), true, 'trusted admins always');
  assert.equal(canRestore(asMember('owner', false), { owner_only: true }), true);

  // ---- restore: roles first, and a request Discord refused for going too fast is tried once more
  const made = [];
  let refusals = 1;
  const rguild = {
    id: 'g1', ownerId: 'owner',
    channels: { cache: { has: () => true, get: () => null }, create: async (o) => made.push(['channel', o.name]) },
    roles: { cache: { has: () => true, get: () => ({ position: 1 }) }, create: async (o) => { if (refusals-- > 0) { const e = new Error('You are being rate limited.'); e.status = 429; throw e; } made.push(['role', o.name]); } },
    members: { cache: { has: () => true }, unban: async (id) => made.push(['unban', id]) },
  };
  const result = await restoreEvent(rguild, { executor_id: 'u1', previous_roles: [], restorable: [{ kind: 'channel', name: 'general', type: 0, overwrites: [] }, { kind: 'role', name: 'Mods', color: 0, permissions: '8' }] });
  assert.deepEqual(made, [['role', 'Mods'], ['channel', 'general']]);
  assert.equal(result.failed.length, 0);

  console.log('antinuke guard ok');
})().catch((err) => { console.error(err); process.exit(1); });
