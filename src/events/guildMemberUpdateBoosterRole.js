// A booster role when its owner stops boosting, or boosts again: what the server chose on the dashboard (booster_role_config.on_unboost).
// Discord only says the boost ended when it knew the member before (a partial old member says nothing), so those are left alone; the
// "Clean up" button and `!boosterrole admin cleanup` catch the rest.
const { Events } = require('discord.js');
const { applyBoostChange } = require('../utils/boosterRoleActions');
const logger = require('../utils/logger');
const { guildLanguage } = require('../i18n');

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    if (!newMember.guild || oldMember.partial || newMember.user?.bot) return;
    const was = Boolean(oldMember.premiumSinceTimestamp);
    const is = Boolean(newMember.premiumSinceTimestamp);
    if (was === is) return;
    try {
      await applyBoostChange(newMember, is, await guildLanguage(newMember.guild.id));
    } catch (error) {
      logger.warn(`Booster role boost change failed in guild ${newMember.guild.id}:`, error.message);
    }
  },
};
