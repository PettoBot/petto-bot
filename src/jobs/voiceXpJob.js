const { getConfig } = require('../db/levelConfig');
const { getMultiplier, canEarnXp, grantVoiceXp } = require('../utils/levelActions');
const { getVoiceConfig } = require('../utils/levelSource');
const { voiceEligible, voiceActiveCount, voiceShare } = require('../utils/levelRules');
const { pruneOldPeriods } = require('../db/levelPeriods');
const logger = require('../utils/logger');
const config = require('../config');
const { forEachWithConcurrency, exclusiveTask } = require('../utils/concurrency');
const { guildLanguage, runWithLanguage } = require('../i18n');

const POLL_INTERVAL_MS = 60_000;

async function processGuild(client, guild) {
  const config = await getConfig(guild.id);
  const voiceConfig = getVoiceConfig(config ?? {});
  if (!voiceConfig.enabled || !config?.xp_per_vc_minute) return;
  // Jobs run on a timer, outside any server: the level-up messages of this server go out in its language.
  const lang = await guildLanguage(guild.id);
  await runWithLanguage(lang, () => grantGuildVoiceXp(client, guild, config, voiceConfig));
}

async function grantGuildVoiceXp(client, guild, config, voiceConfig) {
  for (const channel of guild.channels.cache.values()) {
    if (!channel.isVoiceBased?.() || channel.id === guild.afkChannelId) continue;

    const stateOf = (member) => ({ bot: member.user.bot, deaf: member.voice.selfDeaf || member.voice.serverDeaf, muted: member.voice.selfMute || member.voice.serverMute });
    const humans = voiceActiveCount([...channel.members.values()].map(stateOf), voiceConfig);
    for (const member of channel.members.values()) {
      if (member.user.bot) continue;
      const { deaf, muted } = stateOf(member);
      const eligible = voiceEligible({ humans, deaf, muted }, voiceConfig);
      if (!eligible) continue;
      if (!canEarnXp({ member, channel, config: voiceConfig })) continue;

      try {
        const multi = await getMultiplier(guild.id, channel, member, voiceConfig);
        const xpGain = voiceShare(Math.round(config.xp_per_vc_minute * multi), humans, voiceConfig);
        if (xpGain <= 0) continue;

        await grantVoiceXp({ client, guild, member, config: voiceConfig, xpGain, vcInc: 1, channel });
      } catch (err) {
        // Keep one failed member from aborting the rest of this guild's tick.
        // The structured context also makes the Discord diagnostics card useful
        // when the console is not available.
        logger.error(
          { guildId: guild.id, channelId: channel.id, userId: member.id, action: 'voice-xp-grant', source: 'voiceXpJob' },
          `Voice XP grant failed for ${member.id} in guild ${guild.id}:`, // i18n-ignore: logger output
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
      `Voice XP job failed for guild ${guild.id}:`, // i18n-ignore: logger output
      err,
    ))
  ), config.jobConcurrency));
  setInterval(() => run().catch((err) => logger.error('Voice XP job error:', err)), POLL_INTERVAL_MS).unref?.();
  // Weekly and monthly rankings of periods that are over are dropped once an hour; the current ones are never touched.
  setInterval(() => pruneOldPeriods().catch((err) => logger.warn(`Old ranking periods could not be pruned: ${err.message}`)), 60 * 60_000).unref?.();
  logger.info('Voice XP job started (checking every 60s).');
}

module.exports = { startVoiceXpJob };
