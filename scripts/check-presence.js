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

assert.equal(freshConfig().presenceStatus, 'idle', 'idle is the default');
assert.equal(freshConfig('dnd').presenceStatus, 'dnd');
assert.equal(freshConfig(' ONLINE ').presenceStatus, 'online', 'the value is read without spaces or capitals');
assert.equal(freshConfig('sleeping').presenceStatus, 'idle', 'an unknown value falls back to idle');
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

console.log('Checked the presence: idle by default, configurable, and the phone icon in the gateway identify.');
