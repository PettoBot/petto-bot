const logger = require('./logger');

const NOTE_LIMIT = 500;

function noteQuote(note) {
  return note ? `\n> ${note.slice(0, NOTE_LIMIT).replace(/\n/g, '\n> ')}` : '';
}

/** The discussion thread stored with a report, or null when it has none or it was deleted. */
async function fetchReportThread(guild, report) {
  if (!report?.thread_id) return null;
  const thread = await guild.channels.fetch(report.thread_id).catch(() => null);
  return thread?.isThread?.() ? thread : null;
}

/**
 * Closes the discussion when a report is resolved or dismissed: a last message with the outcome, then the thread
 * is locked and archived. Each step is best effort, because locking needs Manage Threads and a missing permission
 * must never get in the way of the report itself.
 */
async function closeReportThread(thread, { status, note, byId }) {
  const outcome = status === 'resolved' ? 'Resolved' : 'Dismissed';
  await thread
    .send({ content: `**Report ${outcome.toLowerCase()}** by <@${byId}>.${noteQuote(note)}`, allowedMentions: { parse: [] } })
    .catch((err) => logger.warn(`Could not post the closing note in thread ${thread.id}: ${err.message}`));
  await thread.setLocked(true, `Report ${outcome.toLowerCase()}`).catch(() => {});
  await thread.setArchived(true, `Report ${outcome.toLowerCase()}`).catch((err) => logger.warn(`Could not archive thread ${thread.id}: ${err.message}`));
}

/** Opens the discussion again when a closed report is reopened. */
async function reopenReportThread(thread, { byId }) {
  await thread.setLocked(false, 'Report reopened').catch(() => {});
  await thread.setArchived(false, 'Report reopened').catch((err) => logger.warn(`Could not unarchive thread ${thread.id}: ${err.message}`));
  await thread
    .send({ content: `**Report reopened** by <@${byId}>.`, allowedMentions: { parse: [] } })
    .catch((err) => logger.warn(`Could not post the reopening note in thread ${thread.id}: ${err.message}`));
}

function threadUrl(guildId, thread) {
  return `https://discord.com/channels/${guildId}/${thread.id}`;
}

module.exports = { fetchReportThread, closeReportThread, reopenReportThread, threadUrl };
