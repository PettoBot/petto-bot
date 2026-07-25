const { MessageFlags } = require('discord.js');
const db = require('../db/tickets');
const { openTicketInteractive } = require('../utils/ticketActions');

async function openFromKey(interaction, categoryKey) {
  const category = await db.getCategoryByKey(interaction.guild.id, categoryKey);
  if (!category) {
    await interaction.reply({ content: 'This ticket category no longer exists.', flags: MessageFlags.Ephemeral });
    return;
  }
  await openTicketInteractive(interaction, category);
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
