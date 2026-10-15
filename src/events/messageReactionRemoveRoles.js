const { Events } = require('discord.js');
const rrDb = require('../db/reactionRoles');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

module.exports = {
  name: Events.MessageReactionRemove,
  async execute(reaction, user) {
    if (user.bot || !reaction.message.guild) return;

    try {
      if (reaction.partial) await reaction.fetch().catch(() => null);
      const row = await rrDb.getReactionRole(reaction.message.id, reaction.emoji.toString());
      if (!row || (row.interaction_type && row.interaction_type !== 'reaction') || row.mode !== 'toggle') return;

      const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
      if (!member) return;

      await member.roles.remove(row.role_id, t(currentLanguage(), 'automation.reactionrole.auditReasonRemoved')).catch(() => {});
    } catch (err) {
      logger.error('Reaction role remove failed:', err);
    }
  },
};
