const { PermissionFlagsBits } = require('discord.js');
const reportDb = require('../db/report');
const { buildReportPayload } = require('./reportCard');
const { DEFAULT_CATEGORY, isReportCategory } = require('./reportCategories');
const { formatDuration } = require('./duration');
const logger = require('./logger');
const { t, tn, currentLanguage } = require('../i18n');

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
async function checkCanReport({ guild, reporter, reportedUser, reason, config, now = Date.now(), lang = currentLanguage() }) {
  if (!config?.enabled || !config.channel_id) return t(lang, 'reports.send.notSetUp');
  if (reportedUser.id === reporter.id) return t(lang, 'reports.send.self');

  const block = await reportDb.getBlock(guild.id, reporter.id).catch(() => null);
  if (block) return t(lang, 'reports.send.blocked');

  if (config.require_reason && !reason) return t(lang, 'reports.send.reasonRequired');

  if (config.cooldown_seconds > 0 || config.daily_limit > 0) {
    const activity = await reportDb.getReporterActivity(guild.id, reporter.id, now - DAY_MS).catch(() => null);
    if (activity?.lastAt && config.cooldown_seconds > 0 && now - activity.lastAt < config.cooldown_seconds * 1000) {
      return t(lang, 'reports.send.cooldown', { time: formatDuration(config.cooldown_seconds * 1000 - (now - activity.lastAt), lang) });
    }
    if (activity && config.daily_limit > 0 && activity.count >= config.daily_limit) {
      return tn(lang, 'reports.send.dailyLimit', config.daily_limit, { count: config.daily_limit });
    }
  }

  return null;
}

/**
 * Validates, stores and delivers a report. `message` is the reported message when there is one.
 *
 * @returns {Promise<{ok: true, report: object, thread: object|null} | {ok: false, message: string}>}
 */
async function submitReport({ guild, reporter, reportedUser, category = DEFAULT_CATEGORY, reason = null, sourceChannel = null, message = null, anonymous = false, urgent = false, lang = currentLanguage() }) {
  const config = await reportDb.getConfig(guild.id).catch(() => null);
  const cleanReason = reason?.trim().slice(0, REASON_LIMIT) || null;

  const refusal = await checkCanReport({ guild, reporter, reportedUser, reason: cleanReason, config, lang });
  if (refusal) return { ok: false, message: refusal };

  const channel = await guild.channels.fetch(config.channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) return { ok: false, message: t(lang, 'reports.send.channelGone') };

  const me = guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (permissions && !permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
    return { ok: false, message: t(lang, 'reports.send.cannotPost') };
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
    sent = await channel.send(buildReportPayload(report, { pingRoleIds: pingRolesFor(config, useUrgent), lang }));
  } catch (err) {
    logger.error(`Failed to deliver report #${report.report_number} in guild ${guild.id}:`, err);
    await reportDb.deleteReport(guild.id, report.report_number).catch(() => {});
    return { ok: false, message: t(lang, 'reports.send.deliveryFailed') };
  }

  report = (await reportDb.updateReport(guild.id, report.report_number, { report_channel_id: channel.id, report_message_id: sent.id }).catch(() => null)) ?? report;

  let thread = null;
  if (config.auto_thread && typeof sent.startThread === 'function') {
    thread = await sent
      .startThread({ name: t(lang, 'reports.send.threadName', { number: report.report_number, user: reportedUser.username }).slice(0, 100), autoArchiveDuration: 1440, reason: t(lang, 'reports.send.threadReason') })
      .catch((err) => {
        logger.warn(`Could not start a thread for report #${report.report_number} in guild ${guild.id}: ${err.message}`);
        return null;
      });
    if (thread) {
      report = (await reportDb.updateReport(guild.id, report.report_number, { thread_id: thread.id }).catch(() => null)) ?? report;
      // The card was posted before the thread existed, so it gets edited to show the invite button. Editing never pings.
      await Promise.resolve()
        .then(() => sent.edit({ ...buildReportPayload(report, { pingRoleIds: pingRolesFor(config, useUrgent), lang }), allowedMentions: { parse: [] } }))
        .catch((err) => logger.warn(`Could not add the thread button to report #${report.report_number}: ${err.message}`));
    }
  }

  return { ok: true, report, thread };
}

module.exports = { collectImageUrls, isReportStaff, pingRolesFor, checkCanReport, submitReport };
