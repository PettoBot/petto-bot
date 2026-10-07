// Makes the bot connect to the gateway as the phone app, so the member list shows the phone icon next to its status dot.
// Discord decides that from the `os`, `browser` and `device` the bot names when it identifies; the library does not let a bot choose them
// (it sends its own name), so the defaults the gateway library reads are changed before the client is created.
const CLIENTS = {
  android: { os: 'Android', browser: 'Discord Android', device: 'Discord Android' },
  ios: { os: 'iOS', browser: 'Discord iOS', device: 'Discord iOS' },
};

function gatewayLibrary() {
  return require(require.resolve('@discordjs/ws', { paths: [require.resolve('discord.js')] }));
}

/** `android` (default) or `ios`, from PETTO_MOBILE_CLIENT. */
function mobileClientName(value = process.env.PETTO_MOBILE_CLIENT) {
  const name = String(value || '').trim().toLowerCase();
  return CLIENTS[name] ? name : 'android';
}

function applyMobileIdentify(name = mobileClientName()) {
  const properties = gatewayLibrary().DefaultWebSocketManagerOptions.identifyProperties;
  Object.assign(properties, CLIENTS[name]);
  return { ...properties };
}

/** What the bot names when it connects, for the log. */
function currentIdentify() {
  return { ...gatewayLibrary().DefaultWebSocketManagerOptions.identifyProperties };
}

module.exports = { CLIENTS, mobileClientName, applyMobileIdentify, currentIdentify };
