const { ensureGuild } = require('../db/guilds');
const { createCase } = require('../db/modActions');
const { addWarn } = require('../db/warns');
const { logSanction } = require('./caseLog');
const { sanctionDM } = require('./sanctionTemplates');
const { checkAndApplyEscalation } = require('./escalation');
const { formatDuration } = require('./duration');
const { sendLog } = require('../logging/engine');
const { EMOJI } = require('./emojis');
const { getConfig } = require('../db/automod');
const { recordStrike } = require('./automodChecks');
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
async function applyAutomodActionCore(message, { violationType, reason, action, durationMs: customDurationMs }) {
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
      const { modCase, warnCount } = await addWarn({ guildId: guild.id, userId: author.id, moderatorId: client.user.id, reason: fullReason, source: 'automod' });
      await logSanction(client, guild, { modCase, target: author, moderator: client.user, reason: fullReason, source: 'automod' });
      await author.send(await sanctionDM({ type: 'warn', guild, client, reason: fullReason, user: author, member, source: 'automod', caseNumber: modCase.case_number })).catch(() => {});
      await checkAndApplyEscalation(client, guild, member, warnCount).catch((err) => logger.error('Escalation check failed:', err));
      return;
    }

    if (action === 'tempmute') {
      const durationMs = customDurationMs ?? (violationType === 'silent-channel' ? SILENT_CHANNEL_MUTE_MS : FLOOD_MUTE_MS);
      try {
        await member.timeout(durationMs, fullReason);
      } catch (err) {
        logger.warn(
          { guildId: guild.id, channelId: message.channel.id, userId: author.id, action: 'timeout', source: violationType },
          'Automod: timeout failed:',
          err,
        );
        return;
      }
      const expiresAt = new Date(Date.now() + durationMs).toISOString();
      const duration = formatDuration(durationMs);
      const modCase = await createCase({ guildId: guild.id, userId: author.id, moderatorId: client.user.id, type: 'tempmute', reason: fullReason, expiresAt, source: 'automod' });
      await logSanction(client, guild, { modCase, target: author, moderator: client.user, reason: fullReason, duration, source: 'automod' });
      await author.send(await sanctionDM({ type: 'tempmute', guild, client, reason: fullReason, duration, user: author, member, source: 'automod', caseNumber: modCase.case_number })).catch(() => {});
      return;
    }

    if (action === 'kick') {
      try {
        await member.kick(fullReason);
      } catch (err) {
        logger.warn(
          { guildId: guild.id, channelId: message.channel.id, userId: author.id, action: 'kick', source: violationType },
          'Automod: kick failed:',
          err,
        );
        return;
      }
      const modCase = await createCase({ guildId: guild.id, userId: author.id, moderatorId: client.user.id, type: 'kick', reason: fullReason, source: 'automod' });
      await logSanction(client, guild, { modCase, target: author, moderator: client.user, reason: fullReason, source: 'automod' });
      await author.send(await sanctionDM({ type: 'kick', guild, client, reason: fullReason, user: author, member, source: 'automod', caseNumber: modCase.case_number })).catch(() => {});
    }
  } catch (err) {
    logger.error(`Automod: failed to apply "${action}" to ${author.id} in guild ${guild.id}:`, err);
  }
}

/** The consequence of one automod hit, and then the strike it counts. */
async function applyAutomodAction(message, options) {
  await applyAutomodActionCore(message, options);
  await applyStrike(message, options.action).catch((err) => logger.warn(`Automod: strike check failed for ${message.author.id}: ${err.message}`));
}

/** After enough automod hits in a row the member is muted, as the server chose (strikes). Off until the limit is set. */
async function applyStrike(message, action) {
  if (action === 'tempmute' || action === 'kick') return;
  const { guild, member, author, client } = message;
  const config = await getConfig(guild.id);
  if (!config?.strike_limit) return;
  if (!recordStrike(guild.id, author.id, { limit: config.strike_limit, windowMinutes: config.strike_window_minutes ?? 10 })) return;
  const minutes = config.strike_mute_minutes ?? 10;
  const reason = `Automod: ${config.strike_limit} violations in ${config.strike_window_minutes ?? 10} minutes`;
  if (!member?.moderatable) return;
  await member.timeout(minutes * 60_000, reason);
  const modCase = await createCase({ guildId: guild.id, userId: author.id, moderatorId: client.user.id, type: 'tempmute', reason, expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(), source: 'automod' });
  await logSanction(client, guild, { modCase, target: author, moderator: client.user, reason, duration: formatDuration(minutes * 60_000), source: 'automod' });
}

module.exports = { applyAutomodAction };
