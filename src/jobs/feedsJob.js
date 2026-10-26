// Feeds: every minute the engine looks at which accounts are due (see feeds/engine.js), and once a day what was posted long ago is forgotten.
const feedsDb = require('../db/feeds');
const engine = require('../feeds/engine');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const TICK_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;

function startFeedsJob(client) {
  const run = exclusiveTask(() => engine.tick(client));
  const tick = () => run().catch((error) => logger.error('Feeds job failed:', error));
  setTimeout(tick, 45_000).unref?.(); // after the bot has its servers
  setInterval(tick, TICK_MS).unref?.();
  const prune = () => feedsDb.pruneOld().catch((error) => logger.error('Feeds cleanup failed:', error));
  setTimeout(prune, 10 * 60_000).unref?.();
  setInterval(prune, DAY_MS).unref?.();
}

module.exports = { startFeedsJob };
