const { MessageFlags } = require('discord.js');
const db = require('../db/tickets');
const formsDb = require('../db/ticketForms');
const { openTicket } = require('../utils/ticketActions');
const { describeTicketOpenError } = require('../utils/ticketErrors');
const { usableFields, readAnswers } = require('../utils/ticketFormFields');
const { prepareFiles, answersMap, showName } = require('../utils/ticketAnswers');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');
const { t, languageOf } = require('../i18n');

/**
 * The form of a ticket was sent: the answers are read (text, choices, marks, members, roles, channels and files), checked (what is required;
 * only pictures where the question asks for pictures) and the ticket opens with them. Every refusal is told to the member alone.
 * `deps.download` replaces the download of the files (the checks do).
 */
async function handleModal(interaction, deps = {}) {
  const [, categoryId, formId] = interaction.customId.split('::');
  const lang = await languageOf(interaction);
  const category = await db.getCategoryById(categoryId);
  const form = await formsDb.getFormById(formId);
  const fields = form ? usableFields(form.fields) : [];
  if (!category || !form || String(category.form_id) !== String(form.id) || !fields.length) {
    await interaction.reply({ content: t(lang, 'tickets.form.unavailable'), flags: MessageFlags.Ephemeral });
    return;
  }

  // Copying the files takes longer than the three seconds Discord gives, so the answer is deferred first.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { entries, missing } = readAnswers(fields, interaction.fields.fields);
  if (missing.length) {
    await interaction.editReply({ content: t(lang, 'tickets.form.completeField', { field: missing[0] }) });
    return;
  }
  const { refused } = await prepareFiles(entries, { guild: interaction.guild, download: deps.download });
  if (refused) {
    await interaction.editReply({ content: t(lang, 'tickets.form.notImage', { emoji: EMOJI.DENY, field: refused.label, file: showName(refused.name) }) });
    return;
  }

  try {
    const { channel } = await openTicket({ guild: interaction.guild, client: interaction.client, category, opener: interaction.user, formAnswers: answersMap(entries), formEntries: entries });
    await interaction.editReply({ content: t(lang, 'tickets.open.done', { emoji: EMOJI.APPROVE, channel: `${channel}` }) });
  } catch (err) {
    await interaction.editReply({ content: describeTicketOpenError(err, lang) });
    if (!err.userFacing) logger.error('Ticket form submit failed:', err);
  }
}

module.exports = { handleModal };
