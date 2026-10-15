const logger = require('./logger');
const { t, currentLanguage } = require('../i18n');

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
async function closeReportThread(thread, { status, note, byId, lang = currentLanguage() }) {
  const outcome = status === 'resolved' ? 'resolved' : 'dismissed';
  await thread
    .send({ content: `${t(lang, `reports.thread.${outcome}`, { user: `<@${byId}>` })}${noteQuote(note)}`, allowedMentions: { parse: [] } })
    .catch((err) => logger.warn(`Could not post the closing note in thread ${thread.id}: ${err.message}`));
  await thread.setLocked(true, t(lang, `reports.thread.audit.${outcome}`)).catch(() => {});
  await thread.setArchived(true, t(lang, `reports.thread.audit.${outcome}`)).catch((err) => logger.warn(`Could not archive thread ${thread.id}: ${err.message}`));
}

/** Opens the discussion again when a closed report is reopened. */
async function reopenReportThread(thread, { byId, note, lang = currentLanguage() }) {
  await thread.setLocked(false, t(lang, 'reports.thread.audit.reopened')).catch(() => {});
  await thread.setArchived(false, t(lang, 'reports.thread.audit.reopened')).catch((err) => logger.warn(`Could not unarchive thread ${thread.id}: ${err.message}`));
  await thread
    .send({ content: `${t(lang, 'reports.thread.reopened', { user: `<@${byId}>` })}${noteQuote(note)}`, allowedMentions: { parse: [] } })
    .catch((err) => logger.warn(`Could not post the reopening note in thread ${thread.id}: ${err.message}`));
}

function threadUrl(guildId, thread) {
  return `https://discord.com/channels/${guildId}/${thread.id}`;
}

module.exports = { fetchReportThread, closeReportThread, reopenReportThread, threadUrl };
