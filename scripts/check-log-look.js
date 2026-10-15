// The logs sent through a webhook carry the look the server gave Petto (its name and picture in that server), and the global ones
// when the server gave none. Also: the whole path of a log, with a fake webhook, ends with that name and picture in the request.
const assert = require('node:assert/strict');
const path = require('node:path');
function stub(relative, exports) { const resolved = require.resolve(path.join(__dirname, '..', relative)); require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }; }
const config = { entries: [{ event: 'moderation', channel_id: 'C1', color: null }], webhooks: [{ channel_id: 'C1', webhook_id: 'W1', webhook_token: 'tok' }], ignored: [] };
stub('src/config.js', { dashboard: {}, web: {} });
stub('src/utils/logger.js', { info() {}, error() {}, warn() {} });
stub('src/db/logConfig.js', { EVENTS: ['moderation'], getLogConfig: async () => config, deleteWebhookById: async () => {}, removeEntries: async () => {} });
const { botLook, sendLog } = require('../src/logging/engine');

const globalUser = { username: 'Petto', displayAvatarURL: () => 'https://cdn.test/global.png' };
const clientWith = (me, posts = []) => ({ user: globalUser, guilds: { cache: new Map([['G1', { members: { me } }]]) }, rest: { post: async (route, options) => { posts.push({ route, options }); } } });

(async () => {
  // A server that gave Petto its own name and picture.
  const custom = { displayName: 'Pixel', displayAvatarURL: () => 'https://cdn.test/server-pixel.png' };
  assert.deepEqual(botLook(clientWith(custom), 'G1'), { username: 'Pixel', avatar_url: 'https://cdn.test/server-pixel.png' });
  // A server that gave nothing: the member has no own name, so the global one is used (the member's display picture is the global one then).
  assert.deepEqual(botLook(clientWith({ displayName: 'Petto', displayAvatarURL: () => 'https://cdn.test/global.png' }), 'G1'), { username: 'Petto', avatar_url: 'https://cdn.test/global.png' });
  // Not in that server's cache: the global look.
  assert.deepEqual(botLook(clientWith(null), 'G9'), { username: 'Petto', avatar_url: 'https://cdn.test/global.png' });
  assert.deepEqual(botLook({ user: globalUser, guilds: { cache: new Map() } }, 'G1'), { username: 'Petto', avatar_url: 'https://cdn.test/global.png' });
  // Discord refuses a webhook name with "discord" or "clyde" in it.
  assert.equal(botLook(clientWith({ displayName: 'My Discord Bot', displayAvatarURL: () => 'https://cdn.test/x.png' }), 'G1').username, 'Petto');
  assert.equal(botLook(clientWith({ displayName: 'Clyde Jr', displayAvatarURL: () => null }), 'G1').avatar_url, 'https://cdn.test/global.png');
  assert.equal(botLook(clientWith({ displayName: 'x'.repeat(200), displayAvatarURL: () => null }), 'G1').username.length, 80);

  // The log that is sent carries it.
  const posts = [];
  await sendLog(clientWith(custom, posts), 'G1', 'moderation', { description: 'A ban' });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].options.body.username, 'Pixel');
  assert.equal(posts[0].options.body.avatar_url, 'https://cdn.test/server-pixel.png');
  console.log('Checked the look of the logs sent through a webhook.');
})().catch((err) => { console.error(err); process.exit(1); });
