const COMBINING_MARKS_RE = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g');

/** Discord channel names must be lowercase, no spaces/most punctuation, and are capped well under 100 chars in practice. */
function sanitizeChannelName(str) {
  return str
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS_RE, '') // strip accents (after NFKD decomposition)
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

/** Renders a category's naming_pattern (supports {number}, {username}) into a valid channel name. */
function formatTicketChannelName(pattern, { number, username }) {
  const padded = String(number).padStart(4, '0');
  const raw = (pattern || 'ticket-{number}').replace(/\{number\}/gi, padded).replace(/\{username\}/gi, username ?? 'user');
  return sanitizeChannelName(raw) || `ticket-${padded}`;
}

module.exports = { sanitizeChannelName, formatTicketChannelName };
