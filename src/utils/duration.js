// @ts-check

const ms = require('ms');

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Every way of writing a unit, in English and Spanish.
const UNITS = new Map();
for (const [names, value] of /** @type {[string[], number][]} */ ([
  [['ms', 'msec', 'millisecond', 'milliseconds', 'milisegundo', 'milisegundos'], 1],
  [['s', 'sec', 'secs', 'second', 'seconds', 'seg', 'segs', 'segundo', 'segundos'], SECOND],
  [['m', 'min', 'mins', 'minute', 'minutes', 'minuto', 'minutos'], MINUTE],
  [['h', 'hr', 'hrs', 'hour', 'hours', 'hora', 'horas'], HOUR],
  [['d', 'day', 'days', 'dia', 'dias', 'día', 'días'], DAY],
  [['w', 'wk', 'wks', 'week', 'weeks', 'sem', 'semana', 'semanas'], 7 * DAY],
  [['mo', 'month', 'months', 'mes', 'meses'], 30 * DAY],
  [['y', 'yr', 'yrs', 'year', 'years', 'año', 'años', 'ano', 'anos'], 365 * DAY],
])) for (const name of names) UNITS.set(name, value);

const PIECE = /(\d+(?:[.,]\d+)?)\s*([a-záéíóúñ]+)/giy;
const GLUE = /^[\s,]*(?:and|y|e)?[\s,]*/i;

/**
 * Parses what people write for a length of time into milliseconds: "10m", "2h", "7d", and also pieces together such as
 * "3d 4h", "1 hour 30 minutes" or "1h30m", in English or Spanish. Returns null if it is invalid or not positive.
 * @param {string} str
 * @returns {number | null}
 */
function parseDuration(str) {
  const text = String(str ?? '').trim().toLowerCase();
  if (!text) return null;

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

function formatDuration(msValue) {
  return ms(msValue, { long: true });
}

module.exports = { parseDuration, formatDuration };
