// The rules of the partner module, apart from Discord: finding the invites in a message, deciding whether a
// partnership counts, and the day/week/total numbers. Everything here is plain data in, plain data out.
const INVITE_RE = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([a-z0-9-]{2,32})/gi;
const DISCORD_EPOCH = 1420070400000;
const DAY_MS = 86_400_000;

/** The invite codes written in a text, once each, at most `max`. */
function extractInviteCodes(text, max = 3) {
  const codes = [];
  for (const match of String(text ?? '').matchAll(INVITE_RE)) {
    const code = match[1];
    if (!codes.some((known) => known.toLowerCase() === code.toLowerCase())) codes.push(code);
    if (codes.length >= max) break;
  }
  return codes;
}

/** When a server (or any Discord id) was created. */
function snowflakeDate(id) {
  try {
    return new Date(Number((BigInt(id) >> 22n)) + DISCORD_EPOCH);
  } catch {
    return null;
  }
}

/** Why a partnership does not count, or null when it does. `invite` is `{ guildId, name, members, createdAt }`. */
function judge({ invite, ownGuildId, config, blacklisted = false, last = null, now = Date.now() }) {
  if (String(invite.guildId) === String(ownGuildId)) return 'self_partner';
  if (blacklisted) return 'blacklisted';
  if (config.min_members > 0 && !(invite.members >= config.min_members)) return 'member_requirement';
  if (config.min_age_days > 0) {
    const created = invite.createdAt instanceof Date ? invite.createdAt.getTime() : null;
    if (created === null || now - created < config.min_age_days * DAY_MS) return 'age_requirement';
  }
  if (config.cooldown_days > 0 && last && now - new Date(last.created_at).getTime() < config.cooldown_days * DAY_MS) return 'cooldown';
  return null;
}

/** The start of "today" or "this week" (Monday) in UTC, or null for all time. */
function periodStart(period, now = new Date()) {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (period === 'day') return new Date(day);
  if (period === 'week') return new Date(day - ((now.getUTCDay() + 6) % 7) * DAY_MS);
  return null;
}

/** `[{ managerId, count }]` from the log rows, most first (ties: the one who started earlier). */
function rank(rows) {
  const byManager = new Map();
  for (const row of rows) {
    const entry = byManager.get(row.manager_id) ?? { managerId: row.manager_id, count: 0, first: Infinity };
    entry.count += 1;
    entry.first = Math.min(entry.first, new Date(row.created_at).getTime());
    byManager.set(row.manager_id, entry);
  }
  return [...byManager.values()].sort((a, b) => b.count - a.count || a.first - b.first).map(({ managerId, count }) => ({ managerId, count }));
}

/** Today, this week and total for each period given the rows of all time. */
function counts(rows, now = new Date()) {
  const startDay = periodStart('day', now).getTime();
  const startWeek = periodStart('week', now).getTime();
  let day = 0;
  let week = 0;
  for (const row of rows) {
    const at = new Date(row.created_at).getTime();
    if (at >= startDay) day += 1;
    if (at >= startWeek) week += 1;
  }
  return { day, week, total: rows.length };
}

module.exports = { extractInviteCodes, snowflakeDate, judge, periodStart, rank, counts };
