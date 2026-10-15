const { MessageFlags } = require('discord.js');
const pollsDb = require('../db/polls');
const { updatePollMessage } = require('../utils/pollCard');
const { t, languageOf } = require('../i18n');

async function refreshMessage(interaction, poll, lang) {
  const results = await pollsDb.getResults(poll.id, poll.options.length);
  await updatePollMessage(interaction.message, { guild: interaction.guild, poll, results, lang }).catch(() => {});
}

async function handleVote(interaction) {
  const lang = await languageOf(interaction);
  const [, pollId, idxStr] = interaction.customId.split('::');
  const poll = await pollsDb.getPoll(Number(pollId));
  const idx = Number(idxStr);

  if (!poll || poll.closed) {
    await interaction.reply({ content: t(lang, 'polls.vote.closed'), flags: MessageFlags.Ephemeral });
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
  await refreshMessage(interaction, poll, lang);
}

async function handleClose(interaction) {
  const lang = await languageOf(interaction);
  const [, pollId] = interaction.customId.split('::');
  const poll = await pollsDb.getPoll(Number(pollId));

  if (!poll) {
    await interaction.reply({ content: t(lang, 'polls.vote.gone'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (poll.creator_id !== interaction.user.id) {
    await interaction.reply({ content: t(lang, 'polls.vote.notHost'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (poll.closed) {
    await interaction.reply({ content: t(lang, 'polls.vote.alreadyClosed'), flags: MessageFlags.Ephemeral });
    return;
  }

  await pollsDb.closePoll(poll.id);
  poll.closed = true;
  await interaction.deferUpdate();
  await refreshMessage(interaction, poll, lang);
}

async function handleButton(interaction) {
  if (interaction.customId.startsWith('plv_vote::')) return handleVote(interaction);
  if (interaction.customId.startsWith('plv_close::')) return handleClose(interaction);
}

module.exports = { handleButton };
