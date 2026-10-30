// Tickets with no server: the transcript shows Petto with its look in that server (and a webhook message with the look it was sent
// with), a deleted channel closes its open ticket, the check on start closes only on "Unknown Channel" (10003), and a rating is saved
// once, with the buttons of the message replaced so they cannot be pressed again.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { renderTranscriptHtml, resolveBotIdentity } = require('../src/utils/ticketTranscript');
const gone = require('../src/utils/ticketChannelGone');
const cards = require('../src/utils/ticketCards');
const controls = require('../src/interactions/ticketControls');
const actions = require('../src/utils/ticketActions');
const { t } = require('../src/i18n');
const { EMOJI } = require('../src/utils/emojis');

const GUILD_AVATAR = 'https://cdn.discordapp.com/guilds/10/users/99/avatars/a1b2c3.png?size=128';
const GLOBAL_AVATAR = 'https://cdn.discordapp.com/avatars/99/global.png?size=128';
const WEBHOOK_AVATAR = 'https://cdn.discordapp.com/avatars/555/hook.png?size=128';

function user(id, username, avatarUrl, extra = {}) {
  return { id, username, globalName: null, bot: false, avatar: 'x', displayAvatarURL: () => avatarUrl, ...extra };
}

async function checkTranscript() {
  const botUser = user('99', 'Petto', GLOBAL_AVATAR, { bot: true, globalName: 'Petto' });
  const me = { id: '99', user: botUser, nickname: 'Soporte Luna', avatar: 'a1b2c3', banner: null, displayAvatarURL: () => GUILD_AVATAR, bannerURL: () => null };
  const opener = user('5', 'liam', 'https://cdn.discordapp.com/avatars/5/l.png');
  const members = new Map([['5', { id: '5', displayName: 'Liam', avatar: null, displayHexColor: '#a5ea7a', user: opener, displayAvatarURL: () => opener.displayAvatarURL() }]]);
  const guild = { id: '10', name: 'Luna', members: { me, cache: members }, roles: { cache: new Map() }, channels: { cache: new Map() }, iconURL: () => null, bannerURL: () => null, client: { user: botUser } };

  const bot = resolveBotIdentity(guild);
  assert.equal(bot.name, 'Soporte Luna', 'the nickname of Petto in the server');
  assert.equal(bot.avatarUrl, GUILD_AVATAR, 'the avatar of Petto in the server, not the global one');
  assert.equal(resolveBotIdentity({ members: { me: { ...me, nickname: null, avatar: null } }, client: { user: botUser } }).avatarUrl, GLOBAL_AVATAR, 'no server look: the global one');

  const at = Date.parse('2026-10-20T15:00:00Z');
  const msg = (id, author, content, extra = {}) => ({ id, author, member: members.get(author.id) ?? null, content, createdTimestamp: at + Number(id) * 60_000, guild, attachments: new Map(), embeds: [], ...extra });
  const messages = [
    msg('1', botUser, 'Welcome to your ticket!', { member: me }),
    msg('2', opener, 'Hi, my rank is wrong'),
    msg('3', user('555', 'Petto Tickets', WEBHOOK_AVATAR, { bot: true }), 'Sent with its own look', { webhookId: '555' }),
  ];
  const { html, messageCount } = renderTranscriptHtml({ messages, guild, channelName: 'ticket-0003', lang: 'en', bot, info: { number: 3, opener: { name: 'Liam' }, openedAt: at, closedAt: at + 3_600_000, closedBy: { name: 'Mod' }, reason: 'Solved' } });
  assert.equal(messageCount, 3);
  const first = html.slice(html.indexOf('id="message-1"'), html.indexOf('id="message-2"'));
  assert.ok(first.includes(GUILD_AVATAR) && first.includes('Soporte Luna'), 'Petto\'s message uses its look in the server');
  assert.ok(!html.includes(GLOBAL_AVATAR), 'the global avatar of Petto is not used');
  const hook = html.slice(html.indexOf('id="message-3"'));
  assert.ok(hook.includes(WEBHOOK_AVATAR) && hook.includes('Petto Tickets'), 'a webhook message keeps the look it was sent with');
  assert.ok(html.includes('style="color:#a5ea7a"'), 'a member\'s name has its role color');
  assert.ok(html.includes('Ticket #3') && html.includes('Solved') && html.includes('1 hour'), 'the header has the number, reason and how long it was open');
  assert.ok(html.includes('prefers-color-scheme: light'), 'a light theme too');
  assert.ok(!html.includes('<script>alert'), 'sanity');
  const evil = renderTranscriptHtml({ messages: [msg('1', user('7', '<img onerror=x>', 'javascript:alert(1)'), '<script>alert(1)</script>')], guild: { ...guild, members: { cache: new Map() } }, lang: 'en', bot, info: { number: 1 } }).html;
  assert.ok(!evil.includes('<script>alert(1)') && !evil.includes('javascript:alert') && !evil.includes('<img onerror'), 'names, links and text are escaped');
}

function fakeDeps({ ticket, executorId = null } = {}) {
  const calls = { closed: [], logs: [], channelCleared: [] };
  const db = {
    getTicketByChannel: async (id) => (ticket && ticket.channel_id === id ? ticket : null),
    setTicketChannel: async (id) => { calls.channelCleared.push(id); },
    closeOpenTicket: async (id, patch) => {
      const row = ticket && ticket.id === id && ticket.status === 'open' ? ticket : null;
      if (!row) return null;
      row.status = 'closed';
      calls.closed.push({ id, ...patch });
      return { ...row, ...patch };
    },
    listAllOpenTickets: async () => [],
  };
  const deps = {
    db,
    settingsDb: { getSettings: async () => ({ hide_closing_user: false, closed_log_channel_id: null }) },
    t: (lang, key, vars) => t(lang, key, vars),
    guildLanguage: async () => 'en',
    sendLog: async (client, guildId, event, embed) => { calls.logs.push({ guildId, event, embed }); },
    fetchEntry: async () => (executorId ? { executor: { id: executorId } } : null),
    textCard: (text) => ({ text }),
    EMOJI: { DENY: 'x' },
  };
  return { deps, calls, db };
}

async function checkChannelDelete() {
  const ticket = { id: 3, guild_id: '10', ticket_number: 3, channel_id: '300', opener_id: '5', status: 'open' };
  const { deps, calls } = fakeDeps({ ticket, executorId: '42' });
  const guild = { id: '10', channels: { fetch: async () => null, cache: new Map() } };
  const closed = await gone.handleTicketChannelDelete({ id: '300', guild, client: {} }, deps);
  assert.ok(closed, 'the open ticket of a deleted channel is closed');
  assert.equal(calls.closed[0].closedBy, '42', 'closed by whoever deleted the channel (audit log)');
  assert.equal(calls.closed[0].clearChannel, true, 'the channel id is forgotten');
  assert.match(calls.closed[0].reason, /channel was deleted/);
  assert.equal(calls.logs.length, 1);
  assert.ok(calls.logs[0].embed.description.includes('<@42>'));
  assert.equal(await gone.handleTicketChannelDelete({ id: '300', guild, client: {} }, deps), null, 'a second event does nothing');

  const closedTicket = { id: 4, guild_id: '10', ticket_number: 4, channel_id: '400', opener_id: '5', status: 'closed' };
  const second = fakeDeps({ ticket: closedTicket });
  assert.equal(await gone.handleTicketChannelDelete({ id: '400', guild, client: {} }, second.deps), null);
  assert.deepEqual(second.calls.channelCleared, [4], 'a closed ticket only forgets its channel');
  assert.equal(second.calls.logs.length, 0);

  const unrelated = fakeDeps({ ticket });
  assert.equal(await gone.handleTicketChannelDelete({ id: '999', guild, client: {} }, unrelated.deps), null, 'any other channel: nothing');
}

async function checkReconcile() {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const rows = [
    { id: 1, guild_id: '10', ticket_number: 1, channel_id: 'gone', status: 'open', created_at: '2026-10-01T00:00:00Z' },
    { id: 2, guild_id: '10', ticket_number: 2, channel_id: 'cached', status: 'open', created_at: '2026-10-01T00:00:00Z' },
    { id: 3, guild_id: '10', ticket_number: 3, channel_id: 'noaccess', status: 'open', created_at: '2026-10-01T00:00:00Z' },
    { id: 4, guild_id: '10', ticket_number: 4, channel_id: 'timeout', status: 'open', created_at: '2026-10-01T00:00:00Z' },
    { id: 5, guild_id: '20', ticket_number: 5, channel_id: 'gone', status: 'open', created_at: '2026-10-01T00:00:00Z' },
    { id: 6, guild_id: '30', ticket_number: 6, channel_id: 'gone', status: 'open', created_at: '2026-10-01T00:00:00Z' },
    { id: 7, guild_id: '10', ticket_number: 7, channel_id: null, status: 'open', created_at: '2026-10-21T11:55:00Z' },
    { id: 8, guild_id: '10', ticket_number: 8, channel_id: null, status: 'open', created_at: '2026-10-20T00:00:00Z' },
  ];
  const closedIds = [];
  const deps = fakeDeps().deps;
  deps.db = {
    listAllOpenTickets: async () => rows.map((row) => ({ ...row })),
    closeOpenTicket: async (id, patch) => { closedIds.push(id); return { id, ...patch }; },
  };
  const error = (code, message) => Object.assign(new Error(message), { code });
  const fetches = [];
  const channels = {
    cache: new Map([['cached', {}]]),
    fetch: async (id, options) => {
      fetches.push({ id, options });
      if (id === 'gone') throw error(10003, 'Unknown Channel');
      if (id === 'noaccess') throw error(50001, 'Missing Access');
      throw error('ETIMEDOUT', 'timeout');
    },
  };
  const client = { guilds: { cache: new Map([
    ['10', { id: '10', available: true, channels }],
    ['20', { id: '20', available: false, channels }],
  ]) } };
  const count = await gone.reconcileTicketChannels(client, deps, { now });
  assert.deepEqual(closedIds, [1, 8], 'only the 10003 channel and the old ticket that never got a channel');
  assert.equal(count, 2);
  assert.ok(!fetches.some((call) => call.id === 'cached'), 'a channel in the cache is not asked for');
  assert.ok(fetches.every((call) => call.options?.force), 'Discord is asked, not the cache');
  assert.equal(gone.isUnknownChannel({ code: 10003 }), true);
  assert.equal(gone.isUnknownChannel({ code: 50001 }), false);
}

async function checkRating() {
  // The buttons of a V2 message become the "thanks" card; an older message keeps disabled buttons.
  const card = cards.buildTicketClosedCard({ ticket: { ticket_number: 3 }, guild: { name: 'Luna', iconURL: () => null }, actor: { toString: () => '<@6>', displayAvatarURL: () => null }, reason: 'ok', channel: null, rating: true, lang: 'en' });
  const link = cards.buildTranscriptLinkRow('https://petto.sbs/t/1', 'en');
  const before = [card.toJSON(), cards.buildRatingRow(3).toJSON(), link.toJSON()];
  const after = cards.componentsAfterRating(before, 4, { v2: true, lang: 'en' });
  assert.equal(after.length, 3);
  assert.equal(after[1].type, 17, 'the row of stars is now a card');
  const fourStars = `${EMOJI.STAR_FULL.repeat(4)}${EMOJI.STAR_EMPTY_RATE}`;
  assert.ok(JSON.stringify(after[1]).includes(fourStars), 'the thanks card shows the stars of Petto, four full and one empty');
  assert.equal(cards.starsText(4, { plain: true }), '★★★★☆', 'the plain text stars stay for where an emoji cannot show');
  assert.ok(!JSON.stringify(after).includes('tk_rate::'), 'no rating button is left');
  assert.deepEqual(after[2], before[2], 'the transcript button stays');
  const legacy = cards.componentsAfterRating([cards.buildRatingRow(3).toJSON()], 2, { v2: false });
  assert.ok(legacy[0].components.every((button) => button.disabled), 'old messages: the buttons are disabled');

  // rateTicket: saved once; the second time nothing is logged again.
  const store = new Map();
  const ratingsDb = { addRating: async (guildId, ticketId, userId, rating) => {
    if (store.has(ticketId)) return { created: false, rating: store.get(ticketId) };
    const row = { ticket_id: ticketId, rating };
    store.set(ticketId, row);
    return { created: true, rating: row };
  } };
  let logged = 0;
  const settingsDb = { getSettings: async () => { logged += 1; return { rating_log_channel_id: null }; } };
  const guild = { id: '10', channels: { fetch: async () => null } };
  const ticket = { id: 3, ticket_number: 3, guild_id: '10', opener_id: '5' };
  assert.equal((await actions.rateTicket({ guild, ticket, user: { id: '5' }, rating: 4 }, { ratingsDb, settingsDb })).created, true);
  assert.equal((await actions.rateTicket({ guild, ticket, user: { id: '5' }, rating: 1 }, { ratingsDb, settingsDb })).created, false);
  assert.equal(store.get(3).rating, 4, 'the first rating stays');
  assert.equal(logged, 1, 'logged once');

  // The button: the message is updated in place, and a second click says it was rated already.
  function interaction(customId, components) {
    const said = { updates: [], followUps: [], replies: [] };
    return {
      said,
      customId,
      user: { id: '5' },
      client: { guilds: { fetch: async () => guild } },
      message: { components, flags: { has: (flag) => flag === MessageFlags.IsComponentsV2 } },
      update: async (payload) => { said.updates.push(payload); },
      followUp: async (payload) => { said.followUps.push(payload); },
      reply: async (payload) => { said.replies.push(payload); },
      showModal: async () => { throw new Error('no modal in this mode'); },
    };
  }
  const deps = {
    db: { getTicketById: async () => ticket },
    ratingsDb: { getRating: async () => store.get(3) ?? null },
    settingsDb: { getSettings: async () => ({ rating_mode: 'rating' }) },
    rateTicket: (args) => actions.rateTicket(args, { ratingsDb, settingsDb }),
    guildLanguage: async () => 'en',
    languageOf: async () => 'en',
  };
  store.clear();
  const firstClick = interaction('tk_rate::3::5', before);
  await controls.handleRatingButton(firstClick, deps);
  assert.equal(firstClick.said.updates.length, 1, 'the message is updated');
  assert.ok(!JSON.stringify(firstClick.said.updates[0]).includes('tk_rate::'));
  assert.ok(firstClick.said.followUps[0].content.includes(EMOJI.STAR_FULL.repeat(5)));
  assert.equal(firstClick.said.followUps[0].flags, MessageFlags.Ephemeral);
  const secondClick = interaction('tk_rate::3::1', before);
  await controls.handleRatingButton(secondClick, deps);
  assert.equal(store.get(3).rating, 5, 'a second click changes nothing');
  assert.match(secondClick.said.followUps[0].content, /already rated/);
  const stranger = interaction('tk_rate::3::5', before);
  stranger.user = { id: '6' };
  await controls.handleRatingButton(stranger, deps);
  assert.equal(stranger.said.updates.length, 0, 'only the opener can rate');
}

/** The id of a custom emoji written as <:name:id>. */
const idOf = (emoji) => String(emoji).match(/:(\d+)>$/)[1];

/** The buttons and the cards of a ticket use the ticket emojis of Petto, not the usual ones. */
function checkEmojis() {
  const buttons = (row) => row.toJSON().components;
  const byId = (row) => Object.fromEntries(buttons(row).map((button) => [String(button.custom_id ?? 'link').split('::')[0], button.emoji?.id ?? null]));
  assert.deepEqual(byId(cards.buildTicketControlRow(1, 'en')), { tk_claim: idOf(EMOJI.TICKET_CLAIM), tk_close: idOf(EMOJI.TICKET_CLOSE), tk_transcript: idOf(EMOJI.TICKET_TRANSCRIPT) });
  assert.deepEqual(byId(cards.buildTicketMemberRow(1, 'en')), { tk_addmember: idOf(EMOJI.TICKET_ADD), tk_removemember: idOf(EMOJI.TICKET_REMOVE) });
  assert.deepEqual(byId(cards.buildClosedControlRow(1, 'https://petto.sbs/t/1', 'en')), { tk_reopen: idOf(EMOJI.TICKET_REOPEN), tk_delete: idOf(EMOJI.TICKET_DELETE), link: idOf(EMOJI.TICKET_TRANSCRIPT) });
  assert.equal(buttons(cards.buildTranscriptLinkRow('https://petto.sbs/t/1', 'en'))[0].emoji.id, idOf(EMOJI.TICKET_TRANSCRIPT));
  assert.ok(buttons(cards.buildRatingRow(1)).every((button) => button.emoji?.id === idOf(EMOJI.STAR_FULL)), 'the rating buttons use the full star of Petto');
  // The cards: the ticket icon in the welcome and the panel, the close icon on the closed notice and the DM, the claim icon.
  for (const lang of ['en', 'es', 'pt-BR']) {
    const welcome = JSON.stringify(cards.buildWelcomeFallbackCard({ opener: { toString: () => '<@5>', displayAvatarURL: () => null }, categoryLabel: 'Help', ticketNumber: 7, lang }).toJSON());
    assert.ok(welcome.includes(EMOJI.TICKET) && welcome.includes(EMOJI.TICKET_CLAIM) && welcome.includes(EMOJI.TICKET_CLOSE), `${lang}: the welcome card uses the ticket emojis`);
    assert.ok(JSON.stringify(cards.buildPanelFallbackCard({ title: 'Support', lang }).toJSON()).includes(EMOJI.TICKET), `${lang}: the usual panel text has the ticket emoji`);
    assert.ok(JSON.stringify(cards.buildTicketClosedNotice({ ticketNumber: 7, closedByLine: 'x', reason: 'ok', lang }).toJSON()).includes(EMOJI.TICKET_CLOSE));
    assert.ok(JSON.stringify(cards.buildClaimCard({ staffId: '6', openerId: '5', lang }).toJSON()).includes(EMOJI.TICKET_CLAIM));
    assert.equal(JSON.stringify(cards.buildRatedCard(5, lang).toJSON()).split(EMOJI.STAR_FULL).length - 1, 6, `${lang}: the thanks card starts with a star and shows five`);
  }
  const dm = JSON.stringify(cards.buildTicketClosedCard({ ticket: { ticket_number: 3 }, guild: { name: 'Luna', iconURL: () => null }, actor: { toString: () => '<@6>', displayAvatarURL: () => null }, reason: 'ok', channel: null, lang: 'en' }).toJSON());
  assert.ok(dm.includes(EMOJI.TICKET_CLOSE), 'the closed DM uses the close emoji');
  const all = JSON.stringify([cards.buildTicketControlRow(1, 'en'), cards.buildTicketMemberRow(1, 'en'), cards.buildClosedControlRow(1, null, 'en'), cards.buildRatingRow(1)].map((row) => row.toJSON()));
  for (const stock of ['🎫', '🔒', '🔓', '📄', '⭐', '➕', '➖', '🗑']) assert.ok(!all.includes(stock), `no ${stock} left on the ticket buttons`);
}

/** The transcript draws the pictures and lists the files of the answers of a ticket form, once, and the answers card is in it. */
async function checkFormAnswersInTranscript() {
  const answers = require('../src/utils/ticketAnswers');
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
  const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]);
  const PDF = Buffer.from('%PDF-1.7 hello pdf hello pdf');
  const cdn = (name, id = '1') => `https://cdn.discordapp.com/attachments/10/${id}/${name}?ex=1&is=2&hm=3`;
  const guild = { id: '10', premiumTier: 0 };
  const entries = [
    { id: 'subject', type: 'short_text', label: 'Subject', value: 'Cannot log in' },
    { id: 'agree', type: 'check', label: 'Rules read', value: true },
    { id: 'proof', type: 'file', label: 'Screenshots', accept: 'images', value: [{ id: '1', name: 'screen*shot [1].png', url: cdn('screen.png', '1'), size: 2048, type: 'image/png', image: true, data: PNG }, { id: '2', name: 'second.jpg', url: cdn('second.jpg', '2'), size: 4096, type: 'image/jpeg', image: true, data: JPG }] },
    { id: 'docs', type: 'file', label: 'Documents', accept: 'any', value: [{ id: '3', name: 'report (final).pdf', url: cdn('report.pdf', '3'), size: 1536, type: 'application/pdf', image: false, data: PDF }] },
  ];
  const guildStub = { id: '10', name: 'Luna', members: { cache: new Map(), me: null }, roles: { cache: new Map() }, channels: { cache: new Map() }, iconURL: () => null, bannerURL: () => null, client: { user: { id: '99' } } };
  const card = answers.buildAnswerMessages(entries, { guild })[0];
  const apiJson = card.components[0].toJSON();
  // What Discord gives back for that message: the components with the real links of the uploaded files, and the files themselves.
  const link = (name, id) => `https://cdn.discordapp.com/attachments/900/${id}/${name}?ex=9&is=8&hm=7`;
  const live = JSON.parse(JSON.stringify(apiJson));
  const live12 = live.components.find((part) => part.type === 12);
  live12.items[0].media.url = link('screen_shot_1.png', '11');
  live12.items[1].media.url = link('second.jpg', '12');
  const live13 = live.components.find((part) => part.type === 13);
  live13.file.url = link('report_final.pdf', '13');
  Object.assign(live13, { name: 'report_final.pdf', size: 1536 });
  const attachments = new Map([['11', { name: 'screen_shot_1.png', url: link('screen_shot_1.png', '11'), contentType: 'image/png' }], ['12', { name: 'second.jpg', url: link('second.jpg', '12'), contentType: 'image/jpeg' }], ['13', { name: 'report_final.pdf', url: link('report_final.pdf', '13'), contentType: 'application/pdf' }]]);
  const message = { id: '1', author: { id: '99', username: 'Petto', bot: true, displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/99/p.png' }, member: null, content: '', createdTimestamp: Date.parse('2026-10-20T15:00:00Z'), guild: guildStub, attachments, embeds: [], components: [live] };
  const { html } = renderTranscriptHtml({ messages: [message], guild: guildStub, channelName: 'ticket-0001', lang: 'en', info: { number: 1, opener: { name: 'Liam' } } });
  assert.ok(html.includes('Submitted form') && html.includes('Cannot log in') && html.includes('Rules read'), 'the answers card is in the transcript');
  assert.equal(html.split(link('screen_shot_1.png', '11').replace(/&/g, '&amp;')).length - 1, 2, 'the picture is drawn once (its picture and the link around it), not again as an attachment');
  assert.ok(html.includes('class="media-gallery'), 'the pictures are a gallery');
  assert.ok(html.includes(`href="${link('report_final.pdf', '13').replace(/&/g, '&amp;')}"`) && html.includes('report_final.pdf') && html.includes('1.5 KB'), 'the other file is a link with its name and size');
  assert.equal(html.split(link('report_final.pdf', '13').replace(/&/g, '&amp;')).length - 1, 1, 'and also only once');
  const plainAttachment = renderTranscriptHtml({ messages: [{ ...message, components: [], attachments }], guild: guildStub, lang: 'en', info: { number: 1 } }).html;
  assert.equal(plainAttachment.split(link('second.jpg', '12').replace(/&/g, '&amp;')).length - 1, 2, 'a message with plain attachments still shows them (the picture and its caption link)');
}

(async () => {
  checkEmojis();
  await checkTranscript();
  await checkFormAnswersInTranscript();
  await checkChannelDelete();
  await checkReconcile();
  await checkRating();
  console.log('Checked tickets: the ticket emojis, transcript identity (and the pictures and files of a form), deleted channels, the channel check and ratings.');
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
