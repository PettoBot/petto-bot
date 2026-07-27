const { checkTicketAutoclose } = require('../utils/ticketAutoclose');
const logger = require('../utils/logger');

const POLL_INTERVAL_MS = 15 * 60_000;

function startTicketAutocloseJob(client) {
  setInterval(() => {
    checkTicketAutoclose(client).catch((err) => logger.error('Ticket autoclose job error:', err));
  }, POLL_INTERVAL_MS);
  logger.info('Ticket autoclose job started (checking every 15m).');
}

module.exports = { startTicketAutocloseJob };
