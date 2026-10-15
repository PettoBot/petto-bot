const { t, currentLanguage } = require('../i18n');

/**
 * What to tell the person when a ticket could not be opened. Any failure used to say "check my permissions (Manage
 * Channels)", even when the cause was a full category, a deleted category or a database error. Discord's own reason is
 * shown when it is a Discord error; anything else gets a plain message (internal details stay in the logs).
 */
function describeTicketOpenError(err, lang = currentLanguage()) {
  if (err?.userFacing) return err.message;
  const text = String(err?.message ?? '');
  const code = err?.code;
  if (/maximum number of channels in category/i.test(text)) return t(lang, 'tickets.openError.categoryFull');
  if (/maximum number of (guild|server) channels/i.test(text) || code === 30013) return t(lang, 'tickets.openError.serverFull');
  if (code === 10003 || /unknown channel|parent_id/i.test(text)) return t(lang, 'tickets.openError.categoryGone');
  if (code === 50013) return t(lang, 'tickets.openError.missingPermission');
  if (code === 50001) return t(lang, 'tickets.openError.noAccess');
  if (typeof code === 'number' && text) return t(lang, 'tickets.openError.discord', { message: text.slice(0, 160) });
  return t(lang, 'tickets.openError.internal');
}

module.exports = { describeTicketOpenError };
