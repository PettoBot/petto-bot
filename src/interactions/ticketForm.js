const { MessageFlags } = require('discord.js');
const db = require('../db/tickets');
const formsDb = require('../db/ticketForms');
const { openTicket } = require('../utils/ticketActions');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');

async function handleModal(interaction) {
  const [, categoryId, formId] = interaction.customId.split('::');
  const category = await db.getCategoryById(categoryId);
  const form = await formsDb.getFormById(formId);
  if (!category || !form || String(category.form_id) !== String(form.id)) {
    await interaction.reply({ content: 'This ticket form is no longer available.', flags: MessageFlags.Ephemeral });
    return;
  }

  const answers = {};
  for (const field of form.fields ?? []) {
    const value = interaction.fields.getTextInputValue(`field::${field.id}`)?.trim() ?? '';
    if (field.required !== false && !value) {
      await interaction.reply({ content: `Please complete **${field.label}**.`, flags: MessageFlags.Ephemeral });
      return;
    }
    answers[field.label] = value;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const { channel } = await openTicket({ guild: interaction.guild, client: interaction.client, category, opener: interaction.user, formAnswers: answers });
    await interaction.editReply({ content: `${EMOJI.APPROVE} Ticket opened: ${channel}` });
  } catch (err) {
    await interaction.editReply({ content: err.userFacing ? err.message : 'I was unable to open a ticket. Check my permissions (Manage Channels) and try again.' });
    if (!err.userFacing) logger.error('Ticket form submit failed:', err);
  }
}

module.exports = { handleModal };
