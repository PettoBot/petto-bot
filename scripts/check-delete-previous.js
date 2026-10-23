// Checks "delete the previous one": a repeating timer deletes the message it sent the time before, and an autoresponder deletes its own
// previous reply in the channel. Nothing is deleted the first time, when the option is off, or when the old message is already gone.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const stored = [];
const rows = [];
stub('src/config.js', { jobConcurrency: 1 });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/utils/concurrency.js', { forEachWithConcurrency: async (list, fn) => { for (const item of list) await fn(item); }, exclusiveTask: (fn) => fn });
stub('src/db/autoMessages.js', {
  listDue: async () => rows,
  scheduleNext: async () => {},
  setLastMessage: async (id, messageId) => { stored.push([id, messageId]); },
});
let sendCount = 0;
stub('src/utils/senderIdentity.js', { sendAs: async (channel) => channel.send({ content: 'hi' }) });
stub('src/i18n/index.js', { runWithLanguage: async (lang, fn) => fn(), guildLanguage: async () => 'en' });

function fakeChannel(id = 'c1') {
  const deleted = [];
  return {
    id,
    deleted,
    isTextBased: () => true,
    send: async () => ({ id: `m${++sendCount}` }),
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

  // Autoresponders.
  stub('src/db/autoResponders.js', {});
  for (const file of ['src/utils/cardService.js', 'src/db/embedTemplates.js', 'src/utils/embedBuilder.js', 'src/utils/embedVariables.js', 'src/utils/embedScript.js', 'src/utils/embedCodeMessage.js']) {
    stub(file, new Proxy({}, { get: () => async () => ({}) }));
  }
  stub('src/utils/messageFlags.js', { extractReactReplies: (text) => ({ text, emojis: [] }), extractReactRepliesFromTemplate: () => ({}), applyReactReplies: async () => {} });
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

  console.log('Checked deleting the previous message of timers and autoresponders.');
})().catch((err) => { console.error(err); process.exit(1); });
