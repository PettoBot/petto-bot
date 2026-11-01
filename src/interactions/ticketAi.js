// The "Talk to a person" button on the replies of the AI assistant of the tickets: the person who opened the ticket asks for the team.
const ticketsDb = require('../db/tickets');
const flow = require('../utils/ticketAiFlow');
const { safeTicketAction } = require('../utils/safeTicketAction');
const { t, languageOf } = require('../i18n');
const logger = require('../utils/logger');

async function handleButton(interaction, deps = {}) {
  return safeTicketAction(interaction, 'tk_ai_human', async (ctx) => {
    const lang = await languageOf(interaction);
    const ephemeral = (key) => ctx.say(t(lang, key));
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
  }, {
    ack: 'reply',
    lockKey: `tk_ai_human:${interaction.channelId}`,
    label: 'Ticket AI button failed:', // i18n-ignore: log text for the team
    // The channel is gone: nothing to hand over any more.
    onGone: async () => true,
  }, deps.safe);
}

module.exports = { handleButton };
