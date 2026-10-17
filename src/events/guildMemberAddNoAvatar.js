// Anti-raid: an account that joins with the default avatar (no profile picture) is flagged or kicked (!automod no-avatar).
const { Events } = require('discord.js');
const { getConfig } = require('../db/automod');
const { sendLog } = require('../logging/engine');
const { EMOJI } = require('../utils/emojis');
const { applyAutomatedKick } = require('../utils/automodMemberAction');
const { usePass } = require('../utils/joinPass');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (member.user.bot || member.user.avatar) return;
    try {
      const config = await getConfig(member.guild.id);
      if (!config?.no_avatar_enabled) return;
      if (await usePass(member)) return;

      const lang = currentLanguage();
      const willKick = config.no_avatar_action === 'kick';
      await sendLog(member.client, member.guild.id, 'automod', {
        author: { name: member.user.username, icon_url: member.user.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? undefined },
        description: t(lang, willKick ? 'security.noAvatar.log.kicked' : 'security.noAvatar.log.flagged', { emoji: EMOJI.ALERT, user: `<@${member.id}>` }),
        color: 0xfed53c,
        footer: { text: t(lang, 'security.log.userId', { id: member.id }) },
        timestamp: new Date().toISOString(),
      });
      if (willKick) await applyAutomatedKick(member, t(lang, 'security.noAvatar.kickReason'));
    } catch (err) {
      logger.error(`No-avatar check failed for guild ${member.guild.id}:`, err);
    }
  },
};
