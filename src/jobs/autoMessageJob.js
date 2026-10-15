const autoMessagesDb = require('../db/autoMessages');
const { sendAs } = require('../utils/senderIdentity');
const logger = require('../utils/logger');
const config = require('../config');
const { forEachWithConcurrency, exclusiveTask } = require('../utils/concurrency');
const { runWithLanguage, guildLanguage } = require('../i18n');

const POLL_INTERVAL_MS = 30_000;

async function processDueAutoMessages(client) {
  const rows = await autoMessagesDb.listDue();
  await forEachWithConcurrency(rows, async (row) => {
    try {
      const channel = await client.channels.fetch(row.channel_id).catch(() => null);
      // The message is the server's own text; the send runs in the server's language anyway, like an event would.
      const lang = await guildLanguage(row.guild_id ?? channel?.guild?.id);
      if (channel?.isTextBased()) await runWithLanguage(lang, () => sendAs(channel, 'automessages', { content: row.message, allowedMentions: { parse: [] } })).catch(() => {});
      await autoMessagesDb.scheduleNext(row.id, row.next_run_at, row.interval_ms);
    } catch (err) {
      logger.error(`Failed to process timer #${row.id}:`, err);
      await autoMessagesDb.scheduleNext(row.id, row.next_run_at, row.interval_ms).catch(() => {});
    }
  }, config.jobConcurrency);
}

function startAutoMessageJob(client) {
  const run = exclusiveTask(() => processDueAutoMessages(client));
  setInterval(() => run().catch((err) => logger.error('Timer job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Timer job started (checking every 30s).');
}

module.exports = { startAutoMessageJob, processDueAutoMessages };
