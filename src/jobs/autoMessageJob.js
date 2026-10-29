const autoMessagesDb = require('../db/autoMessages');
const { sendAs } = require('../utils/senderIdentity');
const logger = require('../utils/logger');
const { templatePayload } = require('../utils/templatedMessage');
const { withLeadingText } = require('../utils/leadingText');
const { applyReactReplies } = require('../utils/messageFlags');
const config = require('../config');
const { forEachWithConcurrency, exclusiveTask } = require('../utils/concurrency');
const { runWithLanguage, guildLanguage } = require('../i18n');

const POLL_INTERVAL_MS = 30_000;

/**
 * What a timer sends: its saved embed when it has one (with its text above it, if it has text too), otherwise its text. A saved embed that
 * is gone or empty falls back to the text, so the timer does not go quiet. `reactions` are the ones the embed asks for. A Components V2
 * design never gets `content` (Discord refuses the whole message): the text goes in as its first text, and only when it says something
 * (a lone "." or "," is left out).
 */
async function timerPayload(channel, row) {
  const allowedMentions = { parse: [] };
  if (row.embed_template) {
    const built = await templatePayload(channel.guild?.id ?? row.guild_id, row.embed_template, { guild: channel.guild, channel });
    if (built) {
      const { reactions, ...rest } = built;
      return { message: { ...withLeadingText(rest, row.message), allowedMentions }, reactions };
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

/** Discord's answer to a send that failed, short: "Invalid Form Body (50035)" or the error's message. */
function describeSendError(error) {
  const code = error?.code ? ` (${error.code})` : '';
  return `${String(error?.message ?? error ?? 'Unknown error').split('\n')[0].slice(0, 300)}${code}`; // i18n-ignore: Discord's own answer, kept as it came
}

/**
 * Sends a timer's message now (the job, `!timer run` and the dashboard's "Send now") without touching its schedule. A failure is logged with
 * the timer and Discord's answer and kept in `last_error`; a send that works clears it. Returns { ok, error?, messageId? }.
 */
async function sendTimer(client, row) {
  const channel = await client.channels.fetch(row.channel_id).catch(() => null);
  let error = null;
  let sent = null;
  if (!channel?.isTextBased?.()) {
    error = 'The channel is gone, or Petto cannot see it.'; // i18n-ignore: kept in last_error next to Discord's own answers
  } else {
    // The message is the server's own text; the send runs in the server's language anyway, like an event would.
    const lang = await guildLanguage(row.guild_id ?? channel.guild?.id);
    const payload = await timerPayload(channel, row);
    try {
      sent = await runWithLanguage(lang, () => sendAs(channel, 'automessages', payload.message));
    } catch (err) {
      error = describeSendError(err);
    }
    if (sent && payload.reactions.length) await applyReactReplies(sent, payload.reactions).catch(() => {});
    if (sent && row.delete_previous) await replacePrevious(channel, row, sent);
  }
  if (error) {
    logger.warn({ guildId: row.guild_id, action: 'timer' }, `Timer ${row.number ?? '?'} (id ${row.id}) could not send in ${row.channel_id}: ${error}`);
    await autoMessagesDb.setLastError(row.id, error).catch(() => {});
    return { ok: false, error };
  }
  if (row.last_error) await autoMessagesDb.setLastError(row.id, null).catch(() => {});
  return { ok: true, messageId: sent?.id ?? null };
}

async function processDueAutoMessages(client) {
  const rows = await autoMessagesDb.listDue();
  await forEachWithConcurrency(rows, async (row) => {
    try {
      await sendTimer(client, row);
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

module.exports = { startAutoMessageJob, processDueAutoMessages, replacePrevious, timerPayload, sendTimer, describeSendError };
