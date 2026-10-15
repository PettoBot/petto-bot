const { Events } = require('discord.js');
const { getConfig } = require('../db/automod');
const { sendLog } = require('../logging/engine');
const { EMOJI } = require('../utils/emojis');
const { applyAutomatedKick } = require('../utils/automodMemberAction');
const logger = require('../utils/logger');
const { t, tn, currentLanguage } = require('../i18n');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (member.user.bot) return;

    try {
      const config = await getConfig(member.guild.id);
      if (!config?.anti_alt_enabled) return;

      const ageDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
      if (ageDays >= config.anti_alt_min_age_days) return;

      const lang = currentLanguage();
      const ageText = ageDays < 1 ? t(lang, 'security.antiAlt.log.lessThanDay') : tn(lang, 'security.antiAlt.log.days', Math.floor(ageDays), { count: Math.floor(ageDays) });
      const willKick = config.anti_alt_action === 'kick';

      await sendLog(member.client, member.guild.id, 'automod', {
        author: { name: member.user.username, icon_url: member.user.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? undefined },
        description: t(lang, willKick ? 'security.antiAlt.log.kicked' : 'security.antiAlt.log.flagged', { emoji: EMOJI.ALERT, user: `<@${member.id}>`, age: ageText, min: config.anti_alt_min_age_days }),
        color: 0xfed53c,
        footer: { text: t(lang, 'security.log.userId', { id: member.id }) },
        timestamp: new Date().toISOString(),
      });

      if (willKick) {
        await applyAutomatedKick(member, t(lang, 'security.antiAlt.kickReason'));
      }
    } catch (err) {
      logger.error(`Anti-alt check failed for guild ${member.guild.id}:`, err);
    }
  },
};
