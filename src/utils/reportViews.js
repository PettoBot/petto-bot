const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const reportDb = require('../db/report');
const { buildReportCard, statusLabel } = require('./reportCard');
const { categoryLabel } = require('./reportCategories');
const { infoPayload, noticePayload, clip } = require('./infoCard');
const { EMOJI } = require('./emojis');
const { COLORS } = require('./colors');
const { t, tn, currentLanguage } = require('../i18n');

const LIST_PAGE_SIZE = 8;
const LIST_BUTTON_PREFIX = 'rptl:';
const STATUSES = ['open', 'claimed', 'resolved', 'dismissed'];

function unix(value) {
  return Math.floor(new Date(value).getTime() / 1000);
}

function reportMessageUrl(guildId, report) {
  return report.report_channel_id && report.report_message_id ? `https://discord.com/channels/${guildId}/${report.report_channel_id}/${report.report_message_id}` : null;
}

/** The reporter is deliberately never part of a list line, so anonymous reports stay anonymous. */
function listLine(guildId, report, lang = currentLanguage()) {
  const url = reportMessageUrl(guildId, report);
  const status = STATUSES.includes(report.status) ? statusLabel(report.status, lang) : report.status;
  const head = `**#${report.report_number}** · ${categoryLabel(report.category, lang)} · <@${report.reported_user_id}> · *${status}* · <t:${unix(report.created_at)}:R>${url ? ` · ${t(lang, 'reports.list.openLink', { url })}` : ''}`;
  return report.reason ? `${head}\n> ${clip(report.reason.replace(/\s+/g, ' '), 120)}` : head;
}

function listButtonId(status, page, userId) {
  return `${LIST_BUTTON_PREFIX}${status}:${page}:${userId ?? 0}`;
}

function parseListButton(customId) {
  const [prefix, status, page, userId] = customId.split(':');
  if (`${prefix}:` !== LIST_BUTTON_PREFIX) return null;
  if (status !== 'all' && !STATUSES.includes(status)) return null;
  if (!/^\d{1,6}$/.test(page ?? '') || !/^\d{1,25}$/.test(userId ?? '')) return null;
  return { status, page: Number(page), userId: userId === '0' ? null : userId };
}

/** One page of reports. Paging is stateless: the buttons carry the filter, so they keep working after a restart. */
async function buildReportListPayload(guild, { status = 'open', page = 0, reportedUserId = null, lang = currentLanguage() } = {}) {
  const filter = status === 'all' ? null : status;
  let result = await reportDb.listReports(guild.id, { status: filter, reportedUserId, limit: LIST_PAGE_SIZE, offset: page * LIST_PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(result.count / LIST_PAGE_SIZE));
  let current = Math.min(page, totalPages - 1);
  if (current !== page) result = await reportDb.listReports(guild.id, { status: filter, reportedUserId, limit: LIST_PAGE_SIZE, offset: current * LIST_PAGE_SIZE });

  if (!result.rows.length) {
    const key = `reports.list.empty.${filter ?? 'all'}${reportedUserId ? 'About' : ''}`;
    return noticePayload(t(lang, key, { user: `<@${reportedUserId}>` }), COLORS.DEFAULT);
  }

  const rows = [];
  if (totalPages > 1) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(listButtonId(status, current - 1, reportedUserId)).setLabel(t(lang, 'reports.list.previous.button')).setStyle(ButtonStyle.Secondary).setDisabled(current <= 0),
      new ButtonBuilder().setCustomId(`${LIST_BUTTON_PREFIX}page`).setLabel(`${current + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(listButtonId(status, current + 1, reportedUserId)).setLabel(t(lang, 'reports.list.next.button')).setStyle(ButtonStyle.Secondary).setDisabled(current >= totalPages - 1),
    ));
  }

  return infoPayload({
    accent: 0xfe6465,
    title: t(lang, 'reports.list.title', { emoji: EMOJI.REPORT }),
    thumbnail: guild.iconURL({ size: 256 }),
    subtitle: [
      reportedUserId ? t(lang, 'reports.list.filterAbout', { filter: filter ? statusLabel(filter, lang) : t(lang, 'reports.list.all'), user: `<@${reportedUserId}>` }) : (filter ? statusLabel(filter, lang) : t(lang, 'reports.list.all')),
      `-# ${t(lang, 'reports.list.count', { reports: tn(lang, 'reports.list.reports', result.count, { count: result.count }), page: current + 1, pages: totalPages })}`,
    ],
    sections: [{ lines: result.rows.map((report) => listLine(guild.id, report, lang)), limit: 3000 }],
    footer: t(lang, 'reports.list.footer'),
    rows,
  });
}

async function buildReportViewPayload(guild, reportNumber, lang = currentLanguage()) {
  const report = await reportDb.getReport(guild.id, reportNumber);
  if (!report) return noticePayload(t(lang, 'reports.view.notFound', { number: reportNumber }), COLORS.RED);

  const payload = {
    components: [buildReportCard(report, { withActions: false, lang })],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
  const url = reportMessageUrl(guild.id, report);
  if (url) payload.components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(t(lang, 'reports.view.open.button')).setStyle(ButtonStyle.Link).setURL(url)));
  return payload;
}

async function buildReportStatsPayload(guild, lang = currentLanguage()) {
  const [stats, blocks] = await Promise.all([reportDb.getReportStats(guild.id), reportDb.listBlocks(guild.id, 100)]);
  const active = stats.byStatus.open + stats.byStatus.claimed;

  return infoPayload({
    accent: 0xfe6465,
    title: t(lang, 'reports.stats.title', { emoji: EMOJI.REPORT }),
    thumbnail: guild.iconURL({ size: 256 }),
    subtitle: [guild.name, `-# ${tn(lang, 'reports.stats.total', stats.total, { count: stats.total })}`],
    sections: [
      {
        title: t(lang, 'reports.stats.status'),
        lines: [
          t(lang, 'reports.stats.openClaimed', { open: stats.byStatus.open, claimed: stats.byStatus.claimed }),
          t(lang, 'reports.stats.resolvedDismissed', { resolved: stats.byStatus.resolved, dismissed: stats.byStatus.dismissed }),
          t(lang, 'reports.stats.waiting', { count: active }),
        ],
      },
      {
        title: t(lang, 'reports.stats.activity'),
        lines: [t(lang, 'reports.stats.lastWeek', { count: stats.lastWeek }), t(lang, 'reports.stats.blocked', { count: blocks.length })],
      },
      stats.mostReported.length
        ? { title: t(lang, 'reports.stats.mostReported'), lines: stats.mostReported.map((entry) => `<@${entry.userId}> · ${tn(lang, 'reports.list.reports', entry.count, { count: entry.count })}`) }
        : null,
    ].filter(Boolean),
  });
}

async function buildBlocklistPayload(guild, lang = currentLanguage()) {
  const blocks = await reportDb.listBlocks(guild.id, 25);
  if (!blocks.length) return noticePayload(t(lang, 'reports.blocklist.empty'), COLORS.DEFAULT);

  return infoPayload({
    title: t(lang, 'reports.blocklist.title'),
    thumbnail: guild.iconURL({ size: 256 }),
    subtitle: [`-# ${tn(lang, 'reports.blocklist.members', blocks.length, { count: blocks.length })}`],
    sections: [{
      lines: blocks.map((block) => `<@${block.user_id}> · ${t(lang, 'reports.blocklist.by', { user: `<@${block.blocked_by}>` })} · <t:${unix(block.created_at)}:R>${block.reason ? `\n> ${clip(block.reason, 100)}` : ''}`),
      limit: 3000,
    }],
    footer: t(lang, 'reports.blocklist.footer'),
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
