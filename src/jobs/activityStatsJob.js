const { queueActivity } = require('../db/activityStats');
const logger = require('../utils/logger');
const config = require('../config');
const { forEachWithConcurrency, exclusiveTask } = require('../utils/concurrency');

const POLL_INTERVAL_MS = 60_000;
const SECONDS_PER_TICK = 60;

function processGuild(guild) {
  for (const channel of guild.channels.cache.values()) {
    if (!channel.isVoiceBased?.() || channel.id === guild.afkChannelId) continue;

    const humanCount = [...channel.members.values()].filter((m) => !m.user.bot).length;
    if (humanCount === 0) continue;

    queueActivity(guild.id, channel.id, { voiceSeconds: SECONDS_PER_TICK * humanCount });
  }

  return undefined;
}

function startActivityStatsJob(client) {
  const run = exclusiveTask(() => forEachWithConcurrency(client.guilds.cache.values(), (guild) => (
    processGuild(guild).catch((err) => logger.error(`Activity stats job failed for guild ${guild.id}:`, err))
  ), config.jobConcurrency));
  setInterval(() => run().catch((err) => logger.error('Activity stats job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Activity stats job started (checking every 60s).');
}

module.exports = { startActivityStatsJob };
