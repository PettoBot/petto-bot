// Confessions: the usual look, posting through a webhook, the check of the staff, anonymous replies, the cooldown and the blocks.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/database.js', {});
stub('src/db/guilds.js', { ensureGuild: async () => {} });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });

let config = {};
const rows = new Map();
const blocked = new Set();
const sent = [];
let when = Date.now();
stub('src/db/confessions.js', {
  DEFAULTS: {},
  getConfig: async () => config,
  nextNumber: async () => rows.size + 1,
  create: async (row) => { const made = { status: 'pending', created_at: new Date(when).toISOString(), ...row }; rows.set(row.id, made); return made; },
  getById: async (id) => rows.get(id) ?? null,
  update: async (id, patch) => { const made = { ...rows.get(id), ...patch }; rows.set(id, made); return made; },
  remove: async (guildId, id) => { const had = rows.get(id); rows.delete(id); return had ?? null; },
  lastBy: async (guildId, userId) => { const mine = [...rows.values()].filter((row) => row.author_id === userId); return mine.length ? new Date(mine[mine.length - 1].created_at) : null; },
  isBlocked: async (guildId, userId) => blocked.has(userId),
});
stub('src/utils/senderIdentity.js', {
  webhookFor: async () => ({ send: async (options) => { sent.push({ via: 'webhook', ...options }); return { id: `m${sent.length}` }; } }),
});
stub('src/db/embedTemplates.js', { getTemplate: async () => null });

const confessions = require('../src/utils/confessions');
const empty = () => ({ cache: new Map() });
const makeChannel = (id) => ({
  id, isTextBased: () => true, isThread: () => false, client: {}, permissionsFor: () => ({ has: () => true }),
  send: async (payload) => { sent.push({ via: 'bot', channel: id, ...payload }); return { id: `m${sent.length}`, attachments: { first: () => null } }; },
  messages: { fetch: async () => ({ id: 'm1', startThread: async () => ({ ...makeChannel('thread1'), isThread: () => true }) }) },
});
const channels = { c1: makeChannel('c1'), review: makeChannel('review') };
const guild = {
  id: '111111111111111111', name: 'G', members: { ...empty(), me: {} }, roles: empty(), emojis: empty(), stickers: empty(), memberCount: 1, premiumTier: 0,
  iconURL: () => null, bannerURL: () => null, splashURL: () => null, discoverySplashURL: () => null,
  channels: { ...empty(), fetch: async (id) => channels[id] ?? null },
};
const user = (id) => ({ id });
const base = { enabled: true, channel_id: 'c1', review_channel_id: 'review', require_review: false, allow_images: true, allow_replies: true, keep_author: true, use_webhook: true, webhook_name: 'Anonymous', webhook_avatar: null, title: 'Anonymous confession #{confession.number}', footer: 'Confession ID: {confession.id}', color: 0xa5ea7a, reply_label: 'Reply anonymously', cooldown_seconds: 60 };

(async () => {
  assert.equal(confessions.BUTTON_PREFIX, 'cfs');
  assert.match(confessions.makeId(), /^[a-z0-9]{5}-[a-z0-9]{5}$/);

  // The usual look: the color of the server, the confession and the ID under it, a reply button under that.
  config = { ...base };
  let result = await confessions.submit({ guild, user: user('u1'), text: 'I ate the last cookie' });
  assert.ok(!result.error, result.error);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].via, 'webhook', 'it goes through the webhook');
  assert.equal(sent[0].username, 'Anonymous');
  const json = JSON.stringify(sent[0].components.map((c) => c.toJSON?.() ?? c));
  assert.ok(json.includes('I ate the last cookie') && json.includes('Anonymous confession #1'), 'the text and the title are there');
  assert.ok(json.includes('cfs:reply:'), 'the reply button is there');
  assert.ok(json.includes(String(0xa5ea7a)), 'the color is the one of the server');
  assert.equal(rows.get(result.row.id).status, 'posted');

  // The cooldown and the blocks.
  result = await confessions.submit({ guild, user: user('u1'), text: 'again' });
  assert.match(result.error, /Wait \d+ second/);
  blocked.add('u2');
  result = await confessions.submit({ guild, user: user('u2'), text: 'hello' });
  assert.match(result.error, /cannot make confessions/);

  // Without a webhook it goes as the bot.
  config = { ...base, use_webhook: false, cooldown_seconds: 0 };
  sent.length = 0;
  result = await confessions.submit({ guild, user: user('u3'), text: 'as the bot' });
  assert.equal(sent[0].via, 'bot');

  // Not keeping the author: nothing to reveal.
  config = { ...base, keep_author: false, cooldown_seconds: 0 };
  result = await confessions.submit({ guild, user: user('u4'), text: 'no trace' });
  assert.equal(rows.get(result.row.id).author_id, null);

  // The staff checks first: it waits in the review channel and shows only when approved.
  config = { ...base, require_review: true, cooldown_seconds: 0 };
  sent.length = 0;
  result = await confessions.submit({ guild, user: user('u5'), text: 'check me' });
  assert.ok(result.review);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'review');
  assert.ok(JSON.stringify(sent[0].components).includes('cfs:ok:'), 'the staff gets the approve button');
  const waiting = result.row;
  let decided = await confessions.decide({ guild, member: { permissions: { has: () => false }, roles: empty() }, id: waiting.id, approve: true });
  assert.match(decided.error, /Only the staff/);
  const staff = { permissions: { has: () => true }, roles: empty() };
  sent.length = 0;
  decided = await confessions.decide({ guild, member: staff, id: waiting.id, approve: true });
  assert.ok(!decided.error, decided.error);
  assert.equal(sent[0].via, 'webhook', 'it shows after the approval');
  decided = await confessions.decide({ guild, member: staff, id: waiting.id, approve: false });
  assert.match(decided.error, /already/);
  result = await confessions.submit({ guild, user: user('u6'), text: 'reject me' });
  decided = await confessions.decide({ guild, member: staff, id: result.row.id, approve: false });
  assert.equal(decided.row.status, 'rejected');

  // An anonymous reply goes in a thread.
  config = { ...base, cooldown_seconds: 0 };
  const posted = (await confessions.submit({ guild, user: user('u7'), text: 'a secret' })).row;
  sent.length = 0;
  const answer = await confessions.reply({ guild, user: user('u8'), id: posted.id, text: 'me too' });
  assert.ok(!answer.error, answer.error);
  assert.equal(sent[0].via, 'webhook');
  assert.ok(JSON.stringify(sent[0].components.map((c) => c.toJSON?.() ?? c)).includes('Anonymous reply'));
  config = { ...base, allow_replies: false };
  assert.match((await confessions.reply({ guild, user: user('u8'), id: posted.id, text: 'x' })).error, /not turned on/);

  console.log('confessions ok');
})().catch((error) => { console.error(error); process.exit(1); });
