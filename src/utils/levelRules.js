// The rules that decide whether activity earns XP, and how much extra it earns. Pure functions: they take the
// settings and the facts and answer, so they can be checked without Discord or a database.

const REPEAT_WINDOW_MS = 60_000;
const MAX_REMEMBERED = 5000;
const { shifted, botDay } = require('./botTime');

/** The week (ISO 8601) and the month a moment belongs to, in GMT-5 (Colombia), as the keys of the ranking tables. */
function periodKeys(moment = new Date()) {
  const date = shifted(moment);
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return {
    week: `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`,
    month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
  };
}

/** Today in GMT-5 (Colombia) as `YYYY-MM-DD`, the day a streak is counted in. */
function utcDay(date = new Date()) {
  return botDay(date);
}

/** What is left of a message once links, mentions, custom emoji and spaces are taken out: the part a person wrote. */
function meaningfulText(content) {
  return String(content ?? '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/<(?:@[!&]?|#)\d+>/g, '')
    .replace(/\s+/g, '');
}

/** Whether the length of a message is enough to earn XP. A setting of 0 lets every message through. */
function longEnough(content, config) {
  const minimum = Number(config?.min_message_chars ?? 0);
  if (minimum <= 0) return true;
  return meaningfulText(content).length >= minimum;
}

/**
 * Remembers the last text of each member and tells when the same text comes again within a minute. A repeat does not
 * refresh the time, so spamming the same line never keeps the window open.
 */
function createRepeatGuard(now = () => Date.now()) {
  const last = new Map();
  return function isRepeat(key, content) {
    const text = String(content ?? '').trim().toLowerCase();
    if (!text) return false;
    const at = now();
    const previous = last.get(key);
    if (previous && previous.text === text && at - previous.at < REPEAT_WINDOW_MS) return true;
    last.set(key, { text, at });
    if (last.size > MAX_REMEMBERED) {
      for (const [id, value] of last) if (at - value.at >= REPEAT_WINDOW_MS) last.delete(id);
      if (last.size > MAX_REMEMBERED) last.delete(last.keys().next().value);
    }
    return false;
  };
}

/** The multiplier of the active events for a source (`text` or `voice`): the highest one, or 1 when none is on. */
function eventMultiplier(events, source, at = new Date()) {
  let best = 1;
  for (const event of events ?? []) {
    if (event.source !== 'all' && event.source !== source) continue;
    if (new Date(event.starts_at) > at || new Date(event.ends_at) <= at) continue;
    best = Math.max(best, Number(event.multiplier));
  }
  return best;
}

/** Extra XP for the first activity of a day: the daily bonus, plus the streak bonus for each earlier day in the streak. */
function dailyBonus(config, streak) {
  const daily = Number(config?.daily_bonus_xp ?? 0);
  const perDay = Number(config?.streak_bonus_xp ?? 0);
  const cap = Math.max(1, Number(config?.streak_max_days ?? 7));
  const extraDays = Math.max(0, Math.min(Number(streak) || 0, cap) - 1);
  return Math.max(0, daily + perDay * extraDays);
}

/** Whether a member in a voice channel earns XP now. `others` counts the people in the channel, bots left out. */
function voiceEligible({ humans, deaf, muted }, config) {
  if (deaf) return false;
  if (config?.voice_ignore_muted && muted) return false;
  return humans >= Math.max(1, Number(config?.voice_min_members ?? 1));
}

module.exports = { REPEAT_WINDOW_MS, periodKeys, utcDay, meaningfulText, longEnough, createRepeatGuard, eventMultiplier, dailyBonus, voiceEligible };
