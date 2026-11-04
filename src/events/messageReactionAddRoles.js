const { Events } = require('discord.js');
const rrDb = require('../db/reactionRoles');
const { addRoles, reportDeadRoles } = require('../utils/deadRoles');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

module.exports = {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    if (user.bot || !reaction.message.guild) return;

    try {
      // No request to Discord here: the id of the message and the emoji (all this needs) come with the event, and completing the reaction cost one request for every reaction of every server.
      const row = await rrDb.getReactionRole(reaction.message.id, reaction.emoji.toString());
      if (!row || (row.interaction_type && row.interaction_type !== 'reaction')) return;

      const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
      if (!member) return;

      const reason = t(currentLanguage(), 'automation.reactionrole.auditReason');
      if (row.mode === 'remove') await member.roles.remove(row.role_id, reason).catch(() => {});
      else {
        // A role that was deleted: the member is not told anything here (it is a reaction), the staff is, once a day.
        const result = await addRoles(member, row.role_id, reason);
        if (result.dead.length) await reportDeadRoles({ client: reaction.client, guild: reaction.message.guild, kind: 'reaction', roleIds: result.dead });
      }
    } catch (err) {
      logger.error('Reaction role add failed:', err);
    }
  },
};
