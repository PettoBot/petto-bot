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

const { applyMobileIdentify, applyNormalIdentify, currentIdentify, mobileClientName, CLIENTS } = require('../src/utils/mobilePresence');
const REAL_DEFAULTS = { ...currentIdentify() }; // what the library sends by itself, before anything is changed
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

  // ---------------------------------------------------------------------------------------------------------------------
  // The device (`!botstatus device ...`): what it accepts, what wins at startup, and when the bot restarts.
  // ---------------------------------------------------------------------------------------------------------------------
  const botDevice = require('../src/utils/botDevice');
  const logger = require('../src/utils/logger');
  const { MessageFlags } = require('discord.js');
  const { parseOptions } = require('../src/handlers/prefixInteraction');
  const botstatus = require('../src/commands/utility/botstatus');
  const identify = () => currentIdentify();
  const warned = [];
  const realWarn = logger.warn;
  logger.warn = (...args) => { warned.push(args.join(' ')); };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  require.cache[settingsPath].exports.getSetting = async (key) => saved.get(key) ?? null; // the database is back

  // The words: normal, phone, android, ios, and the aliases default and desktop (normal) and mobile (phone).
  for (const [typed, device] of [['normal', 'normal'], ['DEFAULT', 'normal'], ['desktop', 'normal'], ['phone', 'phone'], ['mobile', 'phone'], [' Android ', 'android'], ['ios', 'ios']]) {
    assert.equal(botDevice.normalizeDevice(typed), device, typed);
  }
  for (const wrong of ['', null, undefined, 'toaster', 'online', 'tablet']) assert.equal(botDevice.normalizeDevice(wrong), null);
  assert.equal(botDevice.envDevice(true), 'phone');
  assert.equal(botDevice.envDevice(false), 'normal');
  assert.equal(botDevice.identityOf('phone', 'ios'), 'ios', 'phone is the client of PETTO_MOBILE_CLIENT');
  assert.equal(botDevice.identityOf('phone', undefined), 'android');
  assert.equal(botDevice.identityOf('ios', 'android'), 'ios', 'ios forces ios');

  // The identify properties: normal puts back what the library had, phone and ios set their own names.
  botDevice.applyDevice('ios');
  assert.deepEqual(identify(), { ...CLIENTS.ios });
  botDevice.applyDevice('android');
  assert.deepEqual(identify(), { ...CLIENTS.android });
  botDevice.applyDevice('phone');
  assert.deepEqual(identify(), { ...CLIENTS[mobileClientName()] });
  botDevice.applyDevice('normal');
  assert.deepEqual(identify(), REAL_DEFAULTS, 'normal restores the library defaults');
  assert.notEqual(REAL_DEFAULTS.device, CLIENTS.android.device);
  applyNormalIdentify();
  assert.deepEqual(identify(), REAL_DEFAULTS, 'and restoring twice changes nothing');

  // At startup: the saved device wins over the environment; with nothing saved, or no database, the environment keeps deciding.
  saved.delete('presence_device');
  applyMobileIdentify(); // what index.js does first, with PETTO_MOBILE_STATUS on
  assert.equal(await botDevice.applySavedDevice(), null, 'nothing saved: the environment decides');
  assert.deepEqual(identify(), { ...CLIENTS.android }, 'and the phone names stay');
  assert.deepEqual(await botDevice.currentDevice(), { device: botDevice.envDevice(), source: 'environment' });
  saved.set('presence_device', 'normal');
  assert.equal(await botDevice.applySavedDevice(), 'normal', 'a saved device wins over PETTO_MOBILE_STATUS being on');
  assert.deepEqual(identify(), REAL_DEFAULTS);
  saved.set('presence_device', 'ios');
  assert.equal(await botDevice.applySavedDevice(), 'ios', 'and over it being off');
  assert.deepEqual(identify(), { ...CLIENTS.ios });
  saved.set('presence_device', 'nonsense');
  assert.equal(await botDevice.applySavedDevice(), null, 'a value that means nothing is ignored');
  const getSetting = require.cache[settingsPath].exports.getSetting;
  require.cache[settingsPath].exports.getSetting = async () => { throw new Error('database down'); };
  warned.length = 0;
  assert.equal(await botDevice.applySavedDevice(), null, 'no database: the environment decides and the boot goes on');
  assert.equal((await botDevice.currentDevice()).source, 'environment');
  await botDevice.currentDevice();
  assert.equal(warned.filter((line) => line.includes('saved device')).length, 1, 'the failure is logged once');
  require.cache[settingsPath].exports.getSetting = getSetting;

  // The words after `status` in a prefix command: `!botstatus device phone` reaches the command as status "device" and device "phone".
  const defs = botstatus.data.toJSON().options;
  const parsed = (words) => parseOptions({}, defs, words, {});
  assert.deepEqual(await parsed(['device', 'phone']), { status: 'device', device: 'phone' });
  assert.deepEqual(await parsed(['idle']), { status: 'idle' });
  assert.deepEqual(await parsed(['phone']), { status: 'phone' });
  assert.deepEqual(await parsed(['--device', 'ios']), { device: 'ios' });
  assert.deepEqual(await parsed(['online', 'normal']), { status: 'online', device: 'normal' });

  // The command, with a fake interaction: it answers first, saves only a change, and restarts only when the names change.
  const events = [];
  const answers = [];
  const operator = require('../src/config').ownerId;
  const run = async (values, userId = operator) => {
    const interaction = {
      user: { id: userId },
      client: client,
      options: { getString: (name) => values[name] ?? null },
      reply: async (payload) => { answers.push(JSON.stringify(payload)); events.push('reply'); },
    };
    await botstatus.execute(interaction);
    await sleep(30);
    return answers.at(-1);
  };
  botDevice.setRestartHandler(() => events.push('restart'), 5);
  let setCalls = 0;
  const setSetting = require.cache[settingsPath].exports.setSetting;
  require.cache[settingsPath].exports.setSetting = async (key, value) => { if (key === 'presence_device') setCalls += 1; return setSetting(key, value); };

  saved.delete('presence_device');
  applyMobileIdentify();
  // From the phone (the environment) to ios: saved, answered, then restarted with the new names.
  events.length = 0;
  let answer = await run({ status: 'device', device: 'ios' });
  assert.equal(saved.get('presence_device'), 'ios');
  assert.deepEqual(events, ['reply', 'restart'], 'the answer goes before the restart');
  assert.ok(answer.includes('restarts'), 'and it says what will happen');
  assert.deepEqual(identify(), { ...CLIENTS.ios }, 'the new names are set for the connection that follows');
  // The same device again: nothing is saved again, nothing restarts.
  events.length = 0;
  setCalls = 0;
  answer = await run({ status: 'device', device: 'ios' });
  assert.equal(setCalls, 0, 'saved only when it changes');
  assert.deepEqual(events, ['reply'], 'an unchanged device does not restart');
  assert.ok(answer.includes('nothing restarts'));
  // `normal` restores the library names and restarts.
  events.length = 0;
  await run({ status: 'device', device: 'default' });
  assert.equal(saved.get('presence_device'), 'normal');
  assert.deepEqual(events, ['reply', 'restart']);
  assert.deepEqual(identify(), REAL_DEFAULTS);
  // `phone` and `android` are the same names while PETTO_MOBILE_CLIENT is android: the choice is saved, nothing restarts between them.
  events.length = 0;
  await run({ status: 'phone' });
  assert.deepEqual(events, ['reply', 'restart']);
  events.length = 0;
  await run({ status: 'device', device: 'android' });
  assert.equal(saved.get('presence_device'), 'android');
  assert.deepEqual(events, ['reply'], 'phone to android is the same connection');
  // A wrong word is told and saves nothing.
  events.length = 0;
  setCalls = 0;
  answer = await run({ status: 'device', device: 'toaster' });
  assert.ok(answer.includes('must be one of') && setCalls === 0 && !events.includes('restart'));
  // Nobody but the team.
  events.length = 0;
  setCalls = 0;
  answer = await run({ status: 'device', device: 'normal' }, '1');
  assert.ok(answer.includes('not available') && setCalls === 0 && !events.includes('restart'));
  // Alone, it shows the dot and the device, and the dot's label only claims the phone icon when the device is not normal.
  saved.set('presence_status', 'online');
  saved.set('presence_device', 'normal');
  answer = await run({});
  assert.ok(answer.includes('Normal (no phone icon)') && !answer.includes('with the phone icon'));
  saved.set('presence_device', 'ios');
  answer = await run({});
  assert.ok(answer.includes('iOS app') && answer.includes('with the phone icon'));
  assert.ok(answer.includes('`!botstatus device'), 'the hint says how to change the device');
  assert.equal(botstatus.statusLabel('online', 'normal'), 'Online (green dot)');
  assert.ok(MessageFlags.Ephemeral, 'the answer is private');
  assert.ok(JSON.parse(answer).flags & MessageFlags.Ephemeral);
  require.cache[settingsPath].exports.setSetting = setSetting;

  // The real restart: the process is told to stop the way the host does it (index.js flushes and exits on SIGTERM), once, after the delay.
  const kills = [];
  const realKill = process.kill;
  process.kill = (pid, signal) => { kills.push([pid, signal]); return true; };
  botDevice.setRestartHandler(null, 5);
  botDevice.reconnectWith('normal');
  await sleep(30);
  process.kill = realKill;
  assert.deepEqual(kills, [[process.pid, 'SIGTERM']]);
  botDevice.setRestartHandler();
  applyMobileIdentify();
  logger.warn = realWarn;
  console.log('Checked the presence: online with the phone icon by default, configurable and saved from Discord, the gateway identify, and the device the team chooses.');
})().catch((err) => { console.error(err); process.exit(1); });
