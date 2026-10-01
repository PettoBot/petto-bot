const { MessageFlags } = require('discord.js');
const reportDb = require('../db/report');
const { REPORT_BUTTON_PREFIX, buildReportPayload } = require('../utils/reportCard');
const { isReportStaff } = require('../utils/reportService');
const { noticePayload } = require('../utils/infoCard');
const { parseListButton, buildReportListPayload } = require('../utils/reportViews');
const { COLORS } = require('../utils/colors');
const logger = require('../utils/logger');

// action -> [statuses it can start from, status it leads to]
const TRANSITIONS = {
  claim: [['open'], 'claimed'],
  release: [['claimed'], 'open'],
  resolve: [['open', 'claimed'], 'resolved'],
  dismiss: [['open', 'claimed'], 'dismissed'],
  reopen: [['resolved', 'dismissed'], 'open'],
};

const OUTCOME_WORDS = { resolved: 'resolved', dismissed: 'reviewed and closed' };

function parseButton(customId) {
  const [prefix, action, number] = customId.split(':');
  if (`${prefix}:` !== REPORT_BUTTON_PREFIX || !TRANSITIONS[action] || !/^\d{1,9}$/.test(number ?? '')) return null;
  return { action, reportNumber: Number(number) };
}

function ephemeral(text, color = COLORS.RED) {
  return { ...noticePayload(text, color), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
}

/** Lets the person who sent a report know it was looked at. Never says who handled it, and never fails the click. */
async function notifyReporter(interaction, report) {
  const config = await reportDb.getConfig(interaction.guild.id).catch(() => null);
  if (config && config.notify_reporter === false) return;
  const user = await interaction.client.users.fetch(report.reporter_id).catch(() => null);
  if (!user) return;
  await user
    .send(`Your report **#${report.report_number}** in **${interaction.guild.name}** was ${OUTCOME_WORDS[report.status] ?? 'updated'}. Thank you for helping keep the server safe.`)
    .catch(() => logger.warn(`Could not DM report #${report.report_number} outcome to ${report.reporter_id}.`));
}

async function handleButton(interaction) {
  const parsed = parseButton(interaction.customId);
  if (!parsed || !interaction.guild) {
    await interaction.reply(ephemeral('This report button is no longer valid.'));
    return true;
  }

  if (!isReportStaff(interaction.member)) {
    await interaction.reply(ephemeral('Only staff can handle reports (Manage Messages, Moderate Members or Manage Server).'));
    return true;
  }

  const report = await reportDb.getReport(interaction.guild.id, parsed.reportNumber).catch(() => null);
  if (!report) {
    await interaction.reply(ephemeral(`Report #${parsed.reportNumber} no longer exists.`));
    return true;
  }

  const [from, to] = TRANSITIONS[parsed.action];
  if (!from.includes(report.status)) {
    // Somebody already acted on it; show the current state instead of an error.
    await interaction.update(buildReportPayload(report)).catch(() => {});
    return true;
  }

  const closing = to === 'resolved' || to === 'dismissed';
  const updated = await reportDb.updateReport(
    interaction.guild.id,
    report.report_number,
    {
      status: to,
      handled_by: to === 'open' ? null : interaction.user.id,
      handled_at: to === 'open' ? null : new Date().toISOString(),
    },
    { onlyIfStatus: report.status },
  );

  if (!updated) {
    const current = await reportDb.getReport(interaction.guild.id, report.report_number).catch(() => null);
    await interaction.update(buildReportPayload(current ?? report)).catch(() => {});
    return true;
  }

  await interaction.update(buildReportPayload(updated));
  if (closing) await notifyReporter(interaction, updated);
  return true;
}

/** Previous/next on `/report list`. The button carries the filter, so no state is kept between clicks. */
async function handleListButton(interaction) {
  const parsed = parseListButton(interaction.customId);
  if (!parsed || !interaction.guild) {
    await interaction.reply(ephemeral('This page is no longer available. Run `/report list` again.'));
    return true;
  }
  if (!isReportStaff(interaction.member)) {
    await interaction.reply(ephemeral('Only staff can browse reports.'));
    return true;
  }
  await interaction.update(await buildReportListPayload(interaction.guild, { status: parsed.status, page: parsed.page, reportedUserId: parsed.userId }));
  return true;
}

module.exports = { handleButton, handleListButton, parseButton, TRANSITIONS };
