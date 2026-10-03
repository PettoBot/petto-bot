// The buttons of a request card: claim, unclaim, done and cancel.
const { MessageFlags } = require('discord.js');
const requestsDb = require('../db/requests');
const { PREFIX, requestCard, mayPress } = require('../utils/requestCards');

const say = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

async function handleButton(interaction) {
  const [action, rawNumber] = interaction.customId.slice(PREFIX.length).split(':');
  const number = Number(rawNumber);
  if (!interaction.guild || !Number.isInteger(number)) return say(interaction, 'This request is not available.');

  const [request, config] = await Promise.all([requestsDb.get(interaction.guild.id, number), requestsDb.getConfig(interaction.guild.id)]);
  if (!request || !config) return say(interaction, 'This request is not available anymore.');
  const verdict = mayPress(action, request, interaction.member, config);
  if (!verdict.allowed) return say(interaction, verdict.reason);

  const now = new Date().toISOString();
  const changes = {
    claim: { status: 'claimed', claimed_by: interaction.user.id, claimed_at: now },
    unclaim: { status: 'open', claimed_by: null, claimed_at: null },
    done: { status: 'done', completed_at: now },
    cancel: { status: 'cancelled' },
  }[action];
  const updated = await requestsDb.update(interaction.guild.id, number, changes);
  if (!updated) return say(interaction, 'This request is not available anymore.');

  await interaction.update({ components: [requestCard(updated)], flags: MessageFlags.IsComponentsV2 });
  if (action === 'done') await interaction.channel?.send({ content: `<@${updated.user_id}> your request #${updated.number} is done, thanks to <@${interaction.user.id}>.`, allowedMentions: { users: [updated.user_id] } }).catch(() => null);
  return undefined;
}

module.exports = { handleButton };
