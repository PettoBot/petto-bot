// i18n-ignore-file: lines of the log; no message of Petto is written here.
// The connection to the Lavalink node (Pettolava). It has to be made before the bot logs in: Shoukaku waits for the `clientReady` event by itself.
const shoukakuLib = require('shoukaku');
const config = require('../config');
const logger = require('../utils/logger');

const NAME = 'pettolava';
const REVIVE_MS = 20_000; // how often it looks whether the node is still in the pool
let shoukaku = null;
let nodeOptions = null;
let timer = null;
let lastWarn = 0;
const warn = (message) => { if (Date.now() - lastWarn > 60_000) { lastWarn = Date.now(); logger.warn(message); } };

/** Whether the bot has what it needs to talk to a node (host and password). */
const enabled = () => Boolean(config.lavalinkHost && config.lavalinkPassword);

/**
 * Shoukaku tries to reconnect a number of times and then DROPS the node from its pool for good: a node that restarts (Lavalink takes about a minute and a half to start)
 * after the tries ran out would never be used again until the bot restarted. This puts it back whenever it is missing.
 */
function revive() {
  if (!shoukaku || !nodeOptions || shoukaku.nodes.has(NAME)) return false;
  logger.info('Music: the node is not in the pool any more: connecting to it again'); // i18n-ignore: a line of the log
  shoukaku.addNode(nodeOptions);
  return true;
}

function init(client, { lib = shoukakuLib, reviveMs = REVIVE_MS } = {}) {
  if (shoukaku || !enabled()) return shoukaku;
  nodeOptions = { name: NAME, url: `${config.lavalinkHost}:${config.lavalinkPort}`, auth: config.lavalinkPassword, secure: config.lavalinkSecure };
  shoukaku = new lib.Shoukaku(
    new lib.Connectors.DiscordJS(client),
    [nodeOptions],
    { moveOnDisconnect: true, resume: true, resumeTimeout: 60, reconnectTries: 30, reconnectInterval: 5_000, restTimeout: 15_000, userAgent: 'Petto/music' },
  );
  shoukaku.on('ready', (name, resumed) => logger.info(`Music: connected to the node ${name}${resumed ? ' (the session was resumed)' : ''}`));
  shoukaku.on('error', (name, error) => warn(`Music: the node ${name} failed: ${error?.message ?? error}`));
  shoukaku.on('close', (name, code, reason) => warn(`Music: the connection to the node ${name} closed (${code}${reason ? `: ${reason}` : ''})`));
  shoukaku.on('disconnect', (name) => { warn(`Music: the node ${name} disconnected`); setTimeout(revive, 3_000).unref?.(); });
  shoukaku.on('reconnecting', (name, left) => warn(`Music: reconnecting to the node ${name} (${left} tries left)`));
  timer = setInterval(revive, reviveMs);
  timer.unref?.();
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

/** For the checks. */
const stop = () => { clearInterval(timer); timer = null; shoukaku = null; nodeOptions = null; };

module.exports = { enabled, init, get, idealNode, health, revive, stop };
