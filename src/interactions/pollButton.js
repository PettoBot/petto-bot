const { MessageFlags } = require('discord.js');
const pollsDb = require('../db/polls');
const { buildPollCard } = require('../utils/pollCard');

async function refreshMessage(interaction, poll) {
  const results = await pollsDb.getResults(poll.id, poll.options.length);
  const { components, rows } = buildPollCard(poll, results);
  await interaction.message.edit({ components: [...components, ...rows], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
}

async function handleVote(interaction) {
  const [, pollId, idxStr] = interaction.customId.split('::');
  const poll = await pollsDb.getPoll(Number(pollId));
  const idx = Number(idxStr);

  if (!poll || poll.closed) {
    await interaction.reply({ content: 'This poll is closed.', flags: MessageFlags.Ephemeral });
    return;
  }

  const existing = await pollsDb.getVote(poll.id, interaction.user.id);
  let choices;
  if (poll.multi) {
    const current = existing?.choices ?? [];
    choices = current.includes(idx) ? current.filter((c) => c !== idx) : [...current, idx];
  } else {
    choices = [idx];
  }

  await pollsDb.castVote(poll.id, interaction.user.id, choices);
  await interaction.deferUpdate();
  await refreshMessage(interaction, poll);
}

async function handleClose(interaction) {
  const [, pollId] = interaction.customId.split('::');
  const poll = await pollsDb.getPoll(Number(pollId));

  if (!poll) {
    await interaction.reply({ content: 'This poll no longer exists.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (poll.creator_id !== interaction.user.id) {
    await interaction.reply({ content: 'Only the person who started this poll can end it.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (poll.closed) {
    await interaction.reply({ content: 'This poll is already closed.', flags: MessageFlags.Ephemeral });
    return;
  }

  await pollsDb.closePoll(poll.id);
  poll.closed = true;
  await interaction.deferUpdate();
  await refreshMessage(interaction, poll);
}

async function handleButton(interaction) {
  if (interaction.customId.startsWith('pl_vote::')) return handleVote(interaction);
  if (interaction.customId.startsWith('pl_close::')) return handleClose(interaction);
}

module.exports = { handleButton };
