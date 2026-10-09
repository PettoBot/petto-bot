// Checks the automatic reactions on every message of a channel: up to five emojis, and announcement channels, whose posts come from
// followed channels or webhooks (bots), get them too, while the trigger phrases only react to what a person writes.
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';

const resolved = require.resolve(path.join(__dirname, '..', 'src', 'db', 'reactionTriggers.js'));
const real = (() => { // the real module, without a database, for its limit and its normalizing
  const database = require.resolve('../src/db/database');
  require.cache[database] = { id: database, filename: database, loaded: true, exports: { from: () => ({}) } };
  return require('../src/db/reactionTriggers');
})();
const emojis = ['🎉', '🔥', '👍', '💜', '🌸'];
let triggerCalls = 0;
require.cache[resolved].exports = {
  ...real,
  listForMessage: async ({ channelId }) => (channelId === 'announce' ? emojis : []),
  listMatchingTriggers: async () => { triggerCalls += 1; return [{ id: 1, emoji: '👀', trigger: 'news', cooldown_seconds: 0 }]; },
};

const event = require('../src/events/messageCreateReactionTriggers');
const post = ({ bot = false, webhookId = null, channelId = 'announce', system = false } = {}) => {
  const reacted = [];
  return { reacted, message: { guild: { id: '1' }, channel: { id: channelId }, author: { id: '9', bot }, webhookId, system, content: 'news today', member: null, react: async (emoji) => { reacted.push(emoji); } } };
};

(async () => {
  assert.equal(real.MAX_EMOJIS_PER_CHANNEL, 5, 'five emojis per channel');
  let made = post();
  await event.execute(made.message);
  assert.deepEqual(made.reacted, [...emojis, '👀'], 'a person: the five emojis of the channel and the trigger');
  made = post({ bot: true });
  triggerCalls = 0;
  await event.execute(made.message);
  assert.deepEqual(made.reacted, emojis, 'a bot post in an announcement channel gets the five emojis, not the trigger');
  assert.equal(triggerCalls, 0, 'the triggers are not even looked up for a bot');
  made = post({ webhookId: '5', bot: true });
  await event.execute(made.message);
  assert.deepEqual(made.reacted, emojis, 'a post of a followed channel (webhook) gets them too');
  made = post({ channelId: 'other', bot: true });
  await event.execute(made.message);
  assert.deepEqual(made.reacted, [], 'a channel that is not set up gets nothing');
  made = post({ system: true });
  await event.execute(made.message);
  assert.deepEqual(made.reacted, [], 'system messages (a pin, a join) get nothing');
  console.log('Checked the automatic reactions: five emojis, announcement channels and bot posts.');
})().catch((err) => { console.error(err); process.exit(1); });
