// Checks the sticky messages: text, a saved embed (also a V2 design), a missing embed falling back to the text, and the
// repost at the bottom of the channel.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
const templates = new Map();
stub('src/utils/templatedMessage.js', { templatePayload: async (guildId, name) => templates.get(`${guildId}:${name}`) ?? null });
let sticky = null;
const written = [];
stub('src/db/stickyMessages.js', {
  getSticky: async () => sticky,
  setMessageId: async (guildId, channelId, id) => { written.push(id); sticky = { ...sticky, message_id: id }; },
});

const { stickyPayload } = require('../src/utils/stickyPayload');
const event = require('../src/events/messageCreateSticky');

(async () => {
  const source = { guild: { id: 'g' }, channel: { id: 'c' }, member: null, author: { id: 'u' } };
  assert.deepEqual(await stickyPayload({ content: 'Read the rules', embed_template: null }, source), { content: 'Read the rules' });
  assert.equal(await stickyPayload({ content: '', embed_template: null }, source), null, 'an empty sticky sends nothing');
  templates.set('g:rules', { embeds: [{ title: 'Rules' }], components: [], files: [] });
  assert.deepEqual((await stickyPayload({ content: 'text', embed_template: 'rules' }, source)).embeds, [{ title: 'Rules' }], 'the saved embed wins');
  templates.set('g:v2', { content: undefined, embeds: [], components: [{ type: 17 }], files: [], flags: 32768 });
  assert.equal((await stickyPayload({ content: '', embed_template: 'v2' }, source)).flags, 32768, 'a V2 design keeps its flag');
  assert.deepEqual(await stickyPayload({ content: 'fallback', embed_template: 'gone' }, source), { content: 'fallback' }, 'a missing embed gives the text');
  assert.equal(await stickyPayload({ content: '', embed_template: 'gone' }, source), null, 'a missing embed and no text sends nothing');

  // The repost: the old one is deleted and the new one goes to the bottom.
  const deleted = [];
  const sent = [];
  const channel = {
    id: 'c', isTextBased: () => true,
    messages: { fetch: async (id) => ({ id, delete: async () => { deleted.push(id); } }) },
    send: async (payload) => { sent.push(payload); return { id: `new${sent.length}` }; },
  };
  const post = (over = {}) => ({ id: 'm1', author: { id: 'u', bot: false }, guild: { id: 'g' }, channel, member: null, ...over });
  sticky = { message_id: 'old', content: 'Rules', embed_template: 'rules' };
  await event.execute(post());
  assert.deepEqual(deleted, ['old']); assert.equal(sent.length, 1); assert.deepEqual(sent[0].embeds, [{ title: 'Rules' }]); assert.deepEqual(written, ['new1']);
  await event.execute(post({ id: 'new1' })); assert.equal(sent.length, 1, 'the sticky itself does not make another');
  await event.execute(post({ author: { id: 'b', bot: true } })); assert.equal(sent.length, 1, 'bots do not make another');
  sticky = { message_id: null, content: '', embed_template: 'gone' };
  await event.execute(post()); assert.equal(sent.length, 1, 'nothing is sent when there is nothing to send');
  void Collection;
  console.log('Checked the sticky messages: text, saved embeds, V2 designs, the fallback and the repost.');
})().catch((error) => { console.error(error); process.exit(1); });
