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

const MINUTE_MS = 60_000;
const MAX_SPAN_MINUTES = 365 * 24 * 60;
const SPAN_UNITS = { w: 10_080, d: 1_440, h: 60, m: 1 };

/** A span written as `3d 4h` (weeks, days, hours, minutes) in minutes; 0 for `0`, `none` or `off`; null when it is not one. */
function parseSpan(text) {
  const value = String(text ?? '').trim().toLowerCase();
  if (/^(0|none|off|no)$/.test(value)) return 0;
  if (!value || !/^(?:\d+\s*[wdhm]\s*)+$/.test(value)) return null;
  let minutes = 0;
  for (const match of value.matchAll(/(\d+)\s*([wdhm])/g)) minutes += Number(match[1]) * SPAN_UNITS[match[2]];
  return minutes > 0 && minutes <= MAX_SPAN_MINUTES ? minutes : null;
}

/** Minutes as `3d 4h` (the two biggest units that are not zero), or `none`. */
function formatSpan(minutes) {
  if (!minutes) return 'none';
  const parts = [];
  let left = minutes;
  for (const [unit, size] of [['w', 10_080], ['d', 1_440], ['h', 60], ['m', 1]]) {
    const count = Math.floor(left / size);
    if (count) { parts.push(`${count}${unit}`); left -= count * size; }
  }
  return parts.join(' ');
}

/** The cooldown of a server in minutes: the new setting, or the old one in days. */
function cooldownMinutes(config) {
  return config.cooldown_minutes > 0 ? config.cooldown_minutes : (config.cooldown_days ?? 0) * 1_440;
}

/** Why a partnership does not count, or null when it does. `invite` is `{ guildId, name, members, createdAt, nsfw, text }`. */
function judge({ invite, ownGuildId, config, blacklisted = false, last = null, now = Date.now() }) {
  if (String(invite.guildId) === String(ownGuildId)) return 'self_partner';
  if (blacklisted) return 'blacklisted';
  if (config.block_nsfw && invite.nsfw) return 'nsfw_blocked';
  if (config.blocked_keywords?.length) {
    const text = String(invite.text ?? '').toLowerCase();
    if (config.blocked_keywords.some((word) => word && text.includes(String(word).toLowerCase()))) return 'keyword_blocked';
  }
  if (config.min_members > 0 && !(invite.members >= config.min_members)) return 'member_requirement';
  if (config.min_age_days > 0) {
    const created = invite.createdAt instanceof Date ? invite.createdAt.getTime() : null;
    if (created === null || now - created < config.min_age_days * DAY_MS) return 'age_requirement';
  }
  const cooldown = cooldownMinutes(config);
  if (cooldown > 0 && last && now - new Date(last.created_at).getTime() < cooldown * MINUTE_MS) return 'cooldown';
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

/**
 * Where a Partner Manager stands, for the variables of the replies: their place and the best one this week and in total, and the
 * numbers of the whole server. `rows` are every counted partnership of the server.
 */
function standings(rows, managerId, now = new Date()) {
  const weekStart = periodStart('week', now).getTime();
  const dayStart = periodStart('day', now).getTime();
  const week = rank(rows.filter((row) => new Date(row.created_at).getTime() >= weekStart));
  const total = rank(rows);
  const place = (list) => { const index = list.findIndex((entry) => entry.managerId === String(managerId)); return index === -1 ? null : index + 1; };
  return {
    rankWeek: place(week),
    rankTotal: place(total),
    topWeek: week[0] ?? null,
    topTotal: total[0] ?? null,
    serverDay: rows.filter((row) => new Date(row.created_at).getTime() >= dayStart).length,
    serverWeek: week.reduce((sum, entry) => sum + entry.count, 0),
    serverTotal: rows.length,
  };
}

module.exports = { extractInviteCodes, snowflakeDate, judge, periodStart, rank, counts, parseSpan, formatSpan, cooldownMinutes, standings };
