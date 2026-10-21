// Checks the live tickets of the dashboard (src/web/ticketLiveRoutes.js, src/utils/ticketLive.js) through the real web server: the
// dashboard key and a member who manages the server or has the Tickets section of Dashboard access (the old Community rules still open
// it); a member by role only sees the tickets whose channel they can see; the list and the messages have the shape the website reads;
// a reply goes out as Petto with the staff member's name on top and pings nobody; claim, add and close use the bot's ticket actions and
// what they require; a watched server gets its live signal. The database, Discord and the ticket actions are replaced.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { PermissionFlagsBits, OverwriteType } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const GUILD = '111111111111111111';
const MANAGER = '333333333333333333';
const HELPER = '444444444444444444'; // a role with the Tickets section (edit) and the support role of "Support"
const VIEWER = '455555555555555555'; // a role with the old Community section (view only), not support
const OUTSIDER = '466666666666666666'; // a role with Tickets (edit), not support: sees nothing private
const OPENER = '500000000000000001';
const OPENER2 = '500000000000000002';
const NEWBIE = '500000000000000009';
const BOT = '999999999999999999';
const SUPPORT_ROLE = '700000000000000001';
const CH1 = '800000000000000001';
const CH2 = '800000000000000002';

stub('src/utils/logger.js', { info() {}, warn() {}, error() {}, debug() {} });
const accessRows = [
  { guild_id: GUILD, role_id: 'r-helper', sections: ['tickets'], can_edit: true },
  { guild_id: GUILD, role_id: 'r-viewer', sections: ['community'], can_edit: false },
  { guild_id: GUILD, role_id: 'r-outsider', sections: ['tickets'], can_edit: true },
];
stub('src/db/database.js', {
  from(table) {
    const query = { select() { return query; }, eq(column, value) { query[column] = value; return query; }, then(resolve) { resolve({ data: table === 'dash_access' ? accessRows.filter((r) => r.guild_id === query.guild_id) : [], error: null }); } };
    return query;
  },
});
const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const tickets = [
  { id: 11, guild_id: GUILD, ticket_number: 7, category_id: 1, channel_id: CH1, opener_id: OPENER, claimed_by: null, status: 'open', priority: 'normal', created_at: iso(90), closed_at: null, staff_message_count: 0 },
  { id: 12, guild_id: GUILD, ticket_number: 8, category_id: 2, channel_id: CH2, opener_id: OPENER2, claimed_by: HELPER, status: 'open', priority: 'high', created_at: iso(30), closed_at: null, staff_message_count: 2 },
];
const categories = [{ id: 1, label: 'Support', emoji: '🎫', support_role_ids: [SUPPORT_ROLE] }, { id: 2, label: 'Purchases', emoji: '🛒', support_role_ids: [] }];
const settings = { claim_mode: 'shared', close_requires_reason: false, autoclose_inactivity_enabled: true, log_staff_message_counts: true };
stub('src/db/ticketLive.js', {
  MAX_OPEN: 100,
  listOpenTickets: async () => tickets.filter((t) => t.status === 'open').map((t) => ({ ...t })),
  getTicket: async (guildId, number) => { const t = tickets.find((x) => x.ticket_number === number); return t ? { ...t } : null; },
  listCategories: async () => categories,
});
stub('src/db/ticketSettings.js', { getSettings: async () => ({ ...settings }) });
const touched = [];
stub('src/db/tickets.js', { getTicketById: async () => null, getTicketByNumber: async () => null, touchActivity: async (id, options) => { touched.push({ id, ...options }); } });
const done = [];
let closeDelay = 0;
stub('src/utils/ticketActions.js', {
  isStaffForCategory: (member, category) => member.permissions.has(PermissionFlagsBits.ManageGuild) || (category.support_role_ids ?? []).some((id) => member.roles.cache.has(id)),
  isStaffAllowedForTicket(member, category, ticket, s) {
    if (!this.isStaffForCategory(member, category)) return false;
    if (s?.claim_mode !== 'exclusive' || !ticket?.claimed_by) return true;
    return ticket.claimed_by === member.id || member.permissions.has(PermissionFlagsBits.ManageGuild);
  },
  claimTicket: async ({ ticket, actor }) => { done.push(['claim', ticket.ticket_number, actor.id]); tickets.find((t) => t.id === ticket.id).claimed_by = actor.id; },
  unclaimTicket: async ({ ticket }) => { done.push(['unclaim', ticket.ticket_number]); tickets.find((t) => t.id === ticket.id).claimed_by = null; },
  addMember: async ({ ticket, targetUser }) => { done.push(['add', ticket.ticket_number, targetUser.id]); },
  removeMember: async ({ ticket, targetUser }) => { done.push(['remove', ticket.ticket_number, targetUser.id]); },
  closeTicket: async ({ ticket, reason, actor }) => {
    if (closeDelay) await new Promise((resolve) => setTimeout(resolve, closeDelay));
    done.push(['close', ticket.ticket_number, reason, actor.id]);
    tickets.find((t) => t.id === ticket.id).status = 'closed';
  },
});
const sent = [];
let messageSeq = 900000000000000100n;
stub('src/utils/senderIdentity.js', {
  sendAs: async (channel, feature, payload) => {
    sent.push({ channel: channel.id, feature, payload });
    messageSeq += 1n;
    const message = fakeMessage({ id: String(messageSeq), author: users.get(BOT), content: payload.content });
    channel.lastMessageId = message.id;
    return message;
  },
});

// ── a fake Discord
const user = (id, username, extra = {}) => ({ id, username, globalName: null, bot: false, displayAvatarURL: () => `https://cdn.example/${id}.png`, ...extra });
const users = new Map([
  [MANAGER, user(MANAGER, 'mod')], [HELPER, user(HELPER, 'helper')], [VIEWER, user(VIEWER, 'viewer')], [OUTSIDER, user(OUTSIDER, 'outsider')],
  [OPENER, user(OPENER, 'sunny', { globalName: 'Sunny' })], [OPENER2, user(OPENER2, 'pixel')], [NEWBIE, user(NEWBIE, 'newbie')], [BOT, user(BOT, 'Petto', { bot: true })],
]);
const perms = (...flags) => ({ has: (flag) => flags.includes(flag) || (flags.includes(PermissionFlagsBits.Administrator)) });
const member = (id, roles, flags = [], displayName = null) => ({ id, user: users.get(id), displayName: displayName ?? users.get(id).globalName ?? users.get(id).username, roles: { cache: new Map([[GUILD, {}], ...roles.map((r) => [r, {}])]) }, permissions: perms(...flags), displayAvatarURL: () => `https://cdn.example/m/${id}.png` });
const members = new Map([
  [MANAGER, member(MANAGER, [], [PermissionFlagsBits.ManageGuild], '**Mod** <@1>')],
  [HELPER, member(HELPER, ['r-helper', SUPPORT_ROLE])],
  [VIEWER, member(VIEWER, ['r-viewer'])],
  [OUTSIDER, member(OUTSIDER, ['r-outsider'])],
  [OPENER, member(OPENER, [])], [OPENER2, member(OPENER2, [])], [NEWBIE, member(NEWBIE, [])],
  [BOT, member(BOT, [], [PermissionFlagsBits.Administrator])],
]);
let discordFetches = 0;
function fakeMessage({ id, author, content = '', attachments = [], embeds = [], components = [], at = Date.now() }) {
  return {
    id, author, content, cleanContent: content, member: members.get(author.id) ?? null, createdTimestamp: at, editedTimestamp: null, webhookId: null,
    attachments: new Map(attachments.map((a, i) => [String(i), a])), embeds, components, stickers: new Map(),
  };
}
function fakeChannel(id, name, opener, history, canSee) {
  const store = new Map(history.map((m) => [m.id, m]));
  const channel = {
    id, name, createdTimestamp: Date.now() - 3_600_000, lastMessageId: history.at(-1)?.id ?? null,
    guild: null,
    messages: {
      cache: new Map(),
      fetch: async ({ limit }) => { discordFetches += 1; const list = [...store.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp).slice(0, limit); return { values: () => list.values(), first: () => list[0] }; },
      push(message) { store.set(message.id, message); channel.lastMessageId = message.id; },
    },
    permissionsFor: (m) => ({ has: (flag) => (flag === PermissionFlagsBits.ViewChannel ? canSee(m) : true) }),
    permissionOverwrites: { cache: new Map([
      [GUILD, { id: GUILD, type: OverwriteType.Role, allow: { has: () => false } }],
      [opener, { id: opener, type: OverwriteType.Member, allow: { has: () => true } }],
      [BOT, { id: BOT, type: OverwriteType.Member, allow: { has: () => true } }],
      [NEWBIE, { id: NEWBIE, type: OverwriteType.Member, allow: { has: (flag) => flag === PermissionFlagsBits.ViewChannel } }],
    ]) },
  };
  return channel;
}
const t0 = Date.now() - 20 * 60_000;
const ch1 = fakeChannel(CH1, 'ticket-0007', OPENER, [
  fakeMessage({ id: '900000000000000001', author: users.get(BOT), components: [{ type: 17, components: [{ type: 10, content: 'Welcome Sunny! Tell us what you need.' }, { type: 1, components: [{ type: 2, label: 'Close' }] }] }], at: t0 }),
  fakeMessage({ id: '900000000000000002', author: users.get(OPENER), content: 'My order never arrived', attachments: [{ name: 'receipt.png', url: 'https://cdn.discordapp.com/attachments/1/2/receipt.png', size: 2048, contentType: 'image/png' }], at: t0 + 60_000 }),
  fakeMessage({ id: '900000000000000003', author: users.get(OPENER), content: 'hello?', embeds: [{ toJSON: () => ({ title: 'Order #42', description: 'x'.repeat(500), color: 0xff0000 }) }], at: t0 + 120_000 }),
], (m) => m.id !== OUTSIDER && m.id !== VIEWER ? true : false);
const ch2 = fakeChannel(CH2, 'ticket-0008', OPENER2, [
  fakeMessage({ id: '900000000000000010', author: users.get(OPENER2), content: 'refund please', at: t0 }),
  fakeMessage({ id: '900000000000000011', author: users.get(HELPER), content: 'On it', at: t0 + 30_000 }),
], (m) => m.id === MANAGER || m.id === VIEWER);
const channels = new Map([[CH1, ch1], [CH2, ch2]]);
const guild = {
  id: GUILD, name: 'Petto Land', iconURL: () => null,
  members: { cache: members, me: members.get(BOT), fetch: async (id) => { const m = members.get(String(id)); if (!m) throw Object.assign(new Error('Unknown Member'), { code: 10007 }); return m; } },
  channels: { cache: channels },
};
ch1.guild = guild; ch2.guild = guild;
const client = {
  guilds: { cache: new Map([[GUILD, guild]]), fetch: async (id) => (id === GUILD ? guild : Promise.reject(new Error('Unknown Guild'))) },
  users: { cache: users, fetch: async (id) => users.get(id) ?? Promise.reject(new Error('Unknown User')) },
};
guild.client = client;

require('../src/db/guilds').ensureGuild = async () => ({});
const config = require('../src/config');
Object.assign(config, { verifyBaseUrl: '', verifyTokenSecret: '', dashboardApiSecret: 'dash-key', topggWebhookSecret: '', webPort: 0 });
const live = require('../src/utils/ticketLive');
const { startServer } = require('../src/web/server');
const { plainName, targetId } = require('../src/web/ticketLiveRoutes');

function call(port, route, { body = {}, headers = {}, userId = MANAGER, grant = null } = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ ...body, user_id: userId });
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: `/api/dashboard/guild/${GUILD}/tickets/live/${route}`, headers: { 'content-type': 'application/json', 'x-petto-dashboard-key': 'dash-key', ...(grant ? { 'x-petto-dashboard-grant': grant } : {}), ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, ...json }); });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  // Small helpers.
  assert.equal(plainName('**Mod** <@1>\nhi'), 'Mod 1 hi', 'no Markdown, mention or line break in the name on top of a reply');
  assert.equal(targetId('<@!500000000000000009>'), NEWBIE);
  assert.equal(targetId('500000000000000009'), NEWBIE);
  assert.equal(targetId('@newbie'), null);
  const card = live.summarizeMessage(ch1.messages.cache.get('x') ?? fakeMessage({ id: '1', author: users.get(BOT), components: [{ toJSON: () => ({ type: 17, components: [{ type: 9, components: [{ type: 10, content: 'In a section' }], accessory: { type: 11 } }] }) }] }));
  assert.equal(card.card, 'In a section', 'the text of a Components V2 card, also inside sections');

  const app = startServer(client);
  const server = http.createServer(app).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const signals = [];
  live.onSignal((id) => signals.push(id));

  // Access.
  let r = await call(port, 'list', { headers: { 'x-petto-dashboard-key': 'wrong' } });
  assert.equal(r.status, 401, 'the dashboard key is required');
  r = await call(port, 'list', { userId: OPENER });
  assert.deepEqual([r.status, r.error], [403, 'no_access'], 'a member without Manage Server or a rule gets nothing');
  r = await call(port, 'list', { userId: HELPER });
  assert.equal(r.status, 403, 'a rule is not enough without the website vouching for the page');
  r = await call(port, 'list', { userId: HELPER, grant: 'forms:view' });
  assert.equal(r.status, 403, 'the grant of another page opens nothing');

  // The list, for a manager: everything, with the shape the website reads.
  r = await call(port, 'list');
  assert.equal(r.ok, true);
  assert.equal(r.total, 2);
  assert.deepEqual(r.tickets.map((x) => x.number), [7, 8], 'newest first, as the database gave them');
  const [first, second] = r.tickets;
  assert.deepEqual(first.category, { label: 'Support', emoji: '🎫' });
  assert.deepEqual(first.opener, { id: OPENER, name: 'Sunny', username: 'sunny', avatar: `https://cdn.example/m/${OPENER}.png`, bot: false });
  assert.equal(first.claimedBy, null);
  assert.equal(first.channelName, 'ticket-0007');
  assert.equal(first.waiting, true, 'the opener wrote last: waiting for the staff');
  assert.equal(first.lastAuthor.id, OPENER);
  assert.ok(Date.parse(first.lastMessageAt) > Date.parse(first.openedAt), 'the time of the last message');
  assert.equal(second.waiting, false, 'the staff wrote last');
  assert.equal(second.claimedBy.id, HELPER);
  assert.equal(second.priority, 'high');
  assert.equal(r.viewer.manager, true);
  assert.equal(live.isWatched(GUILD), true, 'reading the list watches the server');

  // By role: the old Community rule opens the view (view only), and a member sees only the tickets whose channel they can see.
  r = await call(port, 'list', { userId: VIEWER, grant: 'tickets:view' });
  assert.deepEqual([r.ok, r.tickets.map((x) => x.number), r.viewer.manager], [true, [8], false], 'only the channel the viewer can see');
  r = await call(port, 'messages', { userId: VIEWER, grant: 'tickets:view', body: { ticket: 7 } });
  assert.deepEqual([r.status, r.code], [403, 'no_access'], 'a ticket they cannot see in Discord is not shown');
  r = await call(port, 'list', { userId: OUTSIDER, grant: 'tickets:edit' });
  assert.deepEqual(r.tickets, [], 'a role with the section but no ticket channel sees none');

  // The messages of a ticket.
  const fetchesBefore = discordFetches;
  r = await call(port, 'messages', { body: { ticket: 7 } });
  assert.equal(r.ok, true);
  assert.equal(r.messages.length, 3);
  assert.deepEqual(r.messages.map((m) => m.id), ['900000000000000001', '900000000000000002', '900000000000000003'], 'oldest first');
  assert.equal(r.messages[0].card, 'Welcome Sunny! Tell us what you need.', 'a card of Petto in short (buttons left out)');
  assert.equal(r.messages[0].author.bot, true);
  assert.deepEqual(r.messages[1].attachments, [{ name: 'receipt.png', url: 'https://cdn.discordapp.com/attachments/1/2/receipt.png', size: 2048, image: true }], 'attachments as links');
  assert.equal(r.messages[1].author.avatar, `https://cdn.example/m/${OPENER}.png`);
  assert.equal(r.messages[2].embeds[0].title, 'Order #42');
  assert.ok(r.messages[2].embeds[0].description.length <= 300, 'embeds in short');
  assert.deepEqual(r.ticket.members.map((m) => m.id), [NEWBIE], 'the members added to the ticket');
  assert.equal(r.ticket.canAct, true);
  assert.equal(discordFetches, fetchesBefore + 1, 'one fetch of the last messages');
  r = await call(port, 'messages', { body: { ticket: 7 } });
  assert.equal(discordFetches, fetchesBefore + 1, 'nothing new: the copy is used, Discord is not asked again');
  ch1.messages.push(fakeMessage({ id: '900000000000000004', author: users.get(OPENER), content: 'anyone?' }));
  r = await call(port, 'messages', { body: { ticket: 7 } });
  assert.deepEqual([discordFetches, r.messages.at(-1).content], [fetchesBefore + 2, 'anyone?'], 'a new message is read at once');
  r = await call(port, 'messages', { body: { ticket: 999 } });
  assert.deepEqual([r.status, r.code], [404, 'not_found']);
  r = await call(port, 'messages', { body: { ticket: 'x' } });
  assert.equal(r.status, 404);

  // A reply: as Petto, the name of who wrote it on top, nobody pinged.
  r = await call(port, 'reply', { body: { ticket: 7, content: '   ' } });
  assert.deepEqual([r.status, r.code], [400, 'empty']);
  r = await call(port, 'reply', { body: { ticket: 7, content: 'x'.repeat(1801) } });
  assert.deepEqual([r.status, r.code], [400, 'too_long']);
  r = await call(port, 'reply', { userId: VIEWER, grant: 'tickets:view', body: { ticket: 8, content: 'hi' } });
  assert.equal(r.status, 403, 'a view rule cannot reply');
  r = await call(port, 'reply', { userId: OUTSIDER, grant: 'tickets:edit', body: { ticket: 7, content: 'hi' } });
  assert.deepEqual([r.status, r.code], [403, 'not_staff'], 'the section is not enough: the ticket staff only');
  signals.length = 0;
  r = await call(port, 'reply', { body: { ticket: 7, content: 'Hi @everyone <@500000000000000001>, we are checking it' } });
  assert.equal(r.ok, true);
  const last = sent.at(-1);
  assert.equal(last.feature, 'tickets', 'with the look of the ticket messages');
  assert.deepEqual(last.payload.allowedMentions, { parse: [] }, 'no one is pinged');
  assert.equal(last.payload.content, '-# Mod 1 · from the dashboard\nHi @everyone <@500000000000000001>, we are checking it');
  assert.equal(r.sent.author.bot, true);
  assert.deepEqual(touched.at(-1), { id: 11, staffMessage: true }, 'counts as a staff message');
  await new Promise((resolve) => setTimeout(resolve, 1_700));
  assert.ok(signals.includes(GUILD), 'the watched server gets its signal');
  r = await call(port, 'list');
  assert.equal(r.tickets[0].waiting, false, 'after a reply from the dashboard the opener no longer waits');
  assert.equal(r.tickets[0].lastAuthor.staffReply, true);
  r = await call(port, 'reply', { body: { ticket: 7, content: 'hola' }, headers: { 'x-petto-language': 'es' } });
  assert.equal(r.message, 'Enviado.', 'the answer in the language of the dashboard');
  assert.ok(sent.at(-1).payload.content.startsWith('-# Mod 1 · from the dashboard'), 'the line on top in the language of the server');
  for (let i = 0; i < 4; i += 1) r = await call(port, 'reply', { body: { ticket: 7, content: `again ${i}` } });
  assert.deepEqual([r.status, r.code], [429, 'slow_down'], 'five replies in ten seconds at most');

  // Claim, add, remove.
  r = await call(port, 'claim', { userId: HELPER, grant: 'tickets:edit', body: { ticket: 7 } });
  assert.equal(r.ok, true);
  assert.deepEqual(done.at(-1), ['claim', 7, HELPER]);
  r = await call(port, 'claim', { body: { ticket: 7 } });
  assert.deepEqual([r.status, r.code], [409, 'already_claimed']);
  settings.claim_mode = 'exclusive';
  r = await call(port, 'unclaim', { userId: OUTSIDER, grant: 'tickets:edit', body: { ticket: 7 } });
  assert.equal(r.status, 403);
  r = await call(port, 'unclaim', { body: { ticket: 7 } });
  assert.equal(r.ok, true, 'a manager can act on a ticket someone else claimed');
  settings.claim_mode = 'shared';
  r = await call(port, 'add', { body: { ticket: 7, target: 'newbie' } });
  assert.deepEqual([r.status, r.code], [400, 'bad_target']);
  r = await call(port, 'add', { body: { ticket: 7, target: '512345678901234567' } });
  assert.deepEqual([r.status, r.code], [404, 'not_member']);
  r = await call(port, 'remove', { body: { ticket: 7, target: `<@${OPENER}>` } });
  assert.deepEqual([r.status, r.code], [400, 'is_opener']);
  r = await call(port, 'add', { body: { ticket: 7, target: `<@${NEWBIE}>` } });
  assert.equal(r.ok, true);
  assert.deepEqual(done.at(-1), ['add', 7, NEWBIE]);
  r = await call(port, 'remove', { body: { ticket: 7, target: NEWBIE } });
  assert.deepEqual(done.at(-1), ['remove', 7, NEWBIE]);
  r = await call(port, 'dance', { body: { ticket: 7 } });
  assert.equal(r.status, 404);

  // Close.
  settings.close_requires_reason = true;
  r = await call(port, 'close', { body: { ticket: 7 } });
  assert.deepEqual([r.status, r.code], [400, 'reason_required']);
  settings.close_requires_reason = false;
  closeDelay = 1_500;
  r = await call(port, 'close', { body: { ticket: 7, reason: 'Solved' } });
  assert.deepEqual([r.ok, r.pending], [true, true], 'a long close answers at once and goes on');
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.deepEqual(done.at(-1), ['close', 7, 'Solved', MANAGER], 'closed with the bot\'s own action, the reason and who did it');
  r = await call(port, 'reply', { body: { ticket: 7, content: 'late' } });
  assert.deepEqual([r.status, r.code], [409, 'not_open'], 'nothing can be done in a closed ticket');
  closeDelay = 0;
  r = await call(port, 'close', { body: { ticket: 8, reason: '' } });
  assert.deepEqual([r.ok, r.pending], [true, false]);
  r = await call(port, 'list');
  assert.deepEqual(r.tickets, [], 'closed tickets leave the list');

  // The signal of a watched server only.
  live.reset();
  const heard = [];
  live.onSignal((id) => heard.push(id));
  assert.equal(live.noteMessage({ id: '1', guild: { id: GUILD }, channelId: CH1, author: { id: OPENER } }), false, 'a server nobody watches costs nothing');
  live.watch(GUILD, [{ id: 21, channel_id: CH1, opener_id: OPENER }]);
  assert.equal(live.noteMessage({ id: '2', guild: { id: GUILD }, channelId: CH1, author: { id: OPENER }, createdTimestamp: Date.now() }), true);
  assert.equal(live.lastActivity(CH1).authorId, OPENER);
  assert.equal(live.noteMessage({ id: '3', guild: { id: GUILD }, channelId: '1', channel: { createdTimestamp: Date.now() - 600_000 }, author: { id: OPENER } }), false, 'an old channel that is not a ticket is ignored');
  assert.equal(live.noteMessage({ id: '4', guild: { id: GUILD }, channelId: '2', channel: { createdTimestamp: Date.now() - 2_000 }, author: { id: BOT } }), true, 'a channel made a moment ago may be a new ticket');
  assert.equal(live.noteTicketWrite({ filters: [{ type: 'eq', column: 'id', value: 21 }] }), true, 'a write that names a ticket of a watched server');
  assert.equal(live.noteTicketWrite({ filters: [{ type: 'eq', column: 'id', value: 99 }] }), false);
  await new Promise((resolve) => setTimeout(resolve, 1_700));
  assert.deepEqual(heard, [GUILD, GUILD], 'several in a row become one signal per gap');
  live.reset();

  server.close();
  console.log('Checked the live tickets: access, the list and the messages, replies without pings, claim, members and close.');
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
