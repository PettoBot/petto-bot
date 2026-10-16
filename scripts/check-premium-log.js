// The list of active Premium that Petto posts when it starts: how it is split, what it says and that nothing is posted without the channel.
const assert = require('node:assert/strict');

const stub = (relative, exports) => { const file = require.resolve(relative); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
const config = { premiumLogChannelId: '111111111111111111' };
stub('../src/config', config);
const rows = [];
stub('../src/db/premium', { listActiveEntitlements: async () => rows });
stub('../src/utils/logger', { warn() {}, info() {}, error() {} });
const { buildPremiumCards, announceActivePremium } = require('../src/jobs/premiumLogJob');

const json = (card) => JSON.stringify(card.toJSON());
(async () => {
  assert.ok(json(buildPremiumCards([])[0]).includes('None right now'), 'an empty list says so');
  const many = Array.from({ length: 120 }, (_, i) => ({ user_id: `2000000000000000${String(i).padStart(2, '0')}`, plan_key: 'premium-3', slot_limit: 3, provider: i % 2 ? 'polar' : 'manual', current_period_end: '2027-01-01T00:00:00Z' }));
  const cards = buildPremiumCards(many);
  assert.ok(cards.length > 1, 'a long list is split in several cards');
  assert.ok(cards.every((card) => json(card).length < 6000));
  assert.ok(json(cards[0]).includes('**120** active subscriptions'), 'the first card has the count');
  assert.ok(json(cards[0]).includes('Polar') && json(cards[0]).includes('manual'));

  const sent = [];
  const client = { channels: { fetch: async (id) => (id === config.premiumLogChannelId ? { send: async (p) => { sent.push(p); } } : null) } };
  rows.push(...many.slice(0, 3));
  assert.equal(await announceActivePremium(client), true);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions, { parse: [] }, 'it pings nobody');
  // A restart finds the same list already there and adds nothing; a changed list is posted and the old one removed.
  const botId = '999999999999999999';
  const posted = [];
  const channelWithHistory = {
    send: async (payload) => { sent.push(payload); },
    messages: { fetch: async () => new Map(posted.map((m, i) => [String(i), m])) },
  };
  const asMessage = (card, at) => ({ author: { id: botId }, createdTimestamp: at, components: card.toJSON().components ? [card.toJSON()] : [], deleted: false, delete: async function del() { this.deleted = true; } });
  const historyClient = { user: { id: botId }, channels: { fetch: async () => channelWithHistory } };
  const current = buildPremiumCards(rows);
  current.forEach((card, i) => posted.push(asMessage(card, i + 1)));
  const before = sent.length;
  assert.equal(await announceActivePremium(historyClient), false, 'the same list is not posted again');
  assert.equal(sent.length, before);
  rows.push(many[10]);
  assert.equal(await announceActivePremium(historyClient), true, 'a changed list is posted');
  assert.equal(sent.length, before + 1);
  assert.ok(posted.every((message) => message.deleted), 'and the old one is removed');
  rows.pop();
  config.premiumLogChannelId = null;
  assert.equal(await announceActivePremium(client), false, 'nothing without the channel');
  console.log('Checked the list of active Premium posted at start.');
})().catch((error) => { console.error(error); process.exit(1); });
