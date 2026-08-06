const { getConfig } = require('../db/levelConfig');
const { getMultiplier, grantVoiceXp } = require('../utils/levelActions');
const { getVoiceConfig } = require('../utils/levelSource');
const logger = require('../utils/logger');

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

      const multi = await getMultiplier(guild.id, channel.id, member);
      const xpGain = Math.round(config.xp_per_vc_minute * multi);

      await grantVoiceXp({ client, guild, member, config: voiceConfig, xpGain, vcInc: 1 }).catch((err) => logger.error(`Voice XP grant failed for ${member.id} in guild ${guild.id}:`, err));
    }
  }
}

function startVoiceXpJob(client) {
  setInterval(() => {
    for (const guild of client.guilds.cache.values()) {
      processGuild(client, guild).catch((err) => logger.error(`Voice XP job failed for guild ${guild.id}:`, err));
    }
  }, POLL_INTERVAL_MS);
  logger.info('Voice XP job started (checking every 60s).');
}

module.exports = { startVoiceXpJob };
