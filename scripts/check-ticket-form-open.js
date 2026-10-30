// Opens a ticket from a form with fakes for Discord and the database: the welcome message first, then the answers of the form in the new channel
// (choices, marks, mentions that notify nobody, the pictures as a gallery and the other files as files, uploaded again into the channel), and a
// ticket opened with no form, or from an old form of text questions, behaves as it always did.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const sent = [];
const stored = [];
stub('src/db/database.js', { from: () => ({}) });
stub('src/db/tickets.js', {
  countOpenTickets: async () => 0,
  countOpenTicketsForMember: async () => 0,
  createTicket: async () => ({ id: 41, ticket_number: 12 }),
  setTicketFormData: async (id, data) => stored.push([id, data]),
  setTicketChannel: async () => {},
  deleteTicketRow: async () => {},
});
stub('src/db/ticketSettings.js', { getSettings: async () => ({ blocked_role_ids: [], global_limit: 0, hours_enabled: false }) });
stub('src/db/ticketAccess.js', { isBlacklisted: async () => null });
stub('src/db/ticketRatings.js', {});
stub('src/db/embedTemplates.js', { getTemplate: async () => null });
stub('src/db/ticketForms.js', {});
stub('src/utils/senderIdentity.js', { sendAs: async (channel, feature, payload) => { sent.push({ feature, payload }); return {}; } });
stub('src/utils/ticketAiGreeting.js', { greet: async () => {} });
stub('src/logging/engine.js', { sendLog: async () => {} });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });

const { openTicket } = require('../src/utils/ticketActions');
const { MessageFlags } = require('discord.js');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const PDF = Buffer.from('%PDF-1.7 hello pdf hello pdf');

function world() {
  const channel = { id: '900', toString: () => '<#900>' };
  const guild = {
    id: '10',
    premiumTier: 0,
    members: { fetch: async () => ({ roles: { cache: new Map() } }), me: { id: '99' } },
    channels: { create: async () => channel, fetch: async () => null },
  };
  const opener = { id: '5', username: 'liam', tag: 'liam#0', toString: () => '<@5>', displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/5/a.png' };
  return { guild, opener, client: { user: { id: '99' } }, category: { id: 7, label: 'Support', form_id: 3, naming_pattern: 'ticket-{number}', max_open_per_user: 3, support_role_ids: [], ping_role_ids: [] } };
}

(async () => {
  const entries = [
    { id: 'subject', type: 'short_text', label: 'Subject', value: 'Cannot log in' },
    { id: 'topic', type: 'select', label: 'Topic', value: ['Billing', 'Bug'] },
    { id: 'who', type: 'user', label: 'Member', value: ['111111111111111111'] },
    { id: 'proof', type: 'file', label: 'Screenshot', accept: 'images', value: [{ id: '1', name: 'shot.png', url: 'https://cdn.discordapp.com/attachments/1/1/shot.png', size: 100, type: 'image/png', image: true, data: PNG }] },
    { id: 'docs', type: 'file', label: 'Report', accept: 'any', value: [{ id: '2', name: 'report.pdf', url: 'https://cdn.discordapp.com/attachments/1/2/report.pdf', size: 28, type: 'application/pdf', image: false, data: PDF }, { id: '3', name: 'lost.zip', url: 'https://cdn.discordapp.com/attachments/1/3/lost.zip', size: 9000, type: 'application/zip', image: false, data: null, reason: 'failed' }] },
  ];
  const w = world();
  const { channel } = await openTicket({ ...w, formAnswers: { Subject: 'Cannot log in', Topic: 'Billing, Bug' }, formEntries: entries });
  assert.equal(channel.id, '900');
  assert.equal(stored.length, 1, 'the answers are kept with the ticket');
  assert.deepEqual(stored[0][1], { formId: 3, answers: { Subject: 'Cannot log in', Topic: 'Billing, Bug' } });
  assert.equal(sent.length, 2, 'the welcome, then the answers');
  const card = sent[1].payload;
  assert.equal(sent[1].feature, 'tickets');
  assert.equal(card.flags, MessageFlags.IsComponentsV2);
  assert.deepEqual(card.allowedMentions, { parse: [] }, 'the answers notify nobody');
  assert.deepEqual(card.files.map((file) => file.name), ['shot.png', 'report.pdf'], 'the pictures and files are uploaded again into the ticket channel');
  const json = card.components[0].toJSON();
  const types = json.components.map((part) => part.type);
  assert.deepEqual(types, [10, 12, 10, 13, 10], 'texts, a gallery of the picture, a file card, and the link of the file that was not copied');
  assert.equal(json.components.find((part) => part.type === 12).items[0].media.url, 'attachment://shot.png');
  assert.equal(json.components.find((part) => part.type === 13).file.url, 'attachment://report.pdf');
  const text = json.components.filter((part) => part.type === 10).map((part) => part.content).join('\n');
  assert.ok(text.includes('**Topic:**\n- Billing\n- Bug') && text.includes('**Member:** <@111111111111111111>') && text.includes('[lost.zip](https://cdn.discordapp.com/attachments/1/3/lost.zip)'), text);

  // With only { question: text }, as a caller that knows nothing of the new questions (and as a form of text questions) always did.
  sent.length = 0;
  await openTicket({ ...world(), formAnswers: { 'What happened?': 'It broke', Note: 'ok' } });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].payload.components[0].toJSON().components, [{ type: 10, content: '### Submitted form\n**What happened?:** It broke\n**Note:** ok' }]);
  assert.ok(!sent[1].payload.files, 'no files, nothing to upload');

  // No form: only the welcome.
  sent.length = 0;
  await openTicket({ ...world(), category: { ...w.category, form_id: null } });
  assert.equal(sent.length, 1);
  console.log('Checked opening a ticket from a form: the welcome, then the answers with their pictures and files.');
})().catch((error) => { console.error(error); process.exit(1); });
