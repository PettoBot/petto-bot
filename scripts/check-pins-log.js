// The pins event of Discord carries two values (the channel and the time of the last pin) and the handler adds the client after them,
// so the log gets the client and not the time ("Cannot read properties of undefined (reading 'username')").
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';

const received = [];
const resolved = require.resolve(path.join(__dirname, '..', 'src', 'logging', 'extraLog.js'));
require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { handleChannelPins: async (channel, client) => { received.push({ channel, client }); } } };

const event = require('../src/events/channelPinsUpdateLog');
const client = { user: { username: 'Petto' } };
const channel = { id: '1' };

(async () => {
  assert.equal(event.name, 'channelPinsUpdate');
  await event.execute(channel, new Date(), client);
  assert.equal(received.length, 1);
  assert.equal(received[0].client, client, 'the log gets the client, not the date');
  assert.equal(received[0].client.user.username, 'Petto');
  console.log('Checked the pins log gets the client.');
})().catch((err) => { console.error(err); process.exit(1); });
