const { LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const reportDb = require('../db/report');
const { REPORT_BUTTON_PREFIX, buildReportPayload } = require('../utils/reportCard');
const { isReportStaff } = require('../utils/reportService');
const { fetchReportThread, closeReportThread, reopenReportThread, threadUrl } = require('../utils/reportThreads');
const { noticePayload } = require('../utils/infoCard');
const { parseListButton, buildReportListPayload } = require('../utils/reportViews');
const { COLORS } = require('../utils/colors');
const logger = require('../utils/logger');
const { t, languageOf, currentLanguage } = require('../i18n');
const { sendDm } = require('../utils/dmOrigin');

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

// Closing a report needs a reason (shown on the card, written in the thread and sent to the reporter), and so does
// reopening one. The form doubles as the confirmation: nothing changes until it is sent.
const NEEDS_REASON = new Set(['resolve', 'dismiss', 'reopen']);
const ACTIONS = [...Object.keys(TRANSITIONS), 'invite'];

function parseButton(customId) {
  const [prefix, action, number] = customId.split(':');
  if (`${prefix}:` !== REPORT_BUTTON_PREFIX || !ACTIONS.includes(action) || !/^\d{1,9}$/.test(number ?? '')) return null;
  return { action, reportNumber: Number(number) };
}

/** `rptr:<resolve|dismiss|reopen>:<number>`, the id of the form that asks why a report is being closed or reopened. */
function parseReasonModal(customId) {
  const [prefix, action, number] = customId.split(':');
  if (`${prefix}:` !== REASON_MODAL_PREFIX || !NEEDS_REASON.has(action) || !/^\d{1,9}$/.test(number ?? '')) return null;
  return { action, reportNumber: Number(number) };
}

function ephemeral(text, color = COLORS.RED) {
  return { ...noticePayload(text, color), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
}

function buildReasonModal(action, reportNumber, lang = currentLanguage()) {
  const reopening = action === 'reopen';
  return new ModalBuilder()
    .setCustomId(`${REASON_MODAL_PREFIX}${action}:${reportNumber}`)
    .setTitle(t(lang, `reports.reasonForm.${action}.title`, { number: reportNumber }).slice(0, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(t(lang, 'reports.reasonForm.label'))
        .setDescription(reopening ? t(lang, 'reports.reasonForm.reopenHelp') : t(lang, 'reports.reasonForm.closeHelp'))
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('reason')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(t(lang, `reports.reasonForm.${action}.placeholder`))
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
  await sendDm(user, text, { guild: interaction.guild, kind: 'report' }).catch(() => logger.warn(`Could not DM report #${report.report_number} update to ${report.reporter_id}.`));
}

/** The work that follows a status change, once the staff member already has their answer. */
async function afterTransition(interaction, action, report, lang) {
  const config = await reportDb.getConfig(interaction.guild.id).catch(() => null);
  const guildName = interaction.guild.name;
  const thread = await fetchReportThread(interaction.guild, report);

  if (report.status === 'resolved' || report.status === 'dismissed') {
    if (thread) await closeReportThread(thread, { status: report.status, note: report.resolution_note, byId: interaction.user.id, lang });
    if (config?.notify_reporter !== false) {
      const note = report.resolution_note ? `\n> ${report.resolution_note.replace(/\n/g, '\n> ')}` : '';
      const outcome = t(lang, `reports.dm.${report.status}`, { number: report.report_number, server: guildName });
      await dmReporter(interaction, report, `${outcome}${note}\n${t(lang, 'reports.dm.thanks')}`);
    }
    return;
  }

  if (action === 'reopen') {
    if (thread) await reopenReportThread(thread, { byId: interaction.user.id, note: report.reopen_note, lang });
    return;
  }

  if (action === 'claim' && config?.notify_on_claim === true) {
    await dmReporter(interaction, report, t(lang, 'reports.dm.claimed', { number: report.report_number, server: guildName }));
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
  const reopening = action === 'reopen';
  return reportDb.updateReport(
    interaction.guild.id,
    report.report_number,
    {
      status: to,
      handled_by: to === 'open' ? null : interaction.user.id,
      handled_at: to === 'open' ? null : new Date().toISOString(),
      resolution_note: closing ? note : null,
      // Who reopened it and why stays on the card until the report is closed again.
      ...(reopening ? { reopened_by: interaction.user.id, reopen_note: note } : {}),
      ...(closing ? { reopened_by: null, reopen_note: null } : {}),
    },
    { onlyIfStatus: report.status },
  );
}

/** Staff invite the person who reported to the discussion thread, so they can answer questions there. */
async function inviteReporter(interaction, report, lang) {
  if (!report.thread_id || report.anonymous) {
    await interaction.reply(ephemeral(t(lang, report.anonymous ? 'reports.invite.anonymous' : 'reports.invite.noThread')));
    return;
  }

  await interaction.deferUpdate();
  const thread = await fetchReportThread(interaction.guild, report);
  if (!thread) {
    await interaction.followUp(ephemeral(t(lang, 'reports.invite.threadGone')));
    return;
  }

  // A thread that closed after a day without messages has to be opened before somebody can be added.
  if (thread.archived) await thread.setArchived(false, t(lang, 'reports.invite.auditInvited')).catch(() => {});
  try {
    await thread.members.add(report.reporter_id, t(lang, 'reports.invite.auditAdded', { user: interaction.user.username }));
  } catch (err) {
    logger.warn(`Could not invite ${report.reporter_id} to thread ${thread.id}: ${err.message}`);
    await interaction.followUp(ephemeral(t(lang, 'reports.invite.failed')));
    return;
  }

  const updated = await reportDb.updateReport(interaction.guild.id, report.report_number, { reporter_invited_at: new Date().toISOString() }).catch(() => null);
  await interaction.editReply(buildReportPayload(updated ?? report, { lang }));

  await thread
    .send({ content: t(lang, 'reports.invite.threadMessage', { user: `<@${report.reporter_id}>` }), allowedMentions: { parse: [], users: [report.reporter_id] } })
    .catch(() => {});
  await dmReporter(interaction, report, t(lang, 'reports.dm.invited', { number: report.report_number, server: interaction.guild.name, url: threadUrl(interaction.guild.id, thread) }));
}

async function handleButton(interaction) {
  const lang = await languageOf(interaction);
  const parsed = parseButton(interaction.customId);
  if (!parsed || !interaction.guild) {
    await interaction.reply(ephemeral(t(lang, 'reports.action.invalidButton')));
    return true;
  }

  if (!isReportStaff(interaction.member)) {
    await interaction.reply(ephemeral(t(lang, 'reports.action.staffOnly')));
    return true;
  }

  const report = await reportDb.getReport(interaction.guild.id, parsed.reportNumber).catch(() => null);
  if (!report) {
    await interaction.reply(ephemeral(t(lang, 'reports.action.gone', { number: parsed.reportNumber })));
    return true;
  }

  if (parsed.action === 'invite') {
    await inviteReporter(interaction, report, lang);
    return true;
  }

  const [from] = TRANSITIONS[parsed.action];
  if (!from.includes(report.status)) {
    // Somebody already acted on it; show the current state instead of an error.
    await interaction.update(buildReportPayload(report, { lang })).catch(() => {});
    return true;
  }

  // Closing and reopening ask for a reason first; the change happens when the form is sent.
  if (NEEDS_REASON.has(parsed.action)) {
    await interaction.showModal(buildReasonModal(parsed.action, report.report_number, lang));
    return true;
  }

  const updated = await applyTransition(interaction, report, parsed.action);
  if (!updated) {
    const current = await reportDb.getReport(interaction.guild.id, report.report_number).catch(() => null);
    await interaction.update(buildReportPayload(current ?? report, { lang })).catch(() => {});
    return true;
  }

  // The staff member gets the new card at once; the thread and the DMs follow.
  await interaction.update(buildReportPayload(updated, { lang }));
  await afterTransition(interaction, parsed.action, updated, lang).catch((err) => logger.error(`Report #${updated.report_number} follow-up failed:`, err));
  return true;
}

/** The form that asks why a report is being resolved, dismissed or reopened. */
async function handleReasonModal(interaction) {
  const lang = await languageOf(interaction);
  const parsed = parseReasonModal(interaction.customId);
  if (!parsed || !interaction.guild) {
    await interaction.reply(ephemeral(t(lang, 'reports.action.invalidForm')));
    return true;
  }

  if (!isReportStaff(interaction.member)) {
    await interaction.reply(ephemeral(t(lang, 'reports.action.staffOnly')));
    return true;
  }

  const note = interaction.fields.getTextInputValue('reason').trim();
  if (note.length < REASON_MIN_LENGTH) {
    await interaction.reply(ephemeral(t(lang, 'reports.action.reasonTooShort', { min: REASON_MIN_LENGTH })));
    return true;
  }

  const report = await reportDb.getReport(interaction.guild.id, parsed.reportNumber).catch(() => null);
  if (!report) {
    await interaction.reply(ephemeral(t(lang, 'reports.action.gone', { number: parsed.reportNumber })));
    return true;
  }

  const [from] = TRANSITIONS[parsed.action];
  const updated = from.includes(report.status) ? await applyTransition(interaction, report, parsed.action, note) : null;
  const shown = updated ?? (await reportDb.getReport(interaction.guild.id, report.report_number).catch(() => null)) ?? report;

  // The form was opened from the report card, so the card is updated in place.
  if (interaction.isFromMessage?.()) await interaction.update(buildReportPayload(shown, { lang }));
  else await interaction.reply(ephemeral(t(lang, updated ? 'reports.action.updated' : 'reports.action.alreadyHandled'), COLORS.GREEN));

  if (updated) await afterTransition(interaction, parsed.action, updated, lang).catch((err) => logger.error(`Report #${updated.report_number} follow-up failed:`, err));
  return true;
}

/** Previous/next on `/report list`. The button carries the filter, so no state is kept between clicks. */
async function handleListButton(interaction) {
  const lang = await languageOf(interaction);
  const parsed = parseListButton(interaction.customId);
  if (!parsed || !interaction.guild) {
    await interaction.reply(ephemeral(t(lang, 'reports.list.expired')));
    return true;
  }
  if (!isReportStaff(interaction.member)) {
    await interaction.reply(ephemeral(t(lang, 'reports.list.staffOnly')));
    return true;
  }
  await interaction.update(await buildReportListPayload(interaction.guild, { status: parsed.status, page: parsed.page, reportedUserId: parsed.userId, lang }));
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
