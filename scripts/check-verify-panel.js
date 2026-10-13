// Checks the verification panel job: it follows the dashboard (new channel, cleared channel, failure) without the real database or Discord.
const assert = require('node:assert/strict');
const path = require('node:path');
function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const calls = [];
let rows = [];
stub('src/db/verificationConfig.js', { listWithPanel: async () => rows, upsertConfig: async (id, patch) => { calls.push(['save', id, patch]); } });
stub('src/utils/verifyPanel.js', {
  postPanel: async (guild, settings, channel) => { if (!channel) throw new Error('no channel'); calls.push(['post', channel.id]); },
  removePanel: async (guild, settings) => { calls.push(['remove', settings.panel_posted_channel_id]); },
});
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
const { processPanels } = require('../src/jobs/verifyPanelJob');
const client = { guilds: { cache: new Map([['g', { id: 'g', channels: { fetch: async (id) => (id === 'bad' ? null : { id }) } }]]) } };

(async () => {
  rows = [{ guild_id: 'g', panel_channel_id: 'c1', panel_posted_channel_id: null, panel_message_id: null }];
  await processPanels(client);
  assert.deepEqual(calls.splice(0), [['post', 'c1']], 'a channel picked in the dashboard gets its panel');

  rows = [{ guild_id: 'g', panel_channel_id: 'c1', panel_posted_channel_id: 'c1', panel_message_id: 'm' }];
  await processPanels(client);
  assert.deepEqual(calls.splice(0), [], 'a panel that stands is left alone');

  rows = [{ guild_id: 'g', panel_channel_id: 'c1', panel_posted_channel_id: 'c1', panel_message_id: null }];
  await processPanels(client);
  assert.deepEqual(calls.splice(0), [['post', 'c1']], 'asking to post again (no message) posts it again');

  rows = [{ guild_id: 'g', panel_channel_id: null, panel_posted_channel_id: 'c1', panel_message_id: 'm' }];
  await processPanels(client);
  assert.deepEqual(calls.splice(0), [['remove', 'c1'], ['save', 'g', { panel_message_id: null, panel_posted_channel_id: null }]], 'a cleared channel takes the panel away');

  rows = [{ guild_id: 'g', panel_channel_id: 'bad', panel_posted_channel_id: 'c1', panel_message_id: 'm' }];
  await processPanels(client);
  assert.deepEqual(calls.splice(0), [['save', 'g', { panel_channel_id: 'c1' }]], 'a failure goes back to the panel that stands');
  console.log('Checked the verification panel job: post, keep, repost, remove and failure.');
})().catch((e) => { console.error(e); process.exit(1); });
