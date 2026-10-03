// Checks requests: making one, the card and its buttons, who may press what, the limits, the settings, and the claimed
// requests that go back to open when their time is over.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection, PermissionFlagsBits, MessageFlags } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/database.js', { from() { throw new Error('the database is not used in this check'); } });
stub('src/config.js', { ownerId: 'owner', developerIds: [] });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/utils/emojis.js', { EMOJI: { APPROVE: 'OK', DENY: 'NO' } });
stub('src/utils/caseCard.js', { textCard: (text) => ({ text }) });
stub('src/db/guilds.js', { ensureGuild: async () => {} });
const templates = new Map();
stub('src/db/embedTemplates.js', { getTemplate: async (guildId, name) => templates.get(`${guildId}:${name}`) ?? null });
stub('src/utils/templatedMessage.js', { templatePayload: async (guildId, name) => (templates.has(`${guildId}:${name}`) ? { content: undefined, embeds: [{ title: name }], components: [], files: [] } : null) });
let premiumActive = false;
stub('src/db/premium.js', { getGuildPremium: async () => ({ active: premiumActive }), getGuildLimits: () => ({}) });

const DEFAULTS = { enabled: false, channel_id: null, staff_role_id: null, ping_role_id: null, max_open: 3, completion_hours: 0, messages: {} };
let config = null;
let rows = [];
stub('src/db/requests.js', {
  DEFAULTS,
  getConfig: async () => config,
  upsertConfig: async (guildId, changes) => { config = { ...(config ?? DEFAULTS), ...changes }; return config; },
  listConfigsWithTimeout: async () => (config?.enabled && config.completion_hours > 0 ? [{ ...config, guild_id: 'g1' }] : []),
  create: async ({ guildId, userId, content }) => { const row = { number: rows.length + 1, guild_id: guildId, user_id: userId, content, status: 'open', claimed_by: null, created_at: new Date().toISOString(), claimed_at: null, completed_at: null, channel_id: null, message_id: null }; rows.push(row); return row; },
  get: async (guildId, number) => rows.find((row) => row.number === number) ?? null,
  update: async (guildId, number, changes) => { const row = rows.find((item) => item.number === number); if (!row) return null; Object.assign(row, changes); return { ...row }; },
  list: async (guildId, { statuses = ['open', 'claimed'], userId = null } = {}) => rows.filter((row) => statuses.includes(row.status) && (!userId || row.user_id === userId)).slice().reverse(),
  countOpenBy: async (guildId, userId) => rows.filter((row) => row.user_id === userId && ['open', 'claimed'].includes(row.status)).length,
  listClaimedBefore: async (guildId, before) => rows.filter((row) => row.status === 'claimed' && new Date(row.claimed_at) < before),
});

const cards = require('../src/utils/requestCards');
const { handleButton } = require('../src/interactions/requests');
const requestCommand = require('../src/commands/automation/request');
const requestConfigCommand = require('../src/commands/automation/requestconfig');
const { unclaimLate } = require('../src/utils/requestTimeouts');

const fakeUser = (id, username) => ({ id, username, bot: false, tag: username, globalName: username, displayName: username, createdTimestamp: 1_700_000_000_000, displayAvatarURL: () => 'https://cdn.example/a.png', bannerURL: () => null, toString: () => `<@${id}>` });
const fakeGuild = (over = {}) => ({ id: 'g1', name: 'Mine', ownerId: 'owner', memberCount: 100, premiumTier: 0, premiumSubscriptionCount: 0, createdTimestamp: 1_600_000_000_000, iconURL: () => 'https://cdn.example/g.png', bannerURL: () => null, splashURL: () => null, members: { cache: new Collection() }, channels: { cache: new Collection() }, roles: { cache: new Collection() }, emojis: { cache: new Collection() }, stickers: { cache: new Collection() }, ...over });
const member = (id, { staffRole = false, permissions = [] } = {}) => ({ id, user: fakeUser(id, id), displayName: id, displayAvatarURL: () => 'https://cdn.example/a.png', joinedTimestamp: 1, roles: { cache: new Collection(staffRole ? [['staff', { id: 'staff' }]] : []) }, permissions: { has: (flag) => permissions.includes(flag) } });
const text = (card) => card.components[0].data.content;
const buttons = (card) => (card.components[1]?.components ?? []).map((item) => item.data.custom_id);

(async () => {
  // The card.
  const open = { number: 7, user_id: 'u1', content: 'A banner\nfor my server', status: 'open', claimed_by: null, created_at: '2026-10-03T10:00:00Z', claimed_at: null, completed_at: null };
  assert.match(text(cards.requestCard(open)), /Request #7 · Open[\s\S]*<@u1> asks for:[\s\S]*> A banner\n> for my server[\s\S]*Waiting for someone/);
  assert.deepEqual(buttons(cards.requestCard(open)), ['rq:claim:7', 'rq:cancel:7']);
  const claimed = { ...open, status: 'claimed', claimed_by: 's1', claimed_at: '2026-10-03T11:00:00Z' };
  assert.deepEqual(buttons(cards.requestCard(claimed)), ['rq:done:7', 'rq:unclaim:7', 'rq:cancel:7']); assert.match(text(cards.requestCard(claimed)), /Claimed by <@s1>/);
  assert.deepEqual(buttons(cards.requestCard({ ...claimed, status: 'done', completed_at: '2026-10-03T12:00:00Z' })), [], 'a finished request has no buttons');
  assert.deepEqual(buttons(cards.requestCard({ ...open, status: 'cancelled' })), []);

  // Who may press what.
  const noRole = { staff_role_id: null }; const withRole = { staff_role_id: 'staff' };
  const mod = member('m', { permissions: [PermissionFlagsBits.ManageMessages] }); const admin = member('a', { permissions: [PermissionFlagsBits.ManageGuild] }); const plain = member('u1'); const stranger = member('x'); const staff = member('s1', { staffRole: true });
  assert.equal(cards.isStaff(mod, noRole), true, 'with no staff role, who can manage messages is staff'); assert.equal(cards.isStaff(mod, withRole), false, 'with a staff role, only it counts'); assert.equal(cards.isStaff(staff, withRole), true); assert.equal(cards.isStaff(admin, withRole), true, 'who manages the server is always staff'); assert.equal(cards.isStaff(plain, noRole), false);
  assert.equal(cards.mayPress('claim', open, staff, withRole).allowed, true); assert.match(cards.mayPress('claim', open, plain, withRole).reason, /Only the staff/); assert.match(cards.mayPress('claim', claimed, staff, withRole).reason, /already claimed/);
  assert.match(cards.mayPress('done', open, staff, withRole).reason, /claimed first/); assert.equal(cards.mayPress('done', claimed, member('s1'), withRole).allowed, true, 'who claimed it can finish it'); assert.equal(cards.mayPress('done', claimed, plain, withRole).allowed, false);
  assert.equal(cards.mayPress('unclaim', claimed, member('s1'), withRole).allowed, true); assert.equal(cards.mayPress('unclaim', claimed, staff2(), withRole).allowed, false, 'another staff member can not unclaim it'); assert.equal(cards.mayPress('unclaim', claimed, admin, withRole).allowed, true);
  assert.equal(cards.mayPress('cancel', open, plain, withRole).allowed, true, 'the author can cancel'); assert.equal(cards.mayPress('cancel', open, stranger, withRole).allowed, false); assert.equal(cards.mayPress('cancel', { ...open, status: 'done' }, plain, withRole).allowed, false);
  function staff2() { return member('s2', { staffRole: true }); }

  // Making one.
  const sentCards = [];
  const channel = { id: 'cards', isTextBased: () => true, send: async (payload) => { sentCards.push(payload); return { id: `card${sentCards.length}` }; } };
  const talk = async (command, sub, values = {}, who = plain) => {
    const out = [];
    const pick = (name) => (name in values ? values[name] : null);
    const guild = fakeGuild({ channels: { cache: new Collection(), fetch: async (id) => (id === 'cards' ? channel : null) } });
    const interaction = {
      guild, user: who.user, member: who, channel: { id: 'here' },
      options: { getSubcommand: () => sub, getString: (name) => pick(name), getBoolean: pick, getRole: pick, getChannel: pick, getInteger: pick },
      deferReply: async () => {}, editReply: async (payload) => { out.push(payload.components?.[0]?.text ?? JSON.stringify(payload)); },
    };
    await command.execute(interaction);
    return out.join('\n');
  };
  assert.match(await talk(requestCommand, 'make', { text: 'A banner' }), /not turned on/);
  assert.match(await talk(requestConfigCommand, 'enable', { enabled: true }, admin), /Choose where the cards go/);
  assert.match(await talk(requestConfigCommand, 'channel', { channel: { id: 'cards', toString: () => '#cards' } }, admin), /go to #cards/);
  assert.match(await talk(requestConfigCommand, 'staff', { role: { id: 'staff', toString: () => '@Staff' } }, admin), /@Staff claims/);
  assert.match(await talk(requestConfigCommand, 'ping', { role: { id: 'ping', toString: () => '@Ping' } }, admin), /@Ping is pinged/);
  assert.match(await talk(requestConfigCommand, 'limit', { amount: 2 }, admin), /2 open requests/);
  const made = await talk(requestCommand, 'make', { text: '  A banner for the server  ' });
  assert.match(made, /your request #1 is in[\s\S]*discord\.com\/channels\/g1\/cards\/card1/); assert.equal(rows[0].content, 'A banner for the server'); assert.equal(rows[0].message_id, 'card1');
  assert.equal(sentCards[0].content, '<@&ping>', 'the ping role is mentioned'); assert.deepEqual(sentCards[0].allowedMentions, { roles: ['ping'] }); assert.equal(sentCards[0].flags, MessageFlags.IsComponentsV2);
  await talk(requestCommand, 'make', { text: 'Another' });
  assert.match(await talk(requestCommand, 'make', { text: 'A third' }), /already have 2 open requests/); assert.equal(rows.length, 2, 'the limit stops a third');
  assert.match(await talk(requestCommand, 'list', {}), /Open requests[\s\S]*#2[\s\S]*#1/); assert.match(await talk(requestCommand, 'list', { mine: true }, stranger), /no open requests/);
  assert.match(await talk(requestConfigCommand, 'reply', { text: 'Got it #{request.number}: {request.text}' }, admin), /Reply saved/);
  rows = []; await talk(requestConfigCommand, 'limit', { amount: 5 }, admin);
  assert.match(await talk(requestCommand, 'make', { text: 'Logo' }), /Got it #1: Logo/);
  templates.set('g1:card', { data: {} }); await talk(requestConfigCommand, 'reply', { template: 'card' }, admin);
  assert.match(await talk(requestCommand, 'make', { text: 'Logo 2' }), /"embeds":\[\{"title":"card"\}\]/, 'a saved embed can be the answer');
  assert.match(await talk(requestConfigCommand, 'reply', { template: 'nope' }, admin), /no saved embed/);
  await talk(requestConfigCommand, 'reply', { text: 'reset', template: 'none' }, admin); assert.deepEqual(config.messages.created, {});
  assert.match(await talk(requestConfigCommand, 'timeout', { hours: 24 }, admin), /Premium feature/); premiumActive = true; assert.match(await talk(requestConfigCommand, 'timeout', { hours: 24 }, admin), /after 24 hours/); premiumActive = false;
  assert.match(await talk(requestConfigCommand, 'view', {}, admin), /Requests[\s\S]*Open requests per member: 5[\s\S]*24 hours/);

  // The buttons.
  rows = [{ ...open }];
  const press = async (action, who) => {
    const out = [];
    const sent = [];
    const interaction = { customId: `rq:${action}:7`, guild: fakeGuild(), user: who.user, member: who, channel: { send: async (payload) => { sent.push(payload); } }, reply: async (payload) => { out.push(payload.content); }, update: async (payload) => { out.push({ updated: payload }); } };
    await handleButton(interaction);
    return { out, sent };
  };
  config.staff_role_id = 'staff';
  rows[0].number = 7;
  assert.match((await press('claim', plain)).out[0], /Only the staff/); assert.equal(rows[0].status, 'open');
  let result = await press('claim', staff); assert.equal(rows[0].status, 'claimed'); assert.equal(rows[0].claimed_by, 's1'); assert.ok(result.out[0].updated.components.length, 'the card is updated in place'); assert.equal(result.out[0].updated.flags, MessageFlags.IsComponentsV2);
  assert.match((await press('claim', staff2())).out[0], /already claimed/);
  await press('unclaim', staff); assert.equal(rows[0].status, 'open'); await press('claim', staff);
  result = await press('done', staff); assert.equal(rows[0].status, 'done'); assert.match(result.sent[0].content, /<@u1> your request #7 is done, thanks to <@s1>/);
  assert.match((await press('cancel', plain)).out[0], /already finished/);
  rows = [{ ...open }]; await press('cancel', plain); assert.equal(rows[0].status, 'cancelled', 'the author cancels their own');
  const missing = []; await handleButton({ customId: 'rq:claim:99', guild: fakeGuild(), user: staff.user, member: staff, reply: async (payload) => { missing.push(payload.content); } }); assert.match(missing[0], /not available anymore/);

  // The time limit.
  const edited = []; const notices = [];
  const client = { channels: { fetch: async () => ({ messages: { fetch: async () => ({ edit: async (payload) => { edited.push(payload); } }) }, send: async (payload) => { notices.push(payload.content); } }) } };
  rows = [
    { ...open, number: 1, status: 'claimed', claimed_by: 's1', claimed_at: new Date(Date.now() - 30 * 3_600_000).toISOString(), channel_id: 'cards', message_id: 'm1' },
    { ...open, number: 2, status: 'claimed', claimed_by: 's1', claimed_at: new Date(Date.now() - 2 * 3_600_000).toISOString(), channel_id: 'cards', message_id: 'm2' },
  ];
  config.completion_hours = 24; premiumActive = false; assert.equal(await unclaimLate(client), 0, 'without Premium nothing goes back');
  premiumActive = true; assert.equal(await unclaimLate(client), 1);
  assert.equal(rows[0].status, 'open'); assert.equal(rows[0].claimed_by, null); assert.equal(rows[1].status, 'claimed', 'a recent one stays claimed');
  assert.equal(edited.length, 1); assert.match(notices[0], /Request #1 was claimed by <@s1> and not finished in 24 hours/);
  assert.equal(requestCommand.prefixOnly, true); assert.equal(requestConfigCommand.prefixOnly, true);
  console.log('Checked the requests: the card, who presses what, the limits, the settings and the time limit.');
})().catch((error) => { console.error(error); process.exit(1); });
