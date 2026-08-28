const { checkTicketAutoclose } = require('../utils/ticketAutoclose');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const POLL_INTERVAL_MS = 15 * 60_000;

function startTicketAutocloseJob(client) {
  const run = exclusiveTask(() => checkTicketAutoclose(client));
  setInterval(() => run().catch((err) => logger.error('Ticket autoclose job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Ticket autoclose job started (checking every 15m).');
}

module.exports = { startTicketAutocloseJob };
