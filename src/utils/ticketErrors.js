/**
 * What to tell the person when a ticket could not be opened. Any failure used to say "check my permissions (Manage
 * Channels)", even when the cause was a full category, a deleted category or a database error. Discord's own reason is
 * shown when it is a Discord error; anything else gets a plain message (internal details stay in the logs).
 */
function describeTicketOpenError(err) {
  if (err?.userFacing) return err.message;
  const text = String(err?.message ?? '');
  const code = err?.code;
  if (/maximum number of channels in category/i.test(text)) return 'I could not open the ticket: the ticket category is full (Discord allows 50 channels in a category). Close old tickets or choose another category in the dashboard.';
  if (/maximum number of (guild|server) channels/i.test(text) || code === 30013) return 'I could not open the ticket: this server reached Discord\'s limit of channels.';
  if (code === 10003 || /unknown channel|parent_id/i.test(text)) return 'I could not open the ticket: the category channel set for tickets no longer exists. Choose another one in the dashboard.';
  if (code === 50013) return 'I could not open the ticket: Discord says I am missing a permission for that category (for example an overwrite that blocks me). Check the category and the roles I have.';
  if (code === 50001) return 'I could not open the ticket: I cannot access the ticket category channel.';
  if (typeof code === 'number' && text) return `I could not open the ticket: Discord said "${text.slice(0, 160)}".`;
  return 'I could not open the ticket because of an error on my side. The team was told; please try again in a moment.';
}

module.exports = { describeTicketOpenError };
