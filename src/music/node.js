// i18n-ignore-file: lines of the log; no message of Petto is written here.
// The connection to the Lavalink node (Pettolava). It has to be made before the bot logs in: Shoukaku waits for the `clientReady` event by itself.
const { Shoukaku, Connectors } = require('shoukaku');
const config = require('../config');
const logger = require('../utils/logger');

let shoukaku = null;
let lastWarn = 0;
const warn = (message) => { if (Date.now() - lastWarn > 60_000) { lastWarn = Date.now(); logger.warn(message); } };

/** Whether the bot has what it needs to talk to a node (host and password). */
const enabled = () => Boolean(config.lavalinkHost && config.lavalinkPassword);

function init(client) {
  if (shoukaku || !enabled()) return shoukaku;
  shoukaku = new Shoukaku(
    new Connectors.DiscordJS(client),
    [{ name: 'pettolava', url: `${config.lavalinkHost}:${config.lavalinkPort}`, auth: config.lavalinkPassword, secure: config.lavalinkSecure }],
    { moveOnDisconnect: true, resume: true, resumeTimeout: 60, reconnectTries: 30, reconnectInterval: 5_000, restTimeout: 15_000, userAgent: 'Petto/music' },
  );
  shoukaku.on('ready', (name, resumed) => logger.info(`Music: connected to the node ${name}${resumed ? ' (the session was resumed)' : ''}`));
  shoukaku.on('error', (name, error) => warn(`Music: the node ${name} failed: ${error?.message ?? error}`));
  shoukaku.on('close', (name, code, reason) => warn(`Music: the connection to the node ${name} closed (${code}${reason ? `: ${reason}` : ''})`));
  shoukaku.on('disconnect', (name) => warn(`Music: the node ${name} disconnected`));
  shoukaku.on('reconnecting', (name, left) => warn(`Music: reconnecting to the node ${name} (${left} tries left)`));
  return shoukaku;
}

const get = () => shoukaku;

/** The node to ask for songs, or undefined while none is connected. */
const idealNode = () => shoukaku?.getIdealNode();

/** The state of the node, for the commands of the team. */
function health() {
  if (!shoukaku) return { configured: enabled(), connected: false };
  const node = idealNode();
  return { configured: true, connected: Boolean(node), players: shoukaku.players.size };
}

module.exports = { enabled, init, get, idealNode, health };
