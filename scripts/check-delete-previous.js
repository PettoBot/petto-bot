// Checks "delete the previous one": a repeating timer deletes the message it sent the time before, and an autoresponder deletes its own
// previous reply in the channel. Nothing is deleted the first time, when the option is off, or when the old message is already gone.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const stored = [];
const lastErrors = [];
const rows = [];
stub('src/config.js', { jobConcurrency: 1 });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/utils/concurrency.js', { forEachWithConcurrency: async (list, fn) => { for (const item of list) await fn(item); }, exclusiveTask: (fn) => fn });
stub('src/db/autoMessages.js', {
  listDue: async () => rows,
  scheduleNext: async () => {},
  setLastMessage: async (id, messageId) => { stored.push([id, messageId]); },
  setLastError: async (id, text) => { lastErrors.push([id, text]); },
});
let sendCount = 0;
stub('src/utils/senderIdentity.js', { sendAs: async (channel, feature, payload) => channel.send(payload) });
const reacted = [];
stub('src/utils/templatedMessage.js', { templatePayload: async (guildId, name) => (name === 'ok' ? { reactions: ['🌸'], content: undefined, embeds: [{ title: 'T' }], components: [], files: [] } : null) });
stub('src/utils/messageFlags.js', { extractReactReplies: (text) => ({ text, emojis: [] }), extractReactRepliesFromTemplate: () => ({}), applyReactReplies: async (message, emojis) => { reacted.push([message.id, emojis]); } });
stub('src/i18n/index.js', { runWithLanguage: async (lang, fn) => fn(), guildLanguage: async () => 'en' });

function fakeChannel(id = 'c1') {
  const deleted = [];
  return {
    id,
    deleted,
    isTextBased: () => true,
    sent: [],
    send: async function (payload) { this.sent.push(payload); return { id: `m${++sendCount}` }; },
    messages: { delete: async (messageId) => { deleted.push(messageId); } },
  };
}

(async () => {
  // Timers.
  const { processDueAutoMessages, replacePrevious } = require('../src/jobs/autoMessageJob');
  const channel = fakeChannel();
  const client = { channels: { fetch: async () => channel } };

  rows.splice(0, rows.length, { id: 7, guild_id: 'g', channel_id: 'c1', interval_ms: 600000, message: 'hi', next_run_at: 'x', delete_previous: true, last_message_id: null });
  await processDueAutoMessages(client);
  assert.deepEqual(channel.deleted, [], 'the first message has nothing before it to delete');
  assert.deepEqual(stored.at(-1), [7, `m${sendCount}`], 'the new message is remembered');

  rows[0].last_message_id = stored.at(-1)[1];
  const before = rows[0].last_message_id;
  await processDueAutoMessages(client);
  assert.deepEqual(channel.deleted, [before], 'the next run deletes the one of the time before');
  assert.notEqual(stored.at(-1)[1], before);

  rows[0].delete_previous = false;
  rows[0].last_message_id = 'old';
  await processDueAutoMessages(client);
  assert.deepEqual(channel.deleted, [before], 'with the option off nothing else is deleted');

  const gone = fakeChannel();
  gone.messages.delete = async () => { throw new Error('Unknown Message'); };
  await replacePrevious(gone, { id: 8, last_message_id: 'x' }, { id: 'y' });
  assert.deepEqual(stored.at(-1), [8, 'y'], 'a message that is already gone does not stop the new one from being remembered');
  await replacePrevious(gone, { id: 9, last_message_id: 'x' }, null);
  assert.notDeepEqual(stored.at(-1), [9, undefined], 'a failed send remembers nothing');

  // A timer with a saved embed.
  const { timerPayload } = require('../src/jobs/autoMessageJob');
  const withEmbed = await timerPayload(channel, { guild_id: 'g', message: 'above', embed_template: 'ok' });
  assert.deepEqual(withEmbed.message.embeds, [{ title: 'T' }]);
  assert.equal(withEmbed.message.content, 'above', 'the text goes above the embed');
  assert.deepEqual(withEmbed.reactions, ['🌸']);
  assert.equal((await timerPayload(channel, { guild_id: 'g', message: '', embed_template: 'ok' })).message.content, undefined, 'a timer with only an embed has no text');
  const gone2 = await timerPayload(channel, { guild_id: 'g', message: 'fallback', embed_template: 'deleted' });
  assert.equal(gone2.message.content, 'fallback', 'a saved embed that is gone falls back to the text');
  assert.equal(gone2.message.embeds, undefined);
  assert.deepEqual((await timerPayload(channel, { guild_id: 'g', message: 'plain', embed_template: null })).message, { content: 'plain', allowedMentions: { parse: ['users', 'roles', 'everyone'] } });
  rows.splice(0, rows.length, { id: 11, guild_id: 'g', channel_id: 'c1', interval_ms: 600000, message: '', next_run_at: 'x', delete_previous: false, embed_template: 'ok' });
  await processDueAutoMessages(client);
  assert.deepEqual(channel.sent.at(-1).embeds, [{ title: 'T' }], 'the timer sends its embed');
  assert.deepEqual(reacted.at(-1)[1], ['🌸'], 'and puts the reactions the embed asks for');

  // A send Discord refuses is not swallowed: it is kept in last_error (and logged), the timer still moves on, and a send that works clears it.
  const refusing = fakeChannel('c3');
  refusing.send = async () => { const error = new Error('Invalid Form Body'); error.code = 50035; throw error; };
  rows.splice(0, rows.length, { id: 12, guild_id: 'g', channel_id: 'c3', interval_ms: 600000, message: 'x', next_run_at: 'x', delete_previous: false });
  await processDueAutoMessages({ channels: { fetch: async () => refusing } });
  assert.deepEqual(lastErrors.at(-1), [12, 'Invalid Form Body (50035)']);
  const { sendTimer } = require('../src/jobs/autoMessageJob');
  assert.equal((await sendTimer(client, { ...rows[0], channel_id: 'c1', last_error: 'Invalid Form Body (50035)' })).ok, true);
  assert.deepEqual(lastErrors.at(-1), [12, null], 'a send that works clears the error');

  // Autoresponders.
  stub('src/db/autoResponders.js', {});
  for (const file of ['src/utils/cardService.js', 'src/db/embedTemplates.js', 'src/utils/embedBuilder.js', 'src/utils/embedVariables.js', 'src/utils/embedScript.js', 'src/utils/embedCodeMessage.js']) {
    stub(file, new Proxy({}, { get: () => async () => ({}) }));
  }
  stub('src/handlers/prefixInteraction.js', { tokenize: () => [] });
  stub('src/events/messageCreateCommands.js', { isCommandMessage: async () => false });
  const { replacePreviousReply } = require('../src/events/messageCreateAutoresponder');
  const room = fakeChannel('c2');
  const ar = { ar_id: 'abc', delete_previous: true };
  await replacePreviousReply(ar, room, { id: 'r1' });
  assert.deepEqual(room.deleted, [], 'the first reply deletes nothing');
  await replacePreviousReply(ar, room, { id: 'r2' });
  assert.deepEqual(room.deleted, ['r1'], 'the second reply deletes the first');
  await replacePreviousReply(ar, room, { id: 'r3' });
  assert.deepEqual(room.deleted, ['r1', 'r2']);
  const other = fakeChannel('c3');
  await replacePreviousReply(ar, other, { id: 'o1' });
  assert.deepEqual(other.deleted, [], 'each channel has its own last reply');
  await replacePreviousReply({ ar_id: 'zzz' }, room, { id: 'z1' });
  assert.deepEqual(room.deleted, ['r1', 'r2'], 'another autoresponder in the same channel is not touched');
  await replacePreviousReply(ar, room, null);
  assert.deepEqual(room.deleted, ['r1', 'r2'], 'a reply that failed to send deletes nothing');

  console.log('Checked deleting the previous message of timers and autoresponders, and the saved embed of a timer.');
})().catch((err) => { console.error(err); process.exit(1); });
