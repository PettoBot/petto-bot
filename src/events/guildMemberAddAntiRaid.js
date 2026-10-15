const { Events } = require('discord.js');
const { getConfig } = require('../db/automod');
const { recordJoinAndCheckRaid } = require('../utils/antiRaid');
const { sendLog } = require('../logging/engine');
const { EMOJI } = require('../utils/emojis');
const { applyAutomatedKick } = require('../utils/automodMemberAction');
const { startLockdown } = require('../utils/lockdown');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

// The raid log says what happens next: only the alert, kicks or a lockdown.
const RAID_LOG_KEYS = { kick: 'security.raid.log.kick', lockdown: 'security.raid.log.lockdown' };

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      const config = await getConfig(member.guild.id);
      if (!config?.anti_raid_enabled) return;

      const raid = recordJoinAndCheckRaid(member.guild.id, config.raid_join_threshold, config.raid_window_seconds);
      if (!raid) return;
      const lang = currentLanguage();

      if (raid.newBurst) {
        await sendLog(member.client, member.guild.id, 'automod', {
          author: { name: t(lang, 'security.raid.log.title') },
          description: t(lang, RAID_LOG_KEYS[config.raid_action] ?? 'security.raid.log.alert', { emoji: EMOJI.ALERT, count: raid.count, seconds: config.raid_window_seconds, threshold: config.raid_join_threshold }),
          color: 0xfe6465,
          timestamp: new Date().toISOString(),
        });
      }

      if (raid.newBurst && config.raid_action === 'lockdown') {
        await startLockdown(member.guild, { startedBy: member.client.user.id, reason: t(lang, 'security.raid.lockdownReason', { count: raid.count, seconds: config.raid_window_seconds }) }).catch((err) => {
          if (!err.userFacing) logger.error(`Anti-raid lockdown failed for guild ${member.guild.id}:`, err);
        });
      }

      if (config.raid_action === 'kick') {
        await applyAutomatedKick(member, t(lang, 'security.raid.kickReason'));
      }
    } catch (err) {
      logger.error(`Anti-raid check failed for guild ${member.guild.id}:`, err);
    }
  },
};
