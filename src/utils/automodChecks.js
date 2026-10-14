// Every check here is local (regex / in-memory) — no external API calls per
// message, since scanning every message against a rate-limited third-party API
// (like an external reputation check on every message) isn't affordable
// at message volume.

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive match against the guild's banned word list. */
function findBannedWord(content, bannedWords) {
  for (const word of bannedWords ?? []) {
    const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
    if (re.test(content)) return word;
  }
  return null;
}

/** True if a message (long enough to be meaningful) is mostly uppercase letters. */
function isExcessiveCaps(content, { minLength = 12, threshold = 0.7 } = {}) {
  const letters = content.replace(/[^a-zA-Z]/g, '');
  if (letters.length < minLength) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length >= threshold;
}

function hasMassMentions(message, maxMentions) {
  const count = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0);
  return count > maxMentions;
}

const INVITE_RE = /discord(?:app)?\.(?:gg|com\/invite)\/([a-zA-Z0-9-]+)/gi;

/** True if the message contains a discord.gg/discord.com invite whose code isn't on the allow-list. */
function hasUnauthorizedInvite(content, allowedCodes) {
  const matches = [...content.matchAll(INVITE_RE)];
  if (!matches.length) return false;
  const allowed = new Set((allowedCodes ?? []).map((c) => c.toLowerCase()));
  return matches.some((m) => !allowed.has(m[1].toLowerCase()));
}
const RECENT_WINDOW_MS = 10_000;
const REPEAT_THRESHOLD = 3;
const recentByUser = new Map(); // `${guildId}:${userId}` -> [{ content, ts }]

/** True once a user has posted the same content REPEAT_THRESHOLD+ times within the window. */
function isRepeatFlood(guildId, userId, content, { threshold = REPEAT_THRESHOLD, windowMs = RECENT_WINDOW_MS } = {}) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const history = (recentByUser.get(key) ?? []).filter((m) => now - m.ts < Math.max(windowMs, RECENT_WINDOW_MS));
  history.push({ content, ts: now });
  recentByUser.set(key, history);
  return history.filter((m) => m.content === content && now - m.ts < windowMs).length >= threshold;
}

/** True when the message is longer than the limit in characters or in lines (0 turns each limit off). */
function isTooLong(content, { maxLength = 0, maxLines = 0 } = {}) {
  if (maxLength > 0 && content.length > maxLength) return 'length';
  if (maxLines > 0 && content.split('\n').length > maxLines) return 'lines';
  return null;
}

// Automod hits per member: after enough of them in the window the member is muted (strikes).
const strikesByUser = new Map(); // `${guildId}:${userId}` -> [ts]

/** Counts a hit and answers true when the member just reached the limit (the count starts over). A limit of 0 never answers true. */
function recordStrike(guildId, userId, { limit, windowMinutes }, now = Date.now()) {
  if (!limit || limit < 1) return false;
  const key = `${guildId}:${userId}`;
  const recent = (strikesByUser.get(key) ?? []).filter((ts) => now - ts < windowMinutes * 60_000);
  recent.push(now);
  if (recent.length >= limit) {
    strikesByUser.delete(key);
    return true;
  }
  strikesByUser.set(key, recent);
  return false;
}

module.exports = { findBannedWord, isExcessiveCaps, hasMassMentions, hasUnauthorizedInvite, isRepeatFlood, isTooLong, recordStrike };
