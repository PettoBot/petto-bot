// Leaving the server ends a boost too: when the server chose to delete booster roles of members who stop boosting
// (booster_role_config.on_unboost = 'delete'), the role of a member who leaves goes as well.
const { Events } = require('discord.js');
const db = require('../db/boosterRole');
const { removeBoosterRole } = require('../utils/boosterRoleActions');
const logger = require('../utils/logger');
const { t, guildLanguage } = require('../i18n');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    if (!member.guild || member.user?.bot) return;
    try {
      const config = await db.getConfig(member.guild.id);
      if (config?.on_unboost !== 'delete') return;
      const lang = await guildLanguage(member.guild.id);
      await removeBoosterRole(member.guild, member.id, t(lang, 'utility.boosterrole.audit.unboost', { user: member.user?.tag ?? member.id }));
    } catch (error) {
      logger.warn(`Booster role of a member who left could not be removed in guild ${member.guild.id}:`, error.message);
    }
  },
};
