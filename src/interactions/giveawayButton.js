const { MessageFlags } = require('discord.js');
const giveawaysDb = require('../db/giveaways');
const { handleForfeit, handleAccept } = require('../utils/giveawayEngine');

async function handleEnter(interaction) {
  const giveawayId = Number(interaction.customId.split('::')[1]);
  const giveaway = await giveawaysDb.getGiveaway(giveawayId);

  if (!giveaway || giveaway.ended) {
    await interaction.reply({ content: 'This giveaway has ended.', flags: MessageFlags.Ephemeral });
    return;
  }

  const already = await giveawaysDb.hasEntry(giveawayId, interaction.user.id);
  if (already) {
    await giveawaysDb.removeEntry(giveawayId, interaction.user.id);
    await interaction.reply({ content: 'You left the giveaway.', flags: MessageFlags.Ephemeral });
    return;
  }

  await giveawaysDb.addEntry(giveawayId, interaction.user.id, 1);
  await interaction.reply({ content: '🎉 You entered the giveaway! Click the button again to leave.', flags: MessageFlags.Ephemeral });
}

async function handleAcceptClick(interaction) {
  const winnerId = Number(interaction.customId.split('::')[1]);
  const winnerRow = await giveawaysDb.getWinner(winnerId);

  if (!winnerRow) {
    await interaction.reply({ content: 'This claim no longer exists.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (winnerRow.user_id !== interaction.user.id) {
    await interaction.reply({ content: "This isn't your win to claim.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (winnerRow.status !== 'pending') {
    await interaction.reply({ content: 'This claim was already resolved.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();
  await interaction.message.edit({ components: [] }).catch(() => {});
  await handleAccept(interaction.client, winnerRow);
}

async function handleDenyClick(interaction) {
  const winnerId = Number(interaction.customId.split('::')[1]);
  const winnerRow = await giveawaysDb.getWinner(winnerId);

  if (!winnerRow) {
    await interaction.reply({ content: 'This claim no longer exists.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (winnerRow.user_id !== interaction.user.id) {
    await interaction.reply({ content: "This isn't your win to deny.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (winnerRow.status !== 'pending') {
    await interaction.reply({ content: 'This claim was already resolved.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();
  await interaction.message.edit({ components: [] }).catch(() => {});
  await handleForfeit(interaction.client, winnerRow, 'denied');
}

async function handleButton(interaction) {
  if (interaction.customId.startsWith('gw_enter::')) return handleEnter(interaction);
  if (interaction.customId.startsWith('gw_accept::')) return handleAcceptClick(interaction);
  if (interaction.customId.startsWith('gw_deny::')) return handleDenyClick(interaction);
}

module.exports = { handleButton };
