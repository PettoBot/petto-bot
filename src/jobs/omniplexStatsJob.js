// i18n-ignore-file: stats for the Omniplex bot list (logs only).
// Omniplex shows the server count and the status of a bot from what the bot posts itself (it does not read the gateway), so Petto posts
// them when it starts, every few minutes after that, and "offline" when it shuts down.
const config = require('../config');
const logger = require('../utils/logger');
const { currentStatus } = require('../utils/botPresence');

const STATS_URL = 'https://api.omniplex.gg/bots/stats';
const INTERVAL_MS = 10 * 60_000;
const TIMEOUT_MS = 10_000;

let timer = null;
let lastError = null;

// Omniplex knows online, idle, dnd and offline; Petto set to invisible looks offline to everyone, so it is posted as offline.
const listStatus = (status) => (['online', 'idle', 'dnd'].includes(status) ? status : 'offline');

function statsOf(client, status) {
  const guilds = client.guilds.cache;
  let users = 0;
  for (const guild of guilds.values()) users += guild.memberCount ?? 0;
  const shardList = [...client.ws.shards.keys()];
  return {
    servers: guilds.size,
    shards: client.shard?.count ?? Math.max(shardList.length, 1),
    users,
    shard_list: shardList.length ? shardList : [0],
    status: listStatus(status),
  };
}

async function postStats(client, status, fetchImpl = fetch) {
  if (!config.omniplexToken) return false;
  const res = await fetchImpl(STATS_URL, {
    method: 'POST',
    headers: { Authorization: `Bot ${config.omniplexToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(statsOf(client, status)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Omniplex answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return true;
}

async function postNow(client) {
  try {
    await postStats(client, await currentStatus());
    if (lastError) logger.info('Omniplex stats are posted again.');
    lastError = null;
  } catch (err) {
    // The same failure is logged once, not every ten minutes.
    const message = err?.message ?? String(err);
    if (message !== lastError) logger.warn(`Could not post the stats to Omniplex: ${message}`);
    lastError = message;
  }
}

function startOmniplexStatsJob(client) {
  if (!config.omniplexToken || timer) return;
  postNow(client);
  timer = setInterval(() => postNow(client), INTERVAL_MS);
  timer.unref?.();
}

/** On shutdown: the listing shows Petto offline at once instead of keeping "online" until the next post. */
async function postOffline(client) {
  if (!config.omniplexToken) return;
  if (timer) clearInterval(timer);
  timer = null;
  await postStats(client, 'offline').catch((err) => logger.warn(`Could not post the offline status to Omniplex: ${err?.message ?? err}`));
}

module.exports = { startOmniplexStatsJob, postOffline, postStats, statsOf, listStatus };
