const autoMessagesDb = require('../db/autoMessages');
const { sendAs } = require('../utils/senderIdentity');
const logger = require('../utils/logger');
const { templatePayload } = require('../utils/templatedMessage');
const { applyReactReplies } = require('../utils/messageFlags');
const config = require('../config');
const { forEachWithConcurrency, exclusiveTask } = require('../utils/concurrency');
const { runWithLanguage, guildLanguage } = require('../i18n');

const POLL_INTERVAL_MS = 30_000;

/**
 * What a timer sends: its saved embed when it has one (with its text above it, if it has text too), otherwise its text. A saved embed that
 * is gone or empty falls back to the text, so the timer does not go quiet. `reactions` are the ones the embed asks for.
 */
async function timerPayload(channel, row) {
  const allowedMentions = { parse: [] };
  if (row.embed_template) {
    const built = await templatePayload(channel.guild?.id ?? row.guild_id, row.embed_template, { guild: channel.guild, channel });
    if (built) {
      const { reactions, ...rest } = built;
      return { message: { ...rest, content: rest.content || row.message || undefined, allowedMentions }, reactions };
    }
  }
  return { message: { content: row.message, allowedMentions }, reactions: [] };
}

/** After a timer sent its message: deletes the one of the time before (when there is one) and remembers the new one. */
async function replacePrevious(channel, row, sent) {
  if (!sent?.id) return;
  if (row.last_message_id && row.last_message_id !== sent.id) await channel.messages.delete(row.last_message_id).catch(() => {});
  await autoMessagesDb.setLastMessage(row.id, sent.id).catch(() => {});
}

async function processDueAutoMessages(client) {
  const rows = await autoMessagesDb.listDue();
  await forEachWithConcurrency(rows, async (row) => {
    try {
      const channel = await client.channels.fetch(row.channel_id).catch(() => null);
      // The message is the server's own text; the send runs in the server's language anyway, like an event would.
      const lang = await guildLanguage(row.guild_id ?? channel?.guild?.id);
      if (channel?.isTextBased()) {
        const payload = await timerPayload(channel, row);
        const sent = await runWithLanguage(lang, () => sendAs(channel, 'automessages', payload.message)).catch(() => null);
        if (sent && payload.reactions.length) await applyReactReplies(sent, payload.reactions).catch(() => {});
        if (row.delete_previous) await replacePrevious(channel, row, sent);
      }
      // A run missed while the bot was off is sent once (above); the next one is the next future time, so there is no catch-up.
      await autoMessagesDb.scheduleNext(row);
    } catch (err) {
      logger.error(`Failed to process timer #${row.id}:`, err);
      await autoMessagesDb.scheduleNext(row).catch(() => {});
    }
  }, config.jobConcurrency);
}

function startAutoMessageJob(client) {
  const run = exclusiveTask(() => processDueAutoMessages(client));
  setInterval(() => run().catch((err) => logger.error('Timer job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Timer job started (checking every 30s).');
}

module.exports = { startAutoMessageJob, processDueAutoMessages, replacePrevious, timerPayload };
