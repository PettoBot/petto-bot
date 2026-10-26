const { queueActivity } = require('../db/activityStats');
const { queueVoice } = require('../db/activityDetail');
const statsRules = require('../db/statsRules');
const logger = require('../utils/logger');
const config = require('../config');
const { forEachWithConcurrency, exclusiveTask } = require('../utils/concurrency');

const POLL_INTERVAL_MS = 60_000;
const SECONDS_PER_TICK = 60;

async function processGuild(guild) {
  for (const channel of guild.channels.cache.values()) {
    if (!channel.isVoiceBased?.() || channel.id === guild.afkChannelId) continue;

    // Only the people who may be counted: not a server that turned it off, not who asked to be left out.
    const counted = [];
    for (const member of channel.members.values()) {
      if (member.user.bot) continue;
      const rules = statsRules.allowed(guild.id, member.id);
      if (rules) counted.push({ member, rules });
    }
    if (counted.length === 0) continue;
    for (const { member, rules } of counted) queueVoice(guild.id, member.id, SECONDS_PER_TICK, { member: rules.members });

    queueActivity(guild.id, channel.id, { voiceSeconds: SECONDS_PER_TICK * counted.length });
  }

  return undefined;
}

function startActivityStatsJob(client) {
  const run = exclusiveTask(() => forEachWithConcurrency(client.guilds.cache.values(), (guild) => (
    processGuild(guild).catch((err) => logger.error(`Activity stats job failed for guild ${guild.id}:`, err))
  ), config.jobConcurrency));
  // The rules of what may be counted are read first (until then nothing is counted), and the counters older than they are kept are deleted every day.
  statsRules.load();
  const prune = () => statsRules.pruneOld().catch((err) => logger.error('Activity stats pruning failed:', err));
  setTimeout(prune, 5 * 60_000).unref?.();
  setInterval(prune, 24 * 60 * 60_000).unref?.();
  setInterval(() => run().catch((err) => logger.error('Activity stats job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Activity stats job started (checking every 60s).');
}

module.exports = { startActivityStatsJob, processGuild };
