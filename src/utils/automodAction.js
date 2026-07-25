const { ensureGuild } = require('../db/guilds');
const { createCase } = require('../db/modActions');
const { addWarn } = require('../db/warns');
const { logSanction } = require('./caseLog');
const { buildSanctionDM } = require('./sanctionMessage');
const { checkAndApplyEscalation } = require('./escalation');
const { formatDuration } = require('./duration');
const { sendLog } = require('../logging/engine');
const { EMOJI } = require('./emojis');
const logger = require('./logger');

const FLOOD_MUTE_MS = 10 * 60 * 1000; // 10 minutes
const SILENT_CHANNEL_MUTE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Applies an automod consequence to a message's author: deletes the message,
 * applies the sanction (warn/tempmute/kick) through the exact same case/DM/log
 * machinery the manual /warn, /mute temp, /kick commands use (so automod hits
 * show up in /case history and the 'sanctions' log like anything a moderator did),
 * and separately logs the raw detection to the 'automod' category of /logs.
 */
async function applyAutomodAction(message, { violationType, reason, action }) {
  const { guild, member, author } = message;
  const client = message.client;

  await message.delete().catch((err) => logger.warn(`Automod: failed to delete message ${message.id}:`, err.message));

  await sendLog(client, guild.id, 'automod', {
    author: { name: author.username, icon_url: author.displayAvatarURL?.() ?? undefined },
    description: `${EMOJI.ALERT} **${violationType}** in <#${message.channel.id}> — <@${author.id}>\n${reason}`,
    color: 0xfed53c,
    footer: { text: `User ID: ${author.id}` },
    timestamp: new Date().toISOString(),
  }).catch((err) => logger.error('Automod: failed to send automod log:', err));

  const fullReason = `Automod: ${reason}`;

  try {
    await ensureGuild(guild.id);

    if (action === 'warn') {
      const { modCase, warnCount } = await addWarn({ guildId: guild.id, userId: author.id, moderatorId: client.user.id, reason: fullReason });
      await logSanction(client, guild, { modCase, target: author, moderator: client.user, reason: fullReason });
      await author.send(buildSanctionDM({ type: 'warn', guild, client, reason: fullReason })).catch(() => {});
      await checkAndApplyEscalation(client, guild, member, warnCount).catch((err) => logger.error('Escalation check failed:', err));
      return;
    }

    if (action === 'tempmute') {
      const durationMs = violationType === 'silent-channel' ? SILENT_CHANNEL_MUTE_MS : FLOOD_MUTE_MS;
      await member.timeout(durationMs, fullReason).catch((err) => logger.warn('Automod: timeout failed:', err.message));
      const expiresAt = new Date(Date.now() + durationMs).toISOString();
      const duration = formatDuration(durationMs);
      const modCase = await createCase({ guildId: guild.id, userId: author.id, moderatorId: client.user.id, type: 'tempmute', reason: fullReason, expiresAt });
      await logSanction(client, guild, { modCase, target: author, moderator: client.user, reason: fullReason, duration });
      await author.send(buildSanctionDM({ type: 'tempmute', guild, client, reason: fullReason, duration })).catch(() => {});
      return;
    }

    if (action === 'kick') {
      await member.kick(fullReason).catch((err) => logger.warn('Automod: kick failed:', err.message));
      const modCase = await createCase({ guildId: guild.id, userId: author.id, moderatorId: client.user.id, type: 'kick', reason: fullReason });
      await logSanction(client, guild, { modCase, target: author, moderator: client.user, reason: fullReason });
      await author.send(buildSanctionDM({ type: 'kick', guild, client, reason: fullReason })).catch(() => {});
    }
  } catch (err) {
    logger.error(`Automod: failed to apply "${action}" to ${author.id} in guild ${guild.id}:`, err);
  }
}

module.exports = { applyAutomodAction };
