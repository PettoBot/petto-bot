const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const reportDb = require('../db/report');
const { buildReportCard } = require('./reportCard');
const { categoryLabel } = require('./reportCategories');
const { infoPayload, noticePayload, clip } = require('./infoCard');
const { EMOJI } = require('./emojis');
const { COLORS } = require('./colors');

const LIST_PAGE_SIZE = 8;
const LIST_BUTTON_PREFIX = 'rptl:';
const STATUS_LABELS = { open: 'Open', claimed: 'Being handled', resolved: 'Resolved', dismissed: 'Dismissed' };

function unix(value) {
  return Math.floor(new Date(value).getTime() / 1000);
}

function reportMessageUrl(guildId, report) {
  return report.report_channel_id && report.report_message_id ? `https://discord.com/channels/${guildId}/${report.report_channel_id}/${report.report_message_id}` : null;
}

/** The reporter is deliberately never part of a list line, so anonymous reports stay anonymous. */
function listLine(guildId, report) {
  const url = reportMessageUrl(guildId, report);
  const head = `**#${report.report_number}** · ${categoryLabel(report.category)} · <@${report.reported_user_id}> · *${STATUS_LABELS[report.status] ?? report.status}* · <t:${unix(report.created_at)}:R>${url ? ` · [open](${url})` : ''}`;
  return report.reason ? `${head}\n> ${clip(report.reason.replace(/\s+/g, ' '), 120)}` : head;
}

function listButtonId(status, page, userId) {
  return `${LIST_BUTTON_PREFIX}${status}:${page}:${userId ?? 0}`;
}

function parseListButton(customId) {
  const [prefix, status, page, userId] = customId.split(':');
  if (`${prefix}:` !== LIST_BUTTON_PREFIX) return null;
  if (status !== 'all' && !STATUS_LABELS[status]) return null;
  if (!/^\d{1,6}$/.test(page ?? '') || !/^\d{1,25}$/.test(userId ?? '')) return null;
  return { status, page: Number(page), userId: userId === '0' ? null : userId };
}

/** One page of reports. Paging is stateless: the buttons carry the filter, so they keep working after a restart. */
async function buildReportListPayload(guild, { status = 'open', page = 0, reportedUserId = null } = {}) {
  const filter = status === 'all' ? null : status;
  let result = await reportDb.listReports(guild.id, { status: filter, reportedUserId, limit: LIST_PAGE_SIZE, offset: page * LIST_PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(result.count / LIST_PAGE_SIZE));
  let current = Math.min(page, totalPages - 1);
  if (current !== page) result = await reportDb.listReports(guild.id, { status: filter, reportedUserId, limit: LIST_PAGE_SIZE, offset: current * LIST_PAGE_SIZE });

  if (!result.rows.length) {
    const scope = reportedUserId ? ` about <@${reportedUserId}>` : '';
    return noticePayload(`No ${filter ? STATUS_LABELS[filter].toLowerCase() : ''} reports${scope}.`.replace('  ', ' '), COLORS.DEFAULT);
  }

  const rows = [];
  if (totalPages > 1) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(listButtonId(status, current - 1, reportedUserId)).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(current <= 0),
      new ButtonBuilder().setCustomId(`${LIST_BUTTON_PREFIX}page`).setLabel(`${current + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(listButtonId(status, current + 1, reportedUserId)).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(current >= totalPages - 1),
    ));
  }

  return infoPayload({
    accent: 0xfe6465,
    title: `${EMOJI.REPORT} Reports`,
    thumbnail: guild.iconURL({ size: 256 }),
    subtitle: [`${filter ? STATUS_LABELS[filter] : 'All'}${reportedUserId ? ` · about <@${reportedUserId}>` : ''}`, `-# ${result.count} ${result.count === 1 ? 'report' : 'reports'} · Page ${current + 1} of ${totalPages}`],
    sections: [{ lines: result.rows.map((report) => listLine(guild.id, report)), limit: 3000 }],
    footer: 'Use /report view <number> for the full report.',
    rows,
  });
}

async function buildReportViewPayload(guild, reportNumber) {
  const report = await reportDb.getReport(guild.id, reportNumber);
  if (!report) return noticePayload(`Report #${reportNumber} was not found.`, COLORS.RED);

  const payload = {
    components: [buildReportCard(report, { withActions: false })],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
  const url = reportMessageUrl(guild.id, report);
  if (url) payload.components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Open in report channel').setStyle(ButtonStyle.Link).setURL(url)));
  return payload;
}

async function buildReportStatsPayload(guild) {
  const [stats, blocks] = await Promise.all([reportDb.getReportStats(guild.id), reportDb.listBlocks(guild.id, 100)]);
  const active = stats.byStatus.open + stats.byStatus.claimed;

  return infoPayload({
    accent: 0xfe6465,
    title: `${EMOJI.REPORT} Report statistics`,
    thumbnail: guild.iconURL({ size: 256 }),
    subtitle: [guild.name, `-# ${stats.total} ${stats.total === 1 ? 'report' : 'reports'} in total`],
    sections: [
      {
        title: 'Status',
        lines: [
          `**Open** ${stats.byStatus.open} · **Being handled** ${stats.byStatus.claimed}`,
          `**Resolved** ${stats.byStatus.resolved} · **Dismissed** ${stats.byStatus.dismissed}`,
          `**Waiting for staff** ${active}`,
        ],
      },
      {
        title: 'Activity',
        lines: [`**Last 7 days** ${stats.lastWeek}`, `**Members blocked from reporting** ${blocks.length}`],
      },
      stats.mostReported.length
        ? { title: 'Most reported members', lines: stats.mostReported.map((entry) => `<@${entry.userId}> · ${entry.count} ${entry.count === 1 ? 'report' : 'reports'}`) }
        : null,
    ].filter(Boolean),
  });
}

async function buildBlocklistPayload(guild) {
  const blocks = await reportDb.listBlocks(guild.id, 25);
  if (!blocks.length) return noticePayload('Nobody is blocked from sending reports.', COLORS.DEFAULT);

  return infoPayload({
    title: 'Blocked from reporting',
    thumbnail: guild.iconURL({ size: 256 }),
    subtitle: [`-# ${blocks.length} ${blocks.length === 1 ? 'member' : 'members'}`],
    sections: [{
      lines: blocks.map((block) => `<@${block.user_id}> · by <@${block.blocked_by}> · <t:${unix(block.created_at)}:R>${block.reason ? `\n> ${clip(block.reason, 100)}` : ''}`),
      limit: 3000,
    }],
    footer: 'Use /report unblock to restore someone.',
  });
}

module.exports = {
  LIST_PAGE_SIZE,
  LIST_BUTTON_PREFIX,
  parseListButton,
  reportMessageUrl,
  buildReportListPayload,
  buildReportViewPayload,
  buildReportStatsPayload,
  buildBlocklistPayload,
};
