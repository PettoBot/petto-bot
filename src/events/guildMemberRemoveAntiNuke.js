const { Events, AuditLogEvent } = require('discord.js');
const { trackDestructiveAction } = require('../utils/antiNuke');
const logger = require('../utils/logger');

// GuildMemberRemove also fires when someone leaves voluntarily. The audit-log
// lookup only returns a recent executor for an actual kick, so normal leaves
// are ignored without adding a separate API call here.
module.exports = {
  name: Events.GuildMemberRemove,
  execute(member) {
    return trackDestructiveAction(member.client, member.guild, {
      auditLogType: AuditLogEvent.MemberKick,
      targetId: member.id,
      actionLabel: 'member kick',
    }).catch((err) => logger.error('Anti-nuke member-kick tracking failed:', err));
  },
};
