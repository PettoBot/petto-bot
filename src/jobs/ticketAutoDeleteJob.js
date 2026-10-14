// Deletes the channel of a closed ticket after the hours the server chose (the transcript is kept). Every 30 minutes.
const settingsDb = require('../db/ticketSettings');
const db = require('../db/tickets');
const actions = require('../utils/ticketActions');
const { deleteCutoff } = require('../utils/ticketReminders');
const { forEachWithConcurrency, exclusiveTask } = require('../utils/concurrency');
const config = require('../config');
const logger = require('../utils/logger');

const POLL_INTERVAL_MS = 30 * 60_000;

async function checkTicketAutoDelete(client) {
  const guilds = await settingsDb.listAutoDeleteEnabled();
  await forEachWithConcurrency(guilds, async (row) => {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) return;
    const cutoff = deleteCutoff(row.auto_delete_closed_hours);
    if (!cutoff) return;
    const tickets = await db.listClosedWithChannelBefore(guild.id, cutoff).catch((err) => { logger.warn(`Ticket auto delete: could not list the tickets of ${guild.id}: ${err.message}`); return []; });
    for (const ticket of tickets) {
      const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
      if (!channel) { await db.setTicketChannel(ticket.id, null).catch(() => {}); continue; }
      await actions.deleteTicketChannel({ guild, client, channel, ticket, actor: client.user }).catch((err) => logger.warn(`Ticket #${ticket.ticket_number}: the channel could not be deleted: ${err.message}`));
    }
  }, config.jobConcurrency);
}

function startTicketAutoDeleteJob(client) {
  const run = exclusiveTask(() => checkTicketAutoDelete(client));
  setInterval(() => run().catch((err) => logger.error('Ticket auto delete job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Ticket auto delete job started (checking every 30m).');
}

module.exports = { startTicketAutoDeleteJob, checkTicketAutoDelete };
