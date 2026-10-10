// @ts-check
// Moments in time, the way people write them: "in 2h", "3d 4h", "tomorrow 8pm", "mañana 20:00", "2026-10-12 18:00", a Discord
// timestamp or a unix time. Used by commands that take a time and by the {timestamp:...} variable. Times are read in GMT-5 (Colombia), unless they end in `z` or `utc`.

const { parseDuration } = require('./duration');
const { OFFSET_MS } = require('./botTime');

/** The Discord timestamp styles by the names people can write in a variable. */
const TIMESTAMP_STYLES = {
  short_time: 't', long_time: 'T', short_date: 'd', long_date: 'D', full: 'f', full_long: 'F', short_datetime: 's', medium_datetime: 'S', relative: 'R',
  t: 't', T: 'T', d: 'd', D: 'D', f: 'f', F: 'F', s: 's', S: 'S', R: 'R',
};

/** `<t:unix:style>` for a moment in milliseconds. An unknown style gives the default one. */
function discordTimestamp(ms, style = 'f') {
  return `<t:${Math.floor(ms / 1000)}:${TIMESTAMP_STYLES[style] ?? 'f'}>`;
}

const DAY_WORDS = new Map([
  ['today', 0], ['hoy', 0], ['tonight', 0], ['esta noche', 0],
  ['tomorrow', 1], ['tmrw', 1], ['mañana', 1], ['manana', 1],
]);

/** "8pm", "8:30 pm", "20:00", "at 8pm", "a las 20:00" -> minutes after midnight, or null. */
function readClock(text) {
  const match = text.trim().match(/^(?:at|a las|a la|@)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase().replace(/\./g, '');
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  } else if (!match[2] && !/^(?:at|a las|a la|@)/i.test(text.trim())) {
    return null; // a bare number is not a time of day
  }
  return hour * 60 + minute;
}

/**
 * Reads a moment. Returns the time in milliseconds since 1970, or null when it is not understood.
 * @param {string} input
 * @param {{ now?: number }} [options]
 * @returns {number | null}
 */
function parseWhen(input, { now = Date.now() } = {}) {
  const text = String(input ?? '').trim().toLowerCase();
  if (!text) return null;

  const stamp = text.match(/^<t:(\d{1,13})(?::[a-z])?>$/) ?? text.match(/^(\d{10})$/);
  if (stamp) return Number(stamp[1]) * 1000;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[t\s]+(\d{1,2}):(\d{2}))?(z|\s*utc)?$/);
  if (iso) {
    const written = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] ?? 0), Number(iso[5] ?? 0));
    const moment = iso[6] ? written : written - OFFSET_MS; // without z or utc it is the clock of Colombia
    const check = new Date(moment);
    return check.getUTCMonth() === Number(iso[2]) - 1 && check.getUTCDate() === Number(iso[3]) ? moment : null;
  }

  const relative = text.replace(/^(?:in|en|dentro de|within)\s+/, '');
  const length = parseDuration(relative);
  if (length) return now + length;

  for (const [word, offset] of DAY_WORDS) {
    if (text === word || text.startsWith(`${word} `)) {
      const rest = text.slice(word.length).trim();
      const clock = rest ? readClock(rest) : word.includes('noche') || word === 'tonight' ? 21 * 60 : null;
      if (clock === null) return null;
      const day = new Date(now + OFFSET_MS);
      return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + offset) + clock * 60_000 - OFFSET_MS;
    }
  }

  // A time of day on its own is the next time the clock shows it.
  const clock = readClock(text);
  if (clock !== null) {
    const day = new Date(now + OFFSET_MS);
    const today = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) + clock * 60_000 - OFFSET_MS;
    return today > now ? today : today + 24 * 60 * 60_000;
  }

  return null;
}

module.exports = { parseWhen, discordTimestamp, TIMESTAMP_STYLES };
