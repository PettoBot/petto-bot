// Timers that post at a time of day (every day, or every week on one weekday) in a time zone, instead of every N minutes.
// The next time is worked out from the schedule each run (never "last run + interval"), so a timer does not drift, and a run the
// bot missed while it was offline is sent once and then moves on to the next future time.

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** What `interval_ms` holds for a scheduled timer (the column must stay at least 10 minutes). */
const SCHEDULE_INTERVAL_MS = { daily: DAY_MS, weekly: WEEK_MS };
const SCHEDULES = ['interval', 'daily', 'weekly'];

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const OFFSET_RE = /^(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i;

// Weekday names in English, Spanish and Portuguese (0 = Sunday, like Date#getUTCDay).
const WEEKDAY_WORDS = [
  ['sunday', 'sun', 'domingo', 'dom'],
  ['monday', 'mon', 'lunes', 'lun', 'segunda', 'segunda-feira', 'seg'],
  ['tuesday', 'tue', 'tues', 'martes', 'mar', 'terça', 'terca', 'terça-feira', 'terca-feira', 'ter'],
  ['wednesday', 'wed', 'miércoles', 'miercoles', 'mié', 'mie', 'quarta', 'quarta-feira', 'qua'],
  ['thursday', 'thu', 'thur', 'thurs', 'jueves', 'jue', 'quinta', 'quinta-feira', 'qui'],
  ['friday', 'fri', 'viernes', 'vie', 'sexta', 'sexta-feira', 'sex'],
  ['saturday', 'sat', 'sábado', 'sabado', 'sáb', 'sab'],
];
const DAILY_WORDS = ['daily', 'diario', 'diaria', 'diário', 'diária'];
const WEEKLY_WORDS = ['weekly', 'semanal'];

/** 0–6 for a weekday name (en/es/pt) or number, otherwise null. */
function parseWeekday(input) {
  const text = String(input ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (/^[0-6]$/.test(text)) return Number(text);
  const index = WEEKDAY_WORDS.findIndex((words) => words.includes(text));
  return index >= 0 ? index : null;
}

/** "9:05" → "09:05"; null when it is not a 24-hour HH:MM time. */
function normalizeTime(input) {
  const match = TIME_RE.exec(String(input ?? '').trim());
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
}

/** Minutes east of UTC of a "UTC+5" / "UTC-03:30" / "GMT+5:30" zone, or null when the zone is not one. */
function fixedOffsetMinutes(zone) {
  const match = OFFSET_RE.exec(String(zone ?? '').trim());
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? 0);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes > 0)) return null;
  return (match[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
}

/**
 * The stored spelling of a time zone: an IANA name as the runtime spells it (`america/bogota` → `America/Bogota`), `UTC`, or a fixed
 * offset as `UTC+5` / `UTC-3:30`. Null when it is not a time zone.
 */
function normalizeTimeZone(input) {
  const text = String(input ?? '').trim();
  if (!text || text.length > 64) return null;
  if (/^(utc|gmt|z)$/i.test(text)) return 'UTC';
  const offset = fixedOffsetMinutes(text);
  if (offset !== null) {
    if (offset === 0) return 'UTC';
    const abs = Math.abs(offset);
    return `UTC${offset < 0 ? '-' : '+'}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : ''}`;
  }
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(text)) return null;
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: text }).resolvedOptions().timeZone;
    // Older spellings resolve to themselves; keep what the runtime calls it, so the same zone is always written the same way.
    return resolved === 'Etc/UTC' || resolved === 'Etc/GMT' ? 'UTC' : resolved;
  } catch {
    return null;
  }
}

const formatters = new Map();
function partsFormatter(zone) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** How far the zone's wall clock is ahead of UTC at the instant `ms`, in milliseconds. */
function zoneOffsetMs(zone, ms) {
  const fixed = zone === 'UTC' ? 0 : fixedOffsetMinutes(zone);
  if (fixed !== null) return fixed * 60_000;
  const parts = {};
  for (const part of partsFormatter(zone).formatToParts(new Date(ms))) parts[part.type] = part.value;
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  return wall - Math.floor(ms / 1000) * 1000;
}

/** The zone's calendar date at the instant `ms`: { year, month (0–11), day }. */
function zonedDate(zone, ms) {
  const local = new Date(ms + zoneOffsetMs(zone, ms));
  return { year: local.getUTCFullYear(), month: local.getUTCMonth(), day: local.getUTCDate() };
}

/**
 * The instant the zone's wall clock reads this date and time. A time that happens twice (the hour clocks go back) is the first one; a
 * time that never happens (the hour clocks skip) moves forward by the skipped amount, like 02:30 → 03:30.
 */
function zonedTimeToUtc(zone, year, month, day, hour, minute) {
  const local = Date.UTC(year, month, day, hour, minute);
  const before = zoneOffsetMs(zone, local - DAY_MS / 2);
  const after = zoneOffsetMs(zone, local + DAY_MS / 2);
  const valid = [...new Set([before, after])].map((offset) => local - offset).filter((ms) => ms + zoneOffsetMs(zone, ms) === local);
  if (valid.length) return Math.min(...valid);
  return local - before;
}

/**
 * The next time a scheduled timer posts, strictly after `afterMs` (now by default), as a Date. `timer` has `schedule` ('daily' or
 * 'weekly'), `at_time` ('HH:MM'), `timezone` and, for weekly, `weekday` (0 = Sunday). Null for an interval timer or a bad schedule.
 */
function nextScheduledRun(timer, afterMs = Date.now()) {
  const schedule = timer?.schedule;
  if (schedule !== 'daily' && schedule !== 'weekly') return null;
  const time = normalizeTime(timer.at_time);
  const zone = normalizeTimeZone(timer.timezone || 'UTC');
  const weekday = schedule === 'weekly' ? Number(timer.weekday) : null;
  if (!time || !zone || (schedule === 'weekly' && !(weekday >= 0 && weekday <= 6))) return null;
  const [hour, minute] = time.split(':').map(Number);
  const today = zonedDate(zone, afterMs);
  for (let add = 0; add <= 8; add += 1) {
    const date = new Date(Date.UTC(today.year, today.month, today.day + add));
    if (weekday !== null && date.getUTCDay() !== weekday) continue;
    const at = zonedTimeToUtc(zone, date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute);
    if (at > afterMs) return new Date(at);
  }
  return null;
}

/** When a timer runs next after a run (or after being created): its schedule's next time, or now + its interval. */
function nextRunAt(timer, afterMs = Date.now()) {
  return nextScheduledRun(timer, afterMs) ?? new Date(afterMs + Number(timer.interval_ms));
}

/**
 * Checks and fills in the schedule fields of a timer row (`schedule`, `at_time`, `timezone`, `weekday`): returns { row } with them
 * normalized, `interval_ms` set for a scheduled timer and `next_run_at` set when `fillNextRun`, or { error } naming what is wrong
 * ('schedule', 'time', 'timezone' or 'weekday').
 */
function normalizeScheduleFields(input, { fillNextRun = true, now = Date.now() } = {}) {
  const schedule = input.schedule == null || input.schedule === '' ? 'interval' : String(input.schedule).toLowerCase();
  if (!SCHEDULES.includes(schedule)) return { error: 'schedule' };
  const row = { ...input, schedule };
  if (schedule === 'interval') {
    row.at_time = null;
    row.weekday = null;
    if (row.timezone !== undefined) {
      const zone = normalizeTimeZone(row.timezone || 'UTC');
      if (!zone) return { error: 'timezone' };
      row.timezone = zone;
    }
    return { row };
  }
  const time = normalizeTime(input.at_time);
  if (!time) return { error: 'time' };
  const zone = normalizeTimeZone(input.timezone == null || input.timezone === '' ? 'UTC' : input.timezone);
  if (!zone) return { error: 'timezone' };
  let weekday = null;
  if (schedule === 'weekly') {
    weekday = parseWeekday(input.weekday);
    if (weekday === null) return { error: 'weekday' };
  }
  Object.assign(row, { at_time: time, timezone: zone, weekday, interval_ms: SCHEDULE_INTERVAL_MS[schedule] });
  if (fillNextRun) row.next_run_at = nextScheduledRun(row, now).toISOString();
  return { row };
}

/**
 * Reads the start of a `timer add` text: `daily 18:00 [zone]`, `weekly monday 09:30 [zone]` or an interval like `2h`. Returns
 * { schedule, intervalMs, atTime, timezone, weekday, rest } with `rest` the text after it (the message), { error } when the schedule is
 * started but wrong ('time', 'timezone', 'weekday'), or null when the text does not start with a schedule.
 */
function parseScheduleText(text, parseDuration) {
  let rest = String(text ?? '').replace(/^\s+/, '');
  const take = () => {
    const match = /^(\S+)\s*/.exec(rest);
    if (!match) return null;
    rest = rest.slice(match[0].length);
    return match[1];
  };
  const peek = () => /^(\S+)/.exec(rest)?.[1] ?? null;
  const first = take();
  if (!first) return null;
  const word = first.toLowerCase();
  const schedule = DAILY_WORDS.includes(word) ? 'daily' : WEEKLY_WORDS.includes(word) ? 'weekly' : null;
  if (!schedule) {
    const intervalMs = parseDuration(first);
    return intervalMs ? { schedule: 'interval', intervalMs, atTime: null, timezone: 'UTC', weekday: null, rest } : null;
  }
  let weekday = null;
  if (schedule === 'weekly') {
    weekday = parseWeekday(take());
    if (weekday === null) return { error: 'weekday' };
  }
  const atTime = normalizeTime(take());
  if (!atTime) return { error: 'time' };
  let timezone = 'UTC';
  const zoneWord = peek();
  if (zoneWord) {
    const zone = normalizeTimeZone(zoneWord);
    if (zone) {
      timezone = zone;
      take();
    } else if (zoneWord.includes('/') || /^(utc|gmt)[+-]/i.test(zoneWord)) {
      return { error: 'timezone', zone: zoneWord };
    }
  }
  return { schedule, intervalMs: SCHEDULE_INTERVAL_MS[schedule], atTime, timezone, weekday, rest };
}

/** The weekday's name in a language, from Intl (0 = Sunday). */
function weekdayName(weekday, lang = 'en') {
  try {
    return new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + Number(weekday))));
  } catch {
    return WEEKDAY_WORDS[weekday]?.[0] ?? String(weekday);
  }
}

module.exports = {
  SCHEDULES, SCHEDULE_INTERVAL_MS, WEEKDAY_WORDS,
  parseWeekday, normalizeTime, normalizeTimeZone, fixedOffsetMinutes, zoneOffsetMs, zonedTimeToUtc,
  nextScheduledRun, nextRunAt, normalizeScheduleFields, parseScheduleText, weekdayName,
};
