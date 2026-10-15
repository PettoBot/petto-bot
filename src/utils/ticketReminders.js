const { t, currentLanguage } = require('../i18n');

// Two small helpers for tickets: which open tickets have waited too long without anyone claiming them, and the numbers of `ticket stats`.

/** True when an open ticket nobody claimed has waited `minutes` or more and was not reminded yet. */
function dueForReminder(ticket, minutes, now = Date.now()) {
  if (!ticket || ticket.status !== 'open' || ticket.claimed_by || ticket.reminded_at || !ticket.channel_id) return false;
  if (!(minutes > 0)) return false;
  return now - new Date(ticket.created_at).getTime() >= minutes * 60_000;
}

const DAY = 86_400_000;

/** The numbers of a server's tickets: how many are open, how many were opened and closed lately, the average rating and who claims the most. */
function summarizeStats(tickets, ratings, now = Date.now()) {
  const open = tickets.filter((t) => t.status === 'open');
  const since = (days) => now - days * DAY;
  const opened = (days) => tickets.filter((t) => new Date(t.created_at).getTime() >= since(days)).length;
  const closed = (days) => tickets.filter((t) => t.status === 'closed' && t.closed_at && new Date(t.closed_at).getTime() >= since(days)).length;
  const waits = tickets.filter((t) => t.status === 'closed' && t.closed_at).map((t) => new Date(t.closed_at).getTime() - new Date(t.created_at).getTime()).filter((ms) => ms > 0);
  const claims = new Map();
  for (const t of tickets) if (t.claimed_by) claims.set(t.claimed_by, (claims.get(t.claimed_by) ?? 0) + 1);
  const stars = ratings.map((r) => Number(r.rating)).filter((n) => n >= 1 && n <= 5);
  return {
    total: tickets.length,
    open: open.length,
    unclaimed: open.filter((t) => !t.claimed_by).length,
    opened7: opened(7),
    opened30: opened(30),
    closed7: closed(7),
    closed30: closed(30),
    averageMinutesOpen: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length / 60_000) : null,
    averageRating: stars.length ? Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 10) / 10 : null,
    ratingCount: stars.length,
    topClaimers: [...claims.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([userId, count]) => ({ userId, count })),
  };
}

/** A length of time in minutes as text: `45 min`, `3 h 20 min`, `2 d 4 h`. */
function durationText(minutes, lang = currentLanguage()) {
  if (minutes === null || minutes === undefined) return t(lang, 'tickets.duration.noData');
  if (minutes < 60) return t(lang, 'tickets.duration.minutes', { minutes });
  if (minutes < 1440) return t(lang, 'tickets.duration.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  return t(lang, 'tickets.duration.daysHours', { days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60) });
}

/** The moment before which a ticket closed long enough ago to have its channel deleted (null when the server keeps them). */
function deleteCutoff(hours, now = Date.now()) {
  return hours > 0 ? new Date(now - hours * 3_600_000).toISOString() : null;
}

module.exports = { dueForReminder, summarizeStats, durationText, deleteCutoff };
