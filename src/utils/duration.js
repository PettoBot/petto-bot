// @ts-check

const ms = require('ms');
const i18n = require('../i18n');

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Every way of writing a unit, in English, Spanish and Portuguese.
const UNITS = new Map();
for (const [names, value] of /** @type {[string[], number][]} */ ([
  [['ms', 'msec', 'millisecond', 'milliseconds', 'milisegundo', 'milisegundos'], 1],
  [['s', 'sec', 'secs', 'second', 'seconds', 'seg', 'segs', 'segundo', 'segundos'], SECOND],
  [['m', 'min', 'mins', 'minute', 'minutes', 'minuto', 'minutos'], MINUTE],
  [['h', 'hr', 'hrs', 'hour', 'hours', 'hora', 'horas'], HOUR],
  [['d', 'day', 'days', 'dia', 'dias', 'día', 'días'], DAY],
  [['w', 'wk', 'wks', 'week', 'weeks', 'sem', 'semana', 'semanas'], 7 * DAY],
  [['mo', 'month', 'months', 'mes', 'meses', 'mês'], 30 * DAY],
  [['y', 'yr', 'yrs', 'year', 'years', 'año', 'años', 'ano', 'anos'], 365 * DAY],
])) for (const name of names) UNITS.set(name, value);

const PIECE = /(\d+(?:[.,]\d+)?)\s*([a-záéíóúñêç]+)/giy;
const GLUE = /^[\s,]*(?:and|y|e)?[\s,]*/i;

/**
 * Parses what people write for a length of time into milliseconds: "10m", "2h", "7d", and also pieces together such as
 * "3d 4h", "1 hour 30 minutes" or "1h30m", in English or Spanish. Returns null if it is invalid or not positive.
 * @param {string} str
 * @returns {number | null}
 */
function parseDuration(str) {
  const text = String(str ?? '').trim().toLowerCase();
  // No real length of time is this long; the cap also keeps the patterns below fast on hostile input.
  if (!text || text.length > 64) return null;

  let total = 0;
  let index = 0;
  let pieces = 0;
  while (index < text.length) {
    index += (GLUE.exec(text.slice(index)) ?? [''])[0].length;
    if (index >= text.length) break;
    PIECE.lastIndex = index;
    const match = PIECE.exec(text);
    if (!match) { total = 0; pieces = 0; break; }
    const unit = UNITS.get(match[2]);
    if (!unit) { total = 0; pieces = 0; break; }
    total += Number(match[1].replace(',', '.')) * unit;
    index = PIECE.lastIndex;
    pieces += 1;
  }
  if (pieces > 0 && Number.isFinite(total) && total > 0) return Math.round(total);

  // Whatever the pieces did not understand, the ms library may (it knows plain numbers and a few more spellings).
  const value = ms(text);
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * A length of time in words, the largest unit rounded ("1 minute", "2 hours"), in the language of the command or event that is
 * running unless `lang` is given.
 * @param {number} msValue
 * @param {string} [lang]
 */
function formatDuration(msValue, lang = i18n.currentLanguage()) {
  return i18n.formatDuration(lang, msValue);
}

// A length of time written as one word with a unit ("3d", "12h", "1h30m", "2semanas"). A bare number is not one: "7" in `!ban @x 7 spam` is the days of messages to delete.
const WORD_DURATION = /^\d+(?:[.,]\d+)?[a-záéíóúñêç]+(?:\d+(?:[.,]\d+)?[a-záéíóúñêç]+)*$/i;

/**
 * @param {unknown} token
 * @returns {boolean} whether the word is a length of time with its unit
 */
function looksLikeDuration(token) {
  const text = String(token ?? '').trim();
  return text.length > 0 && text.length <= 64 && WORD_DURATION.test(text) && parseDuration(text) !== null;
}

/**
 * `!mute @member 3d spam` and `!ban @member 7d spam` are temporary: a length of time right after the member says so, with no `temp` word.
 * `durationOption` is what the command read for its `duration` option (the prefix reader fills it with the first word after the member when it looks like a
 * time, and a slash command has it as an option) and `reasonText` the reason. When the word is not a real length of time (a plain number, a word) it goes
 * back to the front of the reason, so a reason is never lost. Returns the duration to use (or null for a permanent action) and the reason left.
 * @param {string | null | undefined} durationOption
 * @param {string | null | undefined} reasonText
 * @returns {{ duration: string | null, reason: string | null }}
 */
function splitLeadingDuration(durationOption, reasonText) {
  const given = String(durationOption ?? '').trim();
  const reason = String(reasonText ?? '').trim();
  if (given) {
    if (looksLikeDuration(given)) return { duration: given, reason: reason || null };
    return { duration: null, reason: [given, reason].filter(Boolean).join(' ') || null };
  }
  const [first, ...rest] = reason.split(/\s+/);
  if (first && looksLikeDuration(first)) return { duration: first, reason: rest.join(' ') || null };
  return { duration: null, reason: reason || null };
}

module.exports = { parseDuration, formatDuration, looksLikeDuration, splitLeadingDuration };
