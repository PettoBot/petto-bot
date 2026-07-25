const { Events, AuditLogEvent } = require('discord.js');
const { trackDestructiveActionByRecency } = require('../utils/antiNuke');
const logger = require('../utils/logger');

// discord.js's WebhooksUpdate event only reports the channel a webhook changed in,
// not what changed or by whom — we correlate against the audit log's most recent
// WebhookCreate entry, since webhook creation (unlike deletion) is the nuke-relevant case.
module.exports = {
  name: Events.WebhooksUpdate,
  execute(channel) {
    if (!channel.guild) return;
    return trackDestructiveActionByRecency(channel.client, channel.guild, { auditLogType: AuditLogEvent.WebhookCreate, actionLabel: 'webhook creation' }).catch((err) =>
      logger.error('Anti-nuke webhook-creation tracking failed:', err),
    );
  },
};
