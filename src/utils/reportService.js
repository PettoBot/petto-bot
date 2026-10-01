const { PermissionFlagsBits } = require('discord.js');
const reportDb = require('../db/report');
const { buildReportPayload } = require('./reportCard');
const { DEFAULT_CATEGORY, isReportCategory } = require('./reportCategories');
const { formatDuration } = require('./duration');
const logger = require('./logger');

const DAY_MS = 24 * 60 * 60 * 1000;
const IMAGE_URL_RE = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i;
const CONTENT_LIMIT = 500;
const REASON_LIMIT = 500;

function collectImageUrls(message) {
  const urls = [];
  for (const attachment of message?.attachments?.values?.() ?? []) {
    if (attachment.contentType?.startsWith('image/') || IMAGE_URL_RE.test(attachment.url ?? '')) urls.push(attachment.url);
  }

  for (const embed of message?.embeds ?? []) {
    if (embed.image?.url) urls.push(embed.image.url);
    if (embed.thumbnail?.url) urls.push(embed.thumbnail.url);
  }

  return [...new Set(urls)].slice(0, 10);
}

/** Who may claim, resolve and dismiss reports, and use the staff report commands. */
function isReportStaff(member) {
  const permissions = member?.permissions;
  if (!permissions) return false;
  return permissions.has(PermissionFlagsBits.ManageGuild) || permissions.has(PermissionFlagsBits.ModerateMembers) || permissions.has(PermissionFlagsBits.ManageMessages);
}

/** The roles pinged by a brand new report: the "always" role, plus the urgent role when the reporter asked for it. */
function pingRolesFor(config, urgent) {
  return [...new Set([config.ping_role_id, urgent ? config.urgent_role_id : null].filter(Boolean))];
}

/**
 * Everything that has to be true before a report is accepted. Returns a message for the reporter when it is
 * not, so a refusal is always explained.
 */
async function checkCanReport({ guild, reporter, reportedUser, reason, config, now = Date.now() }) {
  if (!config?.enabled || !config.channel_id) return 'Reports are not set up on this server yet.';
  if (reportedUser.id === reporter.id) return 'You cannot report yourself.';

  const block = await reportDb.getBlock(guild.id, reporter.id).catch(() => null);
  if (block) return 'Staff have turned off reporting for your account in this server.';

  if (config.require_reason && !reason) return 'This server requires a reason with every report. Please say what happened.';

  if (config.cooldown_seconds > 0 || config.daily_limit > 0) {
    const activity = await reportDb.getReporterActivity(guild.id, reporter.id, now - DAY_MS).catch(() => null);
    if (activity?.lastAt && config.cooldown_seconds > 0 && now - activity.lastAt < config.cooldown_seconds * 1000) {
      return `You sent a report a moment ago. Please wait ${formatDuration(config.cooldown_seconds * 1000 - (now - activity.lastAt))} before sending another.`;
    }
    if (activity && config.daily_limit > 0 && activity.count >= config.daily_limit) {
      return `You reached the limit of ${config.daily_limit} ${config.daily_limit === 1 ? 'report' : 'reports'} per day in this server.`;
    }
  }

  return null;
}

/**
 * Validates, stores and delivers a report. `message` is the reported message when there is one.
 *
 * @returns {Promise<{ok: true, report: object, thread: object|null} | {ok: false, message: string}>}
 */
async function submitReport({ guild, reporter, reportedUser, category = DEFAULT_CATEGORY, reason = null, sourceChannel = null, message = null, anonymous = false, urgent = false }) {
  const config = await reportDb.getConfig(guild.id).catch(() => null);
  const cleanReason = reason?.trim().slice(0, REASON_LIMIT) || null;

  const refusal = await checkCanReport({ guild, reporter, reportedUser, reason: cleanReason, config });
  if (refusal) return { ok: false, message: refusal };

  const channel = await guild.channels.fetch(config.channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) return { ok: false, message: 'The configured report channel no longer exists. Ask staff to run `/report config` again.' };

  const me = guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (permissions && !permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
    return { ok: false, message: 'I cannot post in the report channel right now. Please tell the staff team.' };
  }

  const useUrgent = urgent === true && Boolean(config.urgent_role_id);
  const useAnonymous = anonymous === true && config.anonymous_reporting_enabled === true;

  let report = await reportDb.createReport({
    guildId: guild.id,
    reporterId: reporter.id,
    reportedUserId: reportedUser.id,
    category: isReportCategory(category) ? category : DEFAULT_CATEGORY,
    reason: cleanReason,
    sourceChannelId: sourceChannel?.id ?? message?.channelId ?? null,
    messageLink: message?.url ?? null,
    messageContent: message?.content?.trim().slice(0, CONTENT_LIMIT) || null,
    imageUrls: collectImageUrls(message),
    anonymous: useAnonymous,
    urgent: useUrgent,
  });

  let sent;
  try {
    sent = await channel.send(buildReportPayload(report, { pingRoleIds: pingRolesFor(config, useUrgent) }));
  } catch (err) {
    logger.error(`Failed to deliver report #${report.report_number} in guild ${guild.id}:`, err);
    await reportDb.deleteReport(guild.id, report.report_number).catch(() => {});
    return { ok: false, message: 'I could not deliver your report to the staff team. Please try again in a moment.' };
  }

  report = (await reportDb.updateReport(guild.id, report.report_number, { report_channel_id: channel.id, report_message_id: sent.id }).catch(() => null)) ?? report;

  let thread = null;
  if (config.auto_thread && typeof sent.startThread === 'function') {
    thread = await sent
      .startThread({ name: `Report #${report.report_number} · ${reportedUser.username}`.slice(0, 100), autoArchiveDuration: 1440, reason: 'Petto report discussion' })
      .catch((err) => {
        logger.warn(`Could not start a thread for report #${report.report_number} in guild ${guild.id}: ${err.message}`);
        return null;
      });
  }

  return { ok: true, report, thread };
}

module.exports = { collectImageUrls, isReportStaff, pingRolesFor, checkCanReport, submitReport };
