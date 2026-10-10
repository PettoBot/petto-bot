const { Events, AuditLogEvent } = require('discord.js');
const { handleBanRemove } = require('../logging/memberLog');
const { getHardBan, canLiftHardBan } = require('../db/hardBans');
const logger = require('../utils/logger');

/** A hardban lifted by someone who may not lift it (a manual unban in Discord's settings, another bot) is put back. */
async function restoreHardBan(ban, client) {
  const hard = await getHardBan(ban.guild.id, ban.user.id).catch(() => null);
  if (!hard) return;

  // The audit log can be a moment behind the event, so look twice before deciding who did it.
  let entry = null;
  for (let attempt = 0; attempt < 2 && !entry; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1500));
    entry = await ban.guild
      .fetchAuditLogs({ type: AuditLogEvent.MemberBanRemove, limit: 5 })
      .then((logs) => logs.entries.find((e) => e.targetId === ban.user.id))
      .catch(() => null);
  }
  const by = entry?.executorId;
  // Petto's own unban already removed the record, so a record that still exists means somebody else did this.
  if (by === client.user.id) return;
  if (by && (await canLiftHardBan(ban.guild, by))) return;

  await ban.guild.members
    .ban(ban.user.id, { reason: 'Hardban: only the server owner and antinuke admins can unban this user.' })
    .catch((err) => logger.warn(`[hardban] could not restore the ban of ${ban.user.id} in ${ban.guild.id}: ${err.message}`));
}

module.exports = {
  name: Events.GuildBanRemove,
  async execute(ban, client) {
    await restoreHardBan(ban, client).catch((err) => logger.error('[hardban]', err));
    return handleBanRemove(ban, client).catch((err) => logger.error('[guildBanRemove]', err));
  },
};
