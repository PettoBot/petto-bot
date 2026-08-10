const { Events } = require('discord.js');
const { getConfig } = require('../db/automod');
const { recordJoinAndCheckRaid } = require('../utils/antiRaid');
const { sendLog } = require('../logging/engine');
const { EMOJI } = require('../utils/emojis');
const { applyAutomatedKick } = require('../utils/automodMemberAction');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      const config = await getConfig(member.guild.id);
      if (!config?.anti_raid_enabled) return;

      const raid = recordJoinAndCheckRaid(member.guild.id, config.raid_join_threshold, config.raid_window_seconds);
      if (!raid) return;

      if (raid.newBurst) {
        await sendLog(member.client, member.guild.id, 'automod', {
          author: { name: 'Possible raid detected' },
          description: `${EMOJI.ALERT} **${raid.count}** members joined within ${config.raid_window_seconds}s (threshold: ${config.raid_join_threshold}).${config.raid_action === 'kick' ? '\nNew joiners will be kicked automatically.' : ''}`,
          color: 0xfe6465,
          timestamp: new Date().toISOString(),
        });
      }

      if (config.raid_action === 'kick') {
        await applyAutomatedKick(member, 'Automod: anti-raid burst-join protection');
      }
    } catch (err) {
      logger.error(`Anti-raid check failed for guild ${member.guild.id}:`, err);
    }
  },
};
