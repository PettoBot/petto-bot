const { MessageFlags } = require('discord.js');
const db = require('../db/tickets');
const { openTicketInteractive } = require('../utils/ticketActions');
const { t, languageOf } = require('../i18n');

async function openFromKey(interaction, categoryKey) {
  const lang = await languageOf(interaction);
  const category = await db.getCategoryByKey(interaction.guild.id, categoryKey);
  if (!category) {
    await interaction.reply({ content: t(lang, 'tickets.categoryGone'), flags: MessageFlags.Ephemeral });
    return;
  }
  await openTicketInteractive(interaction, category, lang);
}

/** Panel button click — customId `tk_open::<categoryKey>`. */
async function handleButton(interaction) {
  const [, categoryKey] = interaction.customId.split('::');
  await openFromKey(interaction, categoryKey);
}

/** Panel dropdown selection — customId `tk_open_select`, value is the chosen category key. */
async function handleSelect(interaction) {
  await openFromKey(interaction, interaction.values[0]);
}

module.exports = { handleButton, handleSelect };
