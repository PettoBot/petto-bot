const { Events } = require('discord.js');
const { getConfig } = require('../db/automod');
const { recordJoinAndCheckRaid } = require('../utils/antiRaid');
const { sendLog } = require('../logging/engine');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      const config = await getConfig(member.guild.id);
      if (!config?.anti_raid_enabled) return;

      const joinCount = recordJoinAndCheckRaid(member.guild.id, config.raid_join_threshold, config.raid_window_seconds);
      if (!joinCount) return;

      await sendLog(member.client, member.guild.id, 'automod', {
        author: { name: 'Possible raid detected' },
        description: `${EMOJI.ALERT} **${joinCount}** members joined within ${config.raid_window_seconds}s (threshold: ${config.raid_join_threshold}).${config.raid_action === 'kick' ? `\n<@${member.id}> was kicked automatically.` : ''}`,
        color: 0xfe6465,
        timestamp: new Date().toISOString(),
      });

      if (config.raid_action === 'kick') {
        await member.kick('Automod: anti-raid burst-join protection').catch((err) => logger.warn('Anti-raid kick failed:', err.message));
      }
    } catch (err) {
      logger.error(`Anti-raid check failed for guild ${member.guild.id}:`, err);
    }
  },
};
