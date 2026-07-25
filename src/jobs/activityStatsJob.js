const { incrementActivity } = require('../db/activityStats');
const logger = require('../utils/logger');

const POLL_INTERVAL_MS = 60_000;
const SECONDS_PER_TICK = 60;

function processGuild(guild) {
  const increments = [];

  for (const channel of guild.channels.cache.values()) {
    if (!channel.isVoiceBased?.() || channel.id === guild.afkChannelId) continue;

    const humanCount = [...channel.members.values()].filter((m) => !m.user.bot).length;
    if (humanCount === 0) continue;

    increments.push(incrementActivity(guild.id, channel.id, { voiceSeconds: SECONDS_PER_TICK * humanCount }));
  }

  return Promise.all(increments);
}

function startActivityStatsJob(client) {
  setInterval(() => {
    for (const guild of client.guilds.cache.values()) {
      processGuild(guild).catch((err) => logger.error(`Activity stats job failed for guild ${guild.id}:`, err));
    }
  }, POLL_INTERVAL_MS);
  logger.info('Activity stats job started (checking every 60s).');
}

module.exports = { startActivityStatsJob };
