// Feeds: every few seconds the engine looks at which accounts are due (see feeds/engine.js), and once a day what was posted long ago is forgotten.
const feedsDb = require('../db/feeds');
const engine = require('../feeds/engine');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');
const websub = require('../feeds/websub');
const youtube = require('../feeds/providers/youtube');
const config = require('../config');
const { restoreYoutubeState } = require('../feeds/providers');

// A pass costs almost nothing when no account is due, and an account that is asked every minute is due again a little after one (its next turn carries a few seconds
// of spread), so with a pass every minute it was asked every two. Every 15 seconds each one is asked when its turn comes.
const TICK_MS = 15_000;
const DAY_MS = 24 * 60 * 60_000;

const WEBSUB_MS = 5 * 60_000;
const REPORT_MS = 60 * 60_000;
let runSoon = () => {};

function startFeedsJob(client) {
  const run = exclusiveTask(() => engine.tick(client, { passMs: TICK_MS }));
  const tick = () => run().catch((error) => logger.error('Feeds job failed:', error));
  runSoon = tick;
  // YouTube push: the channels are subscribed (and renewed) in the background; when YouTube says a channel has news, it is looked at at once.
  if (websub.enabled()) {
    websub.setWake((channelId) => { engine.wake('youtube', channelId); runSoon(); });
    const upkeep = async () => {
      try { await websub.maintain(); } catch (error) { logger.warn(`YouTube push: the upkeep failed: ${error.message}`); }
    };
    websub.load().catch((error) => logger.warn(`YouTube push: could not read the subscriptions: ${error.message}`)).then(() => setTimeout(upkeep, 60_000).unref?.());
    setInterval(upkeep, WEBSUB_MS).unref?.();
    const report = async () => {
      try {
        const { followed, healthy } = await websub.maintain({ now: Date.now() });
        logger.info(`YouTube: ${healthy} of ${followed} followed channels reach the bot by push; the rest are looked at every few minutes. The key has used ${youtube.quotaUsed()} of ${config.youtubeDailyQuota} units today.`);
      } catch { /* the next hour */ }
    };
    setTimeout(report, 5 * 60_000).unref?.();
    setInterval(report, REPORT_MS).unref?.();
  }
  // After the bot has its servers (and its Redis, if there is one), what it had learned about the YouTube videos is read back and the first pass is made.
  setTimeout(() => { restoreYoutubeState().catch(() => {}).then(tick); }, 45_000).unref?.();
  setInterval(tick, TICK_MS).unref?.();
  const prune = () => feedsDb.pruneOld().catch((error) => logger.error('Feeds cleanup failed:', error));
  setTimeout(prune, 10 * 60_000).unref?.();
  setInterval(prune, DAY_MS).unref?.();
}

module.exports = { startFeedsJob };
