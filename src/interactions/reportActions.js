const { LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const reportDb = require('../db/report');
const { REPORT_BUTTON_PREFIX, buildReportPayload } = require('../utils/reportCard');
const { isReportStaff } = require('../utils/reportService');
const { fetchReportThread, closeReportThread, reopenReportThread, threadUrl } = require('../utils/reportThreads');
const { noticePayload } = require('../utils/infoCard');
const { parseListButton, buildReportListPayload } = require('../utils/reportViews');
const { COLORS } = require('../utils/colors');
const logger = require('../utils/logger');

const REASON_MODAL_PREFIX = 'rptr:';
const REASON_MIN_LENGTH = 3;
const REASON_MAX_LENGTH = 500;

// action -> [statuses it can start from, status it leads to]
const TRANSITIONS = {
  claim: [['open'], 'claimed'],
  release: [['claimed'], 'open'],
  resolve: [['open', 'claimed'], 'resolved'],
  dismiss: [['open', 'claimed'], 'dismissed'],
  reopen: [['resolved', 'dismissed'], 'open'],
};

// Closing a report needs a reason: it is shown on the card, written in the thread and sent to the reporter.
const NEEDS_REASON = new Set(['resolve', 'dismiss']);
const ACTIONS = [...Object.keys(TRANSITIONS), 'invite'];

const OUTCOME_WORDS = { resolved: 'resolved', dismissed: 'reviewed and closed' };

function parseButton(customId) {
  const [prefix, action, number] = customId.split(':');
  if (`${prefix}:` !== REPORT_BUTTON_PREFIX || !ACTIONS.includes(action) || !/^\d{1,9}$/.test(number ?? '')) return null;
  return { action, reportNumber: Number(number) };
}

/** `rptr:<resolve|dismiss>:<number>`, the id of the form that asks why a report is being closed. */
function parseReasonModal(customId) {
  const [prefix, action, number] = customId.split(':');
  if (`${prefix}:` !== REASON_MODAL_PREFIX || !NEEDS_REASON.has(action) || !/^\d{1,9}$/.test(number ?? '')) return null;
  return { action, reportNumber: Number(number) };
}

function ephemeral(text, color = COLORS.RED) {
  return { ...noticePayload(text, color), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
}

function buildReasonModal(action, reportNumber) {
  return new ModalBuilder()
    .setCustomId(`${REASON_MODAL_PREFIX}${action}:${reportNumber}`)
    .setTitle(`${action === 'resolve' ? 'Resolve' : 'Dismiss'} report #${reportNumber}`.slice(0, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Reason')
        .setDescription('Shown on the report and sent to the person who reported it.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('reason')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(action === 'resolve' ? 'What was done about it?' : 'Why is there nothing to act on?')
            .setMinLength(REASON_MIN_LENGTH)
            .setMaxLength(REASON_MAX_LENGTH)
            .setRequired(true),
        ),
    );
}

/** Sends a DM to whoever sent the report. Never says who handled it, and never fails the click. */
async function dmReporter(interaction, report, text) {
  const user = await interaction.client.users.fetch(report.reporter_id).catch(() => null);
  if (!user) return;
  await user.send(text).catch(() => logger.warn(`Could not DM report #${report.report_number} update to ${report.reporter_id}.`));
}

/** The work that follows a status change, once the staff member already has their answer. */
async function afterTransition(interaction, action, report) {
  const config = await reportDb.getConfig(interaction.guild.id).catch(() => null);
  const guildName = interaction.guild.name;
  const thread = await fetchReportThread(interaction.guild, report);

  if (report.status === 'resolved' || report.status === 'dismissed') {
    if (thread) await closeReportThread(thread, { status: report.status, note: report.resolution_note, byId: interaction.user.id });
    if (config?.notify_reporter !== false) {
      const note = report.resolution_note ? `\n> ${report.resolution_note.replace(/\n/g, '\n> ')}` : '';
      await dmReporter(interaction, report, `Your report **#${report.report_number}** in **${guildName}** was ${OUTCOME_WORDS[report.status]}.${note}\nThank you for helping keep the server safe.`);
    }
    return;
  }

  if (action === 'reopen') {
    if (thread) await reopenReportThread(thread, { byId: interaction.user.id });
    return;
  }

  if (action === 'claim' && config?.notify_on_claim === true) {
    await dmReporter(interaction, report, `Your report **#${report.report_number}** in **${guildName}** is now being reviewed by the staff team. We will let you know when it is closed.`);
  }
}

/**
 * Moves a report to its next status. The change only applies while the report is still in the status the click was
 * based on, so two staff members cannot overwrite each other. Resolves to the updated report, or null when somebody
 * else got there first.
 */
async function applyTransition(interaction, report, action, note = null) {
  const [, to] = TRANSITIONS[action];
  const closing = to === 'resolved' || to === 'dismissed';
  return reportDb.updateReport(
    interaction.guild.id,
    report.report_number,
    {
      status: to,
      handled_by: to === 'open' ? null : interaction.user.id,
      handled_at: to === 'open' ? null : new Date().toISOString(),
      resolution_note: closing ? note : null,
    },
    { onlyIfStatus: report.status },
  );
}

/** Staff invite the person who reported to the discussion thread, so they can answer questions there. */
async function inviteReporter(interaction, report) {
  if (!report.thread_id || report.anonymous) {
    await interaction.reply(ephemeral(report.anonymous ? 'This report is anonymous, so the reporter cannot be invited.' : 'This report has no discussion thread.'));
    return;
  }

  await interaction.deferUpdate();
  const thread = await fetchReportThread(interaction.guild, report);
  if (!thread) {
    await interaction.followUp(ephemeral('The discussion thread no longer exists.'));
    return;
  }

  // A thread that closed after a day without messages has to be opened before somebody can be added.
  if (thread.archived) await thread.setArchived(false, 'Reporter invited').catch(() => {});
  try {
    await thread.members.add(report.reporter_id, `Invited to the report discussion by ${interaction.user.username}`);
  } catch (err) {
    logger.warn(`Could not invite ${report.reporter_id} to thread ${thread.id}: ${err.message}`);
    await interaction.followUp(ephemeral('I could not add them to the thread. They may have left the server, or Discord does not let me add them.'));
    return;
  }

  const updated = await reportDb.updateReport(interaction.guild.id, report.report_number, { reporter_invited_at: new Date().toISOString() }).catch(() => null);
  await interaction.editReply(buildReportPayload(updated ?? report));

  await thread
    .send({ content: `<@${report.reporter_id}>, the staff team invited you to talk about your report here.`, allowedMentions: { parse: [], users: [report.reporter_id] } })
    .catch(() => {});
  await dmReporter(interaction, report, `The staff team invited you to talk about your report **#${report.report_number}** in **${interaction.guild.name}**: ${threadUrl(interaction.guild.id, thread)}`);
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

  if (parsed.action === 'invite') {
    await inviteReporter(interaction, report);
    return true;
  }

  const [from] = TRANSITIONS[parsed.action];
  if (!from.includes(report.status)) {
    // Somebody already acted on it; show the current state instead of an error.
    await interaction.update(buildReportPayload(report)).catch(() => {});
    return true;
  }

  // Closing asks for the reason first; the change happens when the form is sent.
  if (NEEDS_REASON.has(parsed.action)) {
    await interaction.showModal(buildReasonModal(parsed.action, report.report_number));
    return true;
  }

  const updated = await applyTransition(interaction, report, parsed.action);
  if (!updated) {
    const current = await reportDb.getReport(interaction.guild.id, report.report_number).catch(() => null);
    await interaction.update(buildReportPayload(current ?? report)).catch(() => {});
    return true;
  }

  // The staff member gets the new card at once; the thread and the DMs follow.
  await interaction.update(buildReportPayload(updated));
  await afterTransition(interaction, parsed.action, updated).catch((err) => logger.error(`Report #${updated.report_number} follow-up failed:`, err));
  return true;
}

/** The form that asks why a report is being resolved or dismissed. */
async function handleReasonModal(interaction) {
  const parsed = parseReasonModal(interaction.customId);
  if (!parsed || !interaction.guild) {
    await interaction.reply(ephemeral('This form is no longer valid.'));
    return true;
  }

  if (!isReportStaff(interaction.member)) {
    await interaction.reply(ephemeral('Only staff can handle reports (Manage Messages, Moderate Members or Manage Server).'));
    return true;
  }

  const note = interaction.fields.getTextInputValue('reason').trim();
  if (note.length < REASON_MIN_LENGTH) {
    await interaction.reply(ephemeral(`Write a reason of at least ${REASON_MIN_LENGTH} characters.`));
    return true;
  }

  const report = await reportDb.getReport(interaction.guild.id, parsed.reportNumber).catch(() => null);
  if (!report) {
    await interaction.reply(ephemeral(`Report #${parsed.reportNumber} no longer exists.`));
    return true;
  }

  const [from] = TRANSITIONS[parsed.action];
  const updated = from.includes(report.status) ? await applyTransition(interaction, report, parsed.action, note) : null;
  const shown = updated ?? (await reportDb.getReport(interaction.guild.id, report.report_number).catch(() => null)) ?? report;

  // The form was opened from the report card, so the card is updated in place.
  if (interaction.isFromMessage?.()) await interaction.update(buildReportPayload(shown));
  else await interaction.reply(ephemeral(updated ? 'The report was updated.' : 'Somebody else already handled this report.', COLORS.GREEN));

  if (updated) await afterTransition(interaction, parsed.action, updated).catch((err) => logger.error(`Report #${updated.report_number} follow-up failed:`, err));
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

module.exports = {
  REASON_MODAL_PREFIX,
  handleButton,
  handleReasonModal,
  handleListButton,
  parseButton,
  parseReasonModal,
  buildReasonModal,
  TRANSITIONS,
  NEEDS_REASON,
};
