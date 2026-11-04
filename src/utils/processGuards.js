// i18n-ignore-file: internal guards of the process (logs).
// What keeps the bot alive when something unexpected happens, and stops it cleanly when it cannot go on:
//   - an unhandled rejection or an uncaught exception that is only a failed request (Discord, the network, the database, a timeout, an abort) is
//     logged and the bot goes on; anything else is logged and the process stops cleanly (the host starts it again), unless it already restarted too
//     many times in the last hour;
//   - the events of the connection to Discord are handled one by one (logged and counted; discord.js reconnects by itself); only `invalidated`, a
//     session that Discord closed for good, stops the process.
const logger = require('./logger');
const { isPermissionError } = require('./permissionErrors');

const counts = { rejections: 0, rejectionsIgnored: 0, exceptions: 0, exceptionsIgnored: 0, shardDisconnect: 0, shardError: 0, shardReconnecting: 0, shardResume: 0, clientError: 0, invalidated: 0 };
const recentGateway = []; // { at, event, detail }

const TRANSIENT_NAMES = /^(DiscordAPIError|HTTPError|RateLimitError|RestGateError|AbortError|TimeoutError|DiscordjsError|ConnectTimeoutError|SocketError|FetchError|AggregateError)$/;
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'ABORT_ERR', 'ERR_STREAM_PREMATURE_CLOSE', '57P01', '57P03', '08006', '08003', '53300', 'PETTO_REST_WAIT_TIMEOUT', 'PETTO_REST_QUEUE_FULL', 'PETTO_REST_SHED']);
const TRANSIENT_TEXT = /timed out|timeout|aborted|socket hang up|connection terminated|connection error|terminating connection|too many clients|rate limit|ECONNRESET|ETIMEDOUT|network|fetch failed/i;

/** Whether an error is only a failed request or a hiccup of the network or the database: the process can go on. */
function isNonFatal(error) {
  if (error == null) return true;
  if (isPermissionError(error)) return true;
  const name = String(error?.name ?? error?.constructor?.name ?? '');
  if (TRANSIENT_NAMES.test(name)) return true;
  if (TRANSIENT_CODES.has(String(error?.code ?? ''))) return true;
  if (typeof error?.status === 'number' && error.status >= 400) return true;
  return TRANSIENT_TEXT.test(String(error?.message ?? error));
}

function noteGateway(event, detail = '') {
  recentGateway.push({ at: Date.now(), event, detail: String(detail).slice(0, 160) });
  if (recentGateway.length > 50) recentGateway.shift();
}

/** Installs the handlers of the process. `exit(reason)` stops it cleanly; `canExit()` says if a restart is still allowed (the watchdog counts them). */
function installProcessGuards({ exit, canExit = () => true, proc = process } = {}) {
  proc.on('unhandledRejection', (error) => {
    counts.rejections += 1;
    if (isPermissionError(error)) { logger.warn(`Missing permission (unhandled): ${error.message} (code ${error.code})`); counts.rejectionsIgnored += 1; return; }
    if (isNonFatal(error)) { counts.rejectionsIgnored += 1; logger.warn(`Unhandled rejection that is only a failed request: ${error?.message ?? error}`); return; }
    logger.error('Unhandled promise rejection:', error);
  });
  proc.on('uncaughtException', (error) => {
    counts.exceptions += 1;
    if (isNonFatal(error)) { counts.exceptionsIgnored += 1; logger.warn(`Uncaught exception that is only a failed request, the bot goes on: ${error?.message ?? error}`); return; }
    logger.error('Uncaught exception:', error);
    if (!canExit()) { logger.error('[watchdog] The bot would restart for this exception but already restarted too many times in the last hour: it keeps running.'); return; }
    Promise.resolve(exit?.(`uncaught exception: ${error?.message ?? error}`)).catch(() => proc.exit(1));
  });
}

/** The events of the connection to Discord, one by one. */
function installGatewayGuards(client, { exit } = {}) {
  client.on('shardDisconnect', (event, shardId) => { counts.shardDisconnect += 1; noteGateway('shardDisconnect', `shard ${shardId} code ${event?.code}`); logger.warn(`Shard ${shardId} disconnected (code ${event?.code}); discord.js reconnects by itself.`); });
  client.on('shardError', (error, shardId) => { counts.shardError += 1; noteGateway('shardError', `shard ${shardId} ${error?.message}`); logger.warn(`Shard ${shardId} error: ${error?.message ?? error}`); });
  client.on('shardReconnecting', (shardId) => { counts.shardReconnecting += 1; noteGateway('shardReconnecting', `shard ${shardId}`); });
  client.on('shardResume', (shardId, replayed) => { counts.shardResume += 1; noteGateway('shardResume', `shard ${shardId}, ${replayed} events replayed`); });
  client.on('error', (error) => { counts.clientError += 1; noteGateway('error', error?.message); logger.warn(`Client error: ${error?.message ?? error}`); });
  client.on('invalidated', () => {
    counts.invalidated += 1;
    noteGateway('invalidated');
    logger.error('[gateway] Discord invalidated the session of the bot. The process stops so the host starts it again.');
    Promise.resolve(exit?.('session invalidated')).catch(() => process.exit(1));
  });
}

const stats = () => ({ ...counts, recentGateway: recentGateway.slice(-10) });

module.exports = { isNonFatal, installProcessGuards, installGatewayGuards, stats };
