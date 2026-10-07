// Checks the messages with their own name and picture: the webhook is used when the server chose a look, a missing look or a
// failing webhook sends the message the normal way, and a thread goes through the webhook of its channel.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/db/senderIdentities.js', { FEATURES: ['quests'], get: async () => null });
const { sendAs } = require('../src/utils/senderIdentity');

(async () => {
  const sentNormal = [];
  const sentHook = [];
  const hook = { send: async (options) => { sentHook.push(options); return { id: 'hook-message' }; } };
  const channel = (extra = {}) => ({ id: 'c1', guild: { id: 'g1' }, client: {}, isThread: () => false, send: async (payload) => { sentNormal.push(payload); return { id: 'normal-message' }; }, ...extra });
  const store = (row) => ({ get: async () => row });

  assert.equal((await sendAs(channel(), 'quests', { content: 'a' }, { identities: store(null), webhookFor: async () => hook })).id, 'normal-message');
  assert.equal(sentHook.length, 0);

  const row = { name: 'Quest Hunter', avatar_url: 'https://example.com/a.png' };
  const message = await sendAs(channel(), 'quests', { content: 'b', components: [{}] }, { identities: store(row), webhookFor: async () => hook });
  assert.equal(message.id, 'hook-message');
  assert.equal(sentHook[0].username, 'Quest Hunter');
  assert.equal(sentHook[0].avatarURL, 'https://example.com/a.png');
  assert.equal(sentHook[0].withComponents, true);
  assert.equal(sentHook[0].threadId, undefined);

  await sendAs(channel(), 'quests', { content: 'c' }, { identities: store({ name: 'Only', avatar_url: 'http://insecure' }), webhookFor: async () => hook });
  assert.equal(sentHook[1].username, 'Only');
  assert.equal(sentHook[1].avatarURL, undefined);
  assert.equal(sentHook[1].withComponents, undefined);

  await sendAs(channel({ id: 't1', isThread: () => true, parentId: 'c1' }), 'quests', { content: 'd' }, { identities: store(row), webhookFor: async () => hook });
  assert.equal(sentHook[2].threadId, 't1');

  sentNormal.length = 0;
  assert.equal((await sendAs(channel(), 'quests', { content: 'e' }, { identities: store(row), webhookFor: async () => null })).id, 'normal-message');
  const broken = { send: async () => { throw new Error('Unknown Webhook'); } };
  assert.equal((await sendAs(channel(), 'quests', { content: 'f' }, { identities: store(row), webhookFor: async () => broken })).id, 'normal-message');
  assert.equal(sentNormal.length, 2);

  assert.equal((await sendAs(channel(), 'quests', { content: 'g' }, { identities: { get: async () => { throw new Error('down'); } }, webhookFor: async () => hook })).id, 'normal-message');
  console.log('sender identity ok');
})().catch((error) => { console.error(error); process.exit(1); });
