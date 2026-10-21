// Closes the open tickets whose channel no longer exists (deleted while Petto was offline, or an event that was missed). It runs a
// minute after Petto is ready, so every server has arrived, and then every 30 minutes. See ticketChannelGone.js.
const { Events } = require('discord.js');
const { reconcileTicketChannels } = require('../utils/ticketChannelGone');
const { exclusiveTask } = require('../utils/concurrency');
const logger = require('../utils/logger');

const POLL_INTERVAL_MS = 30 * 60_000;
const FIRST_RUN_DELAY_MS = 60_000;

function startTicketChannelJob(client) {
  const run = exclusiveTask(async () => {
    const closed = await reconcileTicketChannels(client);
    if (closed) logger.info(`Ticket channel check: closed ${closed} ticket(s) whose channel is gone.`);
  });
  const tick = () => run().catch((err) => logger.error('Ticket channel check error:', err));
  const startLater = () => setTimeout(tick, FIRST_RUN_DELAY_MS).unref?.();
  if (client.isReady?.()) startLater();
  else client.once(Events.ClientReady, startLater);
  setInterval(tick, POLL_INTERVAL_MS).unref?.();
  logger.info('Ticket channel check started (on start and every 30m).');
}

module.exports = { startTicketChannelJob };
