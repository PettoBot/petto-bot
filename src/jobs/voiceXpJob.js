const { getConfig } = require('../db/levelConfig');
const { getMultiplier, grantVoiceXp } = require('../utils/levelActions');
const { getVoiceConfig } = require('../utils/levelSource');
const logger = require('../utils/logger');
const config = require('../config');
const { forEachWithConcurrency, exclusiveTask } = require('../utils/concurrency');

const POLL_INTERVAL_MS = 60_000;

async function processGuild(client, guild) {
  const config = await getConfig(guild.id);
  const voiceConfig = getVoiceConfig(config ?? {});
  if (!voiceConfig.enabled || !config?.xp_per_vc_minute) return;

  for (const channel of guild.channels.cache.values()) {
    if (!channel.isVoiceBased?.() || channel.id === guild.afkChannelId) continue;
    if (voiceConfig.ignored_channel_ids.includes(channel.id)) continue;

    for (const member of channel.members.values()) {
      if (member.user.bot) continue;
      if (member.voice.selfDeaf || member.voice.serverDeaf) continue;

      try {
        const multi = await getMultiplier(guild.id, channel.id, member);
        const xpGain = Math.round(config.xp_per_vc_minute * multi);

        await grantVoiceXp({ client, guild, member, config: voiceConfig, xpGain, vcInc: 1 });
      } catch (err) {
        // Keep one failed member from aborting the rest of this guild's tick.
        // The structured context also makes the Discord diagnostics card useful
        // when the console is not available.
        logger.error(
          { guildId: guild.id, channelId: channel.id, userId: member.id, action: 'voice-xp-grant', source: 'voiceXpJob' },
          `Voice XP grant failed for ${member.id} in guild ${guild.id}:`,
          err,
        );
      }
    }
  }
}

function startVoiceXpJob(client) {
  const run = exclusiveTask(() => forEachWithConcurrency(client.guilds.cache.values(), (guild) => (
    processGuild(client, guild).catch((err) => logger.error(
      { guildId: guild.id, action: 'voice-xp-guild-tick', source: 'voiceXpJob' },
      `Voice XP job failed for guild ${guild.id}:`,
      err,
    ))
  ), config.jobConcurrency));
  setInterval(() => run().catch((err) => logger.error('Voice XP job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Voice XP job started (checking every 60s).');
}

module.exports = { startVoiceXpJob };
