// Checks the status of the bot in the member list: the dot (idle by default, from the environment) and the phone icon, which Discord reads
// from the names the bot gives when it connects.
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';

function freshConfig(status) {
  delete require.cache[require.resolve('../src/config')];
  if (status === undefined) delete process.env.PETTO_PRESENCE_STATUS;
  else process.env.PETTO_PRESENCE_STATUS = status;
  return require('../src/config');
}

assert.equal(freshConfig().presenceStatus, 'online', 'online (with the phone icon) is the default');
assert.equal(freshConfig('dnd').presenceStatus, 'dnd');
assert.equal(freshConfig(' ONLINE ').presenceStatus, 'online', 'the value is read without spaces or capitals');
assert.equal(freshConfig('sleeping').presenceStatus, 'online', 'an unknown value falls back to online');
assert.equal(freshConfig('idle').presenceStatus, 'idle');
delete process.env.PETTO_PRESENCE_STATUS;
assert.equal(freshConfig().mobileStatus, true, 'the phone icon is on by default');
process.env.PETTO_MOBILE_STATUS = 'false';
assert.equal(freshConfig().mobileStatus, false);
delete process.env.PETTO_MOBILE_STATUS;

const { applyMobileIdentify, mobileClientName, CLIENTS } = require('../src/utils/mobilePresence');
assert.equal(mobileClientName(), 'android', 'the Android app is the default');
assert.equal(mobileClientName('IOS'), 'ios');
assert.equal(mobileClientName('toaster'), 'android');
applyMobileIdentify('ios');
applyMobileIdentify();

// The gateway manager that the library builds reads those defaults when it identifies.
const { WebSocketManager } = require(require.resolve('@discordjs/ws', { paths: [require.resolve('discord.js')] }));
const { REST } = require('discord.js');
const manager = new WebSocketManager({ token: 'check-only', intents: 0, rest: new REST() });
assert.deepEqual({ ...manager.options.identifyProperties }, { ...CLIENTS.android });

// The status chosen from Discord is saved and applied, and the environment is the fallback.
const saved = new Map();
const settingsPath = require.resolve('../src/db/botSettings');
require.cache[settingsPath] = { id: settingsPath, filename: settingsPath, loaded: true, exports: {
  getSetting: async (key) => saved.get(key) ?? null,
  setSetting: async (key, value) => { saved.set(key, value); },
} };
delete require.cache[require.resolve('../src/config')];
delete require.cache[require.resolve('../src/utils/botPresence')];
const botPresence = require('../src/utils/botPresence');

(async () => {
  const applied = [];
  const client = { user: { setPresence: (presence) => applied.push(presence) } };
  assert.equal(await botPresence.currentStatus(), 'online');
  assert.equal(await botPresence.chooseStatus(client, ' IDLE '), 'idle');
  assert.equal(saved.get('presence_status'), 'idle');
  assert.equal(await botPresence.currentStatus(), 'idle', 'the saved status wins after a restart');
  assert.equal(applied.at(-1).status, 'idle');
  assert.equal(applied.at(-1).activities.length, 1, 'the custom status stays');
  await botPresence.chooseStatus(client, 'invisible');
  assert.deepEqual(applied.at(-1).activities, [], 'invisible has no custom status');
  await assert.rejects(() => botPresence.chooseStatus(client, 'sleepy'), /must be one of/);
  assert.equal(saved.get('presence_status'), 'invisible', 'a wrong value is not saved');
  require.cache[settingsPath].exports.getSetting = async () => { throw new Error('database down'); };
  assert.equal(await botPresence.currentStatus(), 'online', 'without the database the environment decides');
  console.log('Checked the presence: online with the phone icon by default, configurable and saved from Discord, and the gateway identify.');
})().catch((err) => { console.error(err); process.exit(1); });
