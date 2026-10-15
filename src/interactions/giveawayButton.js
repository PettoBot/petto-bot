const { MessageFlags } = require('discord.js');
const giveawaysDb = require('../db/giveaways');
const { handleForfeit, handleAccept, refreshGiveawayMessage, loadPreset, entryProblem } = require('../utils/giveawayEngine');
const { t, languageOf } = require('../i18n');

async function handleEnter(interaction) {
  const lang = await languageOf(interaction);
  const giveawayId = Number(interaction.customId.split('::')[1]);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const giveaway = await giveawaysDb.getGiveaway(giveawayId);

  if (!giveaway || giveaway.ended) {
    await interaction.editReply({ content: t(lang, 'giveaways.entry.ended') });
    return;
  }

  const already = await giveawaysDb.hasEntry(giveawayId, interaction.user.id);
  if (already) {
    await giveawaysDb.removeEntry(giveawayId, interaction.user.id);
    await refreshGiveawayMessage(interaction.channel, giveaway).catch(() => {});
    await interaction.editReply({ content: t(lang, 'giveaways.entry.left') });
    return;
  }

  // A preset can ask for a level (messages and/or voice) to enter.
  if (giveaway.preset_id) {
    const problem = await entryProblem(giveaway.guild_id, await loadPreset(giveaway.preset_id), interaction.user.id, lang).catch(() => null);
    if (problem) {
      await interaction.editReply({ content: problem });
      return;
    }
  }

  await giveawaysDb.addEntry(giveawayId, interaction.user.id, 1);
  await refreshGiveawayMessage(interaction.channel, giveaway).catch(() => {});
  await interaction.editReply({ content: t(lang, 'giveaways.entry.entered') });
}

async function handleAcceptClick(interaction) {
  const lang = await languageOf(interaction);
  const winnerId = Number(interaction.customId.split('::')[1]);
  const winnerRow = await giveawaysDb.getWinner(winnerId);

  if (!winnerRow) {
    await interaction.reply({ content: t(lang, 'giveaways.claim.gone'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (winnerRow.user_id !== interaction.user.id) {
    await interaction.reply({ content: t(lang, 'giveaways.claim.notYoursAccept'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (winnerRow.status !== 'pending') {
    await interaction.reply({ content: t(lang, 'giveaways.claim.resolved'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();
  await interaction.message.edit({ components: [] }).catch(() => {});
  await handleAccept(interaction.client, winnerRow);
}

async function handleDenyClick(interaction) {
  const lang = await languageOf(interaction);
  const winnerId = Number(interaction.customId.split('::')[1]);
  const winnerRow = await giveawaysDb.getWinner(winnerId);

  if (!winnerRow) {
    await interaction.reply({ content: t(lang, 'giveaways.claim.gone'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (winnerRow.user_id !== interaction.user.id) {
    await interaction.reply({ content: t(lang, 'giveaways.claim.notYoursDeny'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (winnerRow.status !== 'pending') {
    await interaction.reply({ content: t(lang, 'giveaways.claim.resolved'), flags: MessageFlags.Ephemeral });
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
