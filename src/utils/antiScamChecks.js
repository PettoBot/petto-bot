/**
 * What the anti scam looks at. Discord does not let a bot read the text inside a picture, so the scam is caught by how it
 * behaves (the same message in several channels in seconds), by the words around it and by who sends it.
 */

// The lines of the MrBeast scam and its cousins (fake withdrawals, casino promos), by kind. Two or three different kinds in
// one message is a scam; one kind alone is not.
const KINDS = {
  celebrity: /mr\W{0,2}beast|elon\W{0,2}musk|andrew\W{0,2}tate|jimmy\W{0,2}donaldson|\bmrb\b/i,
  reward: /\b(?:claim|reward|prize|giveaway|give\W{0,2}away|selected|winner|won|gift|free)\b/i,
  money: /\$\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:usd|usdt|dollars?|btc|eth)\b|\b(?:usdt|bitcoin|crypto|btc|eth|ethereum|wallet)\b/i,
  withdraw: /\b(?:withdraw(?:al|n|ing)?|payout|cash\W{0,2}out|deposit|transaction|balance)\b/i,
  casino: /\b(?:casino|promo\W{0,2}code|free\W{0,2}credits?|bonus|spins?|bet(?:ting)?|jackpot)\b/i,
  urgency: /\b(?:limited|hurry|first\s+\d+|only\s+\d+\s+(?:left|spots)|expires?|last\s+chance|act\s+now)\b/i,
};
const URL_RE = /https?:\/\/[^\s<>]+|\b[a-z0-9-]+\.(?:com|net|org|io|gg|xyz|me|co|app|cc|top|site|online|vip|bet|win|club)\b/i;

function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/<a?:\w+:\d+>/g, '').replace(/https?:\/\/\S+/g, (u) => u).replace(/[^a-z0-9$.\/:]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/** The kinds of scam wording found in a text, as a list of names. */
function wordingKinds(content) {
  const text = String(content ?? '');
  return Object.entries(KINDS).filter(([, re]) => re.test(text)).map(([name]) => name);
}

function hasLink(content) {
  return URL_RE.test(String(content ?? ''));
}

/**
 * Is this wording a scam on its own? A celebrity plus any other kind, or three kinds, or two kinds with a picture or a link.
 * Plain talk about money or a giveaway is not.
 */
function wordingVerdict(content, { hasAttachment = false } = {}) {
  const kinds = wordingKinds(content);
  const linked = hasLink(content) || hasAttachment;
  const scam = (kinds.includes('celebrity') && kinds.length >= 2) || kinds.length >= 3 || (kinds.length >= 2 && linked && kinds.some((k) => ['money', 'withdraw', 'casino', 'celebrity'].includes(k)));
  return { scam, kinds };
}

/** What identifies a message across channels: its files (name and size) and its text. */
function fingerprints(message) {
  const out = [];
  for (const attachment of message.attachments?.values?.() ?? []) {
    out.push(`a:${String(attachment.name ?? '').toLowerCase()}|${attachment.size ?? 0}`);
  }
  const text = normalize(message.content);
  if (text.length >= 8) out.push(`t:${text.slice(0, 300)}`);
  return out;
}

// What each account sent lately, per server: [{ ts, channelId, messageId, fps }].
const recent = new Map();
const KEEP_MS = 30 * 60_000;
const MAX_PER_USER = 60;

function remember(guildId, userId, entry) {
  const key = `${guildId}:${userId}`;
  const now = entry.ts;
  const list = (recent.get(key) ?? []).filter((e) => now - e.ts < KEEP_MS);
  list.push(entry);
  while (list.length > MAX_PER_USER) list.shift();
  recent.set(key, list);
  return list;
}

/** The same thing in `threshold` or more different channels inside the window: answers the channels and the entries, or null. */
function repeatedAcrossChannels(list, current, { threshold, windowMs }) {
  for (const fp of current.fps) {
    const matching = list.filter((e) => current.ts - e.ts <= windowMs && e.fps.includes(fp));
    const channels = new Set(matching.map((e) => e.channelId));
    if (channels.size >= threshold) return { fingerprint: fp, channels: channels.size, entries: matching };
  }
  return null;
}

/** What this account sent in the last `minutes`, to take it down. */
function recentEntries(guildId, userId, minutes, now = Date.now()) {
  return (recent.get(`${guildId}:${userId}`) ?? []).filter((e) => now - e.ts <= minutes * 60_000);
}

function forget(guildId, userId) {
  recent.delete(`${guildId}:${userId}`);
}

function sweep(now = Date.now()) {
  for (const [key, list] of recent) {
    const kept = list.filter((e) => now - e.ts < KEEP_MS);
    if (kept.length) recent.set(key, kept);
    else recent.delete(key);
  }
}

module.exports = { wordingKinds, wordingVerdict, hasLink, fingerprints, remember, repeatedAcrossChannels, recentEntries, forget, sweep };
