// The "Talk to a person" button on the replies of the AI assistant of the tickets: the person who opened the ticket asks for the team.
const { MessageFlags } = require('discord.js');
const ticketsDb = require('../db/tickets');
const flow = require('../utils/ticketAiFlow');
const { t, languageOf } = require('../i18n');
const logger = require('../utils/logger');

async function handleButton(interaction) {
  const lang = await languageOf(interaction);
  const ephemeral = (key) => interaction.reply({ content: t(lang, key), flags: MessageFlags.Ephemeral });
  const ticket = await ticketsDb.getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status !== 'open') return ephemeral('tickets.ai.buttonGone');
  if (interaction.user.id !== ticket.opener_id) return ephemeral('tickets.ai.onlyOpener');

  const state = flow.stateOf(interaction.channelId) ?? flow.remember(interaction.channelId, { stopped: false, replies: 0, latest: null, busy: false, loaded: false });
  if (state.stopped) return ephemeral('tickets.ai.humanAlready');
  state.stopped = true;

  const category = await ticketsDb.getCategoryById(ticket.category_id);
  const roles = flow.pingRoles(interaction.guild, category);
  const card = flow.handoffCard({ lang, handoffText: t(lang, 'tickets.ai.handoff'), roleIds: roles });
  await interaction.channel.send(flow.cardMessage(card, roles)).catch((error) => logger.warn(`[ticket-ai] hand-over message failed: ${error.message}`));
  return ephemeral('tickets.ai.humanDone');
}

module.exports = { handleButton };
