const autoMessagesDb = require('../db/autoMessages');
const logger = require('../utils/logger');

const POLL_INTERVAL_MS = 30_000;

async function processDueAutoMessages(client) {
  const rows = await autoMessagesDb.listDue();
  for (const row of rows) {
    try {
      const channel = await client.channels.fetch(row.channel_id).catch(() => null);
      if (channel?.isTextBased()) await channel.send({ content: row.message, allowedMentions: { parse: [] } }).catch(() => {});
      await autoMessagesDb.scheduleNext(row.id, row.next_run_at, row.interval_ms);
    } catch (err) {
      logger.error(`Failed to process timer #${row.id}:`, err);
      await autoMessagesDb.scheduleNext(row.id, row.next_run_at, row.interval_ms).catch(() => {});
    }
  }
}

function startAutoMessageJob(client) {
  setInterval(() => processDueAutoMessages(client).catch((err) => logger.error('Timer job error:', err)), POLL_INTERVAL_MS);
  logger.info('Timer job started (checking every 30s).');
}

module.exports = { startAutoMessageJob, processDueAutoMessages };
