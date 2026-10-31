// i18n-ignore-file: the device the bot connects as is the same for every server, and its admin command is team-only.
// The device Petto names when it connects to Discord: `normal` (the library's own names, a plain green dot), `phone` (the app chosen in
// PETTO_MOBILE_CLIENT, Android by default), `android` or `ios`. The choice is saved in `bot_settings` and wins over PETTO_MOBILE_STATUS;
// with nothing saved the environment decides as it always did. Discord reads the names once, when the bot connects, so a change takes a
// reconnection: the process is restarted and the host starts it again.
const config = require('../config');
const botSettings = require('../db/botSettings');
const logger = require('./logger');
const { mobileClientName, applyMobileIdentify, applyNormalIdentify } = require('./mobilePresence');

const DEVICES = ['normal', 'phone', 'android', 'ios'];
const ALIASES = { default: 'normal', desktop: 'normal', mobile: 'phone' };
const SETTING_KEY = 'presence_device';
// How long the answer has to be delivered before the process stops.
const RESTART_DELAY_MS = 3_000;

/** `normal`, `phone`, `android` or `ios` from what was typed (`default` and `desktop` are normal, `mobile` is phone), or null. */
function normalizeDevice(value) {
  const word = String(value ?? '').trim().toLowerCase();
  const device = ALIASES[word] ?? word;
  return DEVICES.includes(device) ? device : null;
}

/** The device the environment asks for: the phone app with PETTO_MOBILE_STATUS on (the default), normal with it off. */
function envDevice(mobileStatus = config.mobileStatus) {
  return mobileStatus ? 'phone' : 'normal';
}

/** What the bot really connects as for a device: `normal`, `android` or `ios` (`phone` is the client of PETTO_MOBILE_CLIENT). */
function identityOf(device, clientName = process.env.PETTO_MOBILE_CLIENT) {
  return device === 'phone' ? mobileClientName(clientName) : device;
}

let warnedAboutDatabase = false;
/** The saved device, or null with nothing saved. Throws when the database cannot be read. */
async function savedDevice() {
  return normalizeDevice(await botSettings.getSetting(SETTING_KEY));
}

/** The device in use: the saved one, else the environment's. A database that cannot be read is logged once and the environment decides. */
async function currentDevice() {
  try {
    const saved = await savedDevice();
    if (saved) return { device: saved, source: 'saved' };
  } catch (error) {
    if (!warnedAboutDatabase) {
      warnedAboutDatabase = true;
      logger.warn(`Could not read the saved device of the bot (${error.message}); the environment decides.`);
    }
  }
  return { device: envDevice(), source: 'environment' };
}

/** Sets the names the gateway library sends when it identifies. */
function applyDevice(device) {
  if (device === 'normal') return applyNormalIdentify();
  return applyMobileIdentify(identityOf(device));
}

/**
 * At startup, before the login: a saved device wins over PETTO_MOBILE_STATUS. With nothing saved, or a database that cannot be read, the
 * environment keeps deciding (it was applied before the client was created) and the boot goes on.
 */
async function applySavedDevice() {
  const { device, source } = await currentDevice();
  if (source !== 'saved') return null;
  applyDevice(device);
  return device;
}

/**
 * Saves a device the team chose (only when it differs from what is saved) and says whether the bot has to reconnect: it does when the
 * names it sends change (`phone` and `android` are the same names while PETTO_MOBILE_CLIENT is android).
 */
async function chooseDevice(requested) {
  const device = normalizeDevice(requested);
  if (!device) throw new Error(`The device must be one of: ${DEVICES.join(', ')} (also default, desktop and mobile).`);
  const before = await currentDevice();
  if (before.source !== 'saved' || before.device !== device) await botSettings.setSetting(SETTING_KEY, device);
  return { device, previous: before.device, restart: identityOf(device) !== identityOf(before.device) };
}

function stopProcess() {
  logger.info('Restarting so the bot connects with a new device.');
  // The same way the host stops it: index.js flushes, says offline in Omniplex, closes the database pools and exits.
  process.kill(process.pid, 'SIGTERM');
}

let restartHandler = stopProcess;
let restartDelayMs = RESTART_DELAY_MS;
/** For a check: what runs when the bot has to restart, and after how long. Called with nothing, it puts the real ones back. */
function setRestartHandler(handler, delayMs = RESTART_DELAY_MS) {
  restartHandler = handler ?? stopProcess;
  restartDelayMs = delayMs;
}

/**
 * Sets the names for the next connection and, after a few seconds (so the answer is delivered first), restarts the process.
 * Returns the timer so a check can wait for it.
 */
function reconnectWith(device) {
  applyDevice(device);
  return setTimeout(() => {
    try { restartHandler(); } catch (error) { logger.error('Could not restart for the new device:', error); }
  }, restartDelayMs);
}

module.exports = {
  DEVICES,
  SETTING_KEY,
  RESTART_DELAY_MS,
  normalizeDevice,
  envDevice,
  identityOf,
  currentDevice,
  applyDevice,
  applySavedDevice,
  chooseDevice,
  setRestartHandler,
  reconnectWith,
};
