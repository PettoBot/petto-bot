// Checks the Honeypot routes of the dashboard (src/web/honeypotRoutes.js): administrators only, the same channel and permission checks
// as `!honeypot add`, the three kinds of message, posting again, and removing. The database and Discord are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/utils/logger.js', { info() {}, warn() {}, error() {}, debug() {} });
stub('src/db/guilds.js', { ensureGuild: async () => ({}) });
const templates = new Map([['g:warn', { data: { embeds: [{ title: 'Stop' }] } }]]);
stub('src/db/embedTemplates.js', { getTemplate: async (guildId, name) => templates.get(`${guildId}:${name}`) ?? null });

const rows = new Map();
stub('src/db/honeypot.js', {
  PUNISHMENTS: ['ban', 'softban', 'kick'],
  getHoneypot: async (guildId, channelId) => (rows.has(channelId) ? { ...rows.get(channelId) } : null),
  upsertHoneypot: async (guildId, channelId, punishment) => {
    const row = { panel_mode: 'default', panel_text: '', panel_template: null, panel_message_id: null, caught_count: 0, ...rows.get(channelId), guild_id: guildId, channel_id: channelId, punishment };
    rows.set(channelId, row); return { ...row };
  },
  setPanelSettings: async (guildId, channelId, changes) => { rows.set(channelId, { ...rows.get(channelId), ...changes }); return { ...rows.get(channelId) }; },
  setPanelMessage: async (guildId, channelId, id) => { rows.set(channelId, { ...rows.get(channelId), panel_message_id: id }); return { ...rows.get(channelId) }; },
  removeHoneypot: async (guildId, channelId) => { const row = rows.get(channelId); rows.delete(channelId); return row ?? null; },
});
const posted = []; const removedPanels = [];
stub('src/utils/honeypot.js', {
  invalidateHoneypotCache() {},
  createOrUpdatePanel: async (client, channel, row) => {
    if ((row.panel_mode ?? 'default') === 'none') { rows.set(row.channel_id, { ...row, panel_message_id: null }); return { ...rows.get(row.channel_id) }; }
    posted.push({ channel: channel.id, mode: row.panel_mode, had: row.panel_message_id });
    rows.set(row.channel_id, { ...row, panel_message_id: row.panel_message_id ?? `m${posted.length}` });
    return { ...rows.get(row.channel_id) };
  },
  deletePanel: async (client, row) => { if (row.panel_message_id) removedPanels.push(row.panel_message_id); },
});

const { registerHoneypotRoutes } = require('../src/web/honeypotRoutes');

const ALL = new Set(Object.values(PermissionFlagsBits));
const perms = (granted) => ({ has: (flag) => (Array.isArray(flag) ? flag.every((f) => granted.has(f)) : granted.has(flag)) });
const me = { id: 'bot' };
const channel = (id, type, granted = ALL) => ({ id, name: `chan-${id}`, type, guildId: 'g', permissionsFor: () => perms(granted) });
const channels = new Map([
  ['100000000000000001', channel('100000000000000001', ChannelType.GuildText)],
  ['100000000000000002', channel('100000000000000002', ChannelType.GuildVoice)],
  ['100000000000000003', channel('100000000000000003', ChannelType.GuildText, new Set([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]))],
]);
const guild = { id: 'g', client: {}, members: { me }, channels: { cache: channels, fetch: async () => null } };
const admin = { permissions: perms(ALL) };
const manager = { permissions: perms(new Set([PermissionFlagsBits.ManageGuild])) };

let handler = null;
registerHoneypotRoutes({ post: (route, ...stack) => { assert.equal(route, '/api/dashboard/guild/:guildId/honeypot/:action'); handler = stack.at(-1); } }, { authorize: async (req) => ({ guild, member: req.member, userId: 'u' }) });

async function call(action, body, member = admin) {
  let status = 200; let payload = null;
  const res = { status(code) { status = code; return this; }, json(value) { payload = value; return this; }, set() { return this; } };
  await handler({ params: { guildId: 'g', action }, body, member, query: {}, get: () => undefined, headers: {} }, res);
  return { status, ...payload };
}

(async () => {
  const BAIT = '100000000000000001';
  let r = await call('add', { channel_id: BAIT }, manager);
  assert.equal(r.status, 403); assert.equal(r.code, 'admin_only', 'the command is for administrators, so the route is too');
  r = await call('nope', {}); assert.equal(r.status, 404);
  r = await call('add', { channel_id: '100000000000000002' }); assert.equal(r.code, 'bad_channel', 'only text and announcement channels');
  r = await call('add', { channel_id: '100000000000000003' }); assert.equal(r.code, 'missing_permissions'); assert.match(r.message, /Read Message History|ReadMessageHistory|history/i);
  r = await call('add', { channel_id: BAIT, punishment: 'mute' }); assert.equal(r.code, 'bad_punishment');

  r = await call('add', { channel_id: BAIT });
  assert.equal(r.ok, true); assert.equal(r.honeypot.punishment, 'softban', 'softban by default, like the command'); assert.equal(posted.length, 1);
  r = await call('add', { channel_id: BAIT, punishment: 'ban' });
  assert.equal(r.ok, true); assert.equal(r.honeypot.punishment, 'ban'); assert.equal(posted.at(-1).had, 'm1', 'a new punishment updates the same panel');

  r = await call('panel', { channel_id: BAIT, mode: 'custom', text: '', template: '' }); assert.equal(r.code, 'custom_empty');
  r = await call('panel', { channel_id: BAIT, mode: 'custom', text: '', template: 'missing' }); assert.equal(r.code, 'no_embed');
  r = await call('panel', { channel_id: BAIT, mode: 'loud' }); assert.equal(r.code, 'bad_mode');
  r = await call('panel', { channel_id: BAIT, mode: 'custom', text: 'Do not write in {honeypot.channel}', template: 'warn' });
  assert.equal(r.ok, true); assert.equal(r.honeypot.panel_mode, 'custom'); assert.equal(r.honeypot.panel_template, 'warn'); assert.equal(r.honeypot.panel_text, 'Do not write in {honeypot.channel}');
  r = await call('panel', { channel_id: BAIT, mode: 'none' }); assert.equal(r.ok, true); assert.equal(r.honeypot.panel_message_id, null, 'none posts nothing');
  r = await call('post', { channel_id: BAIT }); assert.equal(r.code, 'nothing_to_post');
  r = await call('panel', { channel_id: BAIT, mode: 'default' }); assert.equal(r.ok, true); assert.equal(r.honeypot.panel_text, 'Do not write in {honeypot.channel}', 'the custom text is kept for later');

  const before = rows.get(BAIT).panel_message_id;
  r = await call('post', { channel_id: BAIT, fresh: true });
  assert.equal(r.ok, true); assert.ok(removedPanels.includes(before), 'posting again as a new message removes the old one'); assert.equal(posted.at(-1).had, null);

  r = await call('remove', { channel_id: '100000000000000009' }); assert.equal(r.code, 'not_honeypot');
  r = await call('remove', { channel_id: BAIT }); assert.equal(r.ok, true); assert.equal(rows.has(BAIT), false);

  console.log('Honeypot routes: admin only, channel and permission checks, messages, posting again and removing work.');
})().catch((err) => { console.error(err); process.exit(1); });
