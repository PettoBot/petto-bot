// Closes the open tickets whose channel no longer exists (deleted while Petto was offline, or an event that was missed). It runs a
// minute after Petto is ready, so every server has arrived, and then every 30 minutes. It also forgets the message of a panel whose channel was
// deleted. How many it healed is told in the general log. See ticketChannelGone.js.
const { Events } = require('discord.js');
const { reconcileTicketChannels, reconcileTicketPanels } = require('../utils/ticketChannelGone');
const { exclusiveTask } = require('../utils/concurrency');
const logger = require('../utils/logger');

const POLL_INTERVAL_MS = 30 * 60_000;
const FIRST_RUN_DELAY_MS = 60_000;

function startTicketChannelJob(client) {
  const run = exclusiveTask(async () => {
    // The batch of each run is small (100 tickets, 500 panels); what is left is healed by the next one. The count goes to the general log.
    const closed = await reconcileTicketChannels(client);
    const panels = await reconcileTicketPanels(client).catch((err) => { logger.warn(`Ticket panel check failed: ${err?.message ?? err}`); return 0; });
    if (closed || panels) logger.warn(`[Ticket sweep] Healed ${closed} ticket(s) whose channel no longer exists (marked closed) and ${panels} panel(s) that pointed to a deleted channel.`);
  });
  const tick = () => run().catch((err) => logger.error('Ticket channel check error:', err));
  const startLater = () => setTimeout(tick, FIRST_RUN_DELAY_MS).unref?.();
  if (client.isReady?.()) startLater();
  else client.once(Events.ClientReady, startLater);
  setInterval(tick, POLL_INTERVAL_MS).unref?.();
  logger.info('Ticket channel check started (on start and every 30m).');
}

module.exports = { startTicketChannelJob };
