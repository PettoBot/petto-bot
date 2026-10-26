// AFK mentions: `/afk mentions` only shows the last three days, so once an hour what is older is deleted from the table (it would grow forever otherwise).
const afkDb = require('../db/afk');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const INTERVAL_MS = 60 * 60_000;

function startAfkMentionsJob() {
  const run = exclusiveTask(() => afkDb.deleteExpiredMentions());
  const tick = () => run().catch((error) => logger.error('AFK mentions cleanup job failed:', error));
  setTimeout(tick, 2 * 60_000).unref?.();
  setInterval(tick, INTERVAL_MS).unref?.();
}

module.exports = { startAfkMentionsJob };
