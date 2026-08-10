const { Events } = require('discord.js');
const { getConfig } = require('../db/automod');
const { sendLog } = require('../logging/engine');
const { EMOJI } = require('../utils/emojis');
const { applyAutomatedKick } = require('../utils/automodMemberAction');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (member.user.bot) return;

    try {
      const config = await getConfig(member.guild.id);
      if (!config?.anti_alt_enabled) return;

      const ageDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
      if (ageDays >= config.anti_alt_min_age_days) return;

      const ageText = ageDays < 1 ? 'less than a day' : `${Math.floor(ageDays)} day(s)`;
      const willKick = config.anti_alt_action === 'kick';

      await sendLog(member.client, member.guild.id, 'automod', {
        author: { name: member.user.username, icon_url: member.user.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? undefined },
        description: `${EMOJI.ALERT} <@${member.id}> joined with an account only ${ageText} old (minimum: ${config.anti_alt_min_age_days}d).${willKick ? ' Kicked automatically.' : ''}`,
        color: 0xfed53c,
        footer: { text: `User ID: ${member.id}` },
        timestamp: new Date().toISOString(),
      });

      if (willKick) {
        await applyAutomatedKick(member, 'Automod: account below minimum age (anti-alt)');
      }
    } catch (err) {
      logger.error(`Anti-alt check failed for guild ${member.guild.id}:`, err);
    }
  },
};
