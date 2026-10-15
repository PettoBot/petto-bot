// Dates of birthdays: what counts as a real date, who is celebrating on a day, and how old someone turns.
const { t, currentLanguage } = require('../i18n');

// The names of the months are in the catalogs, under `birthdays.month.<name>`.
const MONTH_KEYS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** The name of a month (1-12) in `lang`. */
const monthName = (month, lang = currentLanguage()) => t(lang, `birthdays.month.${MONTH_KEYS[month - 1]}`);

const isLeapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** The days a month has (February counts 29, so a 29 February birthday can be saved). */
const daysIn = (month) => [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;

/** Checks day, month and (optional) year; returns `{ month, day, year }` or `{ error }` with a short reason in `lang`. */
function parseBirthday({ day, month, year = null }, now = new Date(), lang = currentLanguage()) {
  const d = Number(day);
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) return { error: t(lang, 'birthdays.error.month') };
  if (!Number.isInteger(d) || d < 1 || d > daysIn(m)) return { error: t(lang, 'birthdays.error.day', { month: monthName(m, lang), day }) };
  let y = null;
  if (year !== null && year !== undefined && year !== '') {
    y = Number(year);
    if (!Number.isInteger(y) || y < 1900 || y > now.getUTCFullYear() - 5) return { error: t(lang, 'birthdays.error.year') };
    if (m === 2 && d === 29 && !isLeapYear(y)) return { error: t(lang, 'birthdays.error.leap', { year: y }) };
  }
  return { month: m, day: d, year: y };
}

/** Whether a birthday is celebrated on the local date `{ month, day, year }`: 29 February is celebrated on 28 February in years that have no 29th. */
function celebratesOn(birthday, local) {
  if (birthday.month === local.month && birthday.day === local.day) return true;
  return birthday.month === 2 && birthday.day === 29 && !isLeapYear(local.year) && local.month === 2 && local.day === 28;
}

/** The date and hour in a place `offsetMinutes` away from UTC, at `now`. */
function localDate(now, offsetMinutes) {
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), hour: shifted.getUTCHours(), iso: shifted.toISOString().slice(0, 10) };
}

/** The age someone turns on `local`, or null when they did not say the year. */
const ageOn = (birthday, local) => (birthday.year ? local.year - birthday.year : null);

/** Days until the next birthday from `local` (0 is today). */
function daysUntil(birthday, local) {
  const today = Date.UTC(local.year, local.month - 1, local.day);
  for (const year of [local.year, local.year + 1, local.year + 2, local.year + 4]) {
    const month = birthday.month === 2 && birthday.day === 29 && !isLeapYear(year) ? 2 : birthday.month;
    const day = birthday.month === 2 && birthday.day === 29 && !isLeapYear(year) ? 28 : birthday.day;
    const at = Date.UTC(year, month - 1, day);
    if (at >= today) return Math.round((at - today) / 86_400_000);
  }
  return 0;
}

/** The age someone turns on their next birthday (today counts), or null without a year. */
function nextAge(birthday, local) {
  if (!birthday.year) return null;
  const passed = birthday.month < local.month || (birthday.month === local.month && birthday.day < local.day);
  return local.year + (passed ? 1 : 0) - birthday.year;
}

const formatDay = ({ month, day }, lang = currentLanguage()) => t(lang, 'birthdays.date', { day, month: monthName(month, lang) });

/** `-5`, `UTC-5`, `GMT+5:30` or `+05:30` as minutes from UTC, or null. */
function parseOffset(text) {
  const match = /^\s*(?:utc|gmt)?\s*([+-])?\s*(\d{1,2})(?::?(\d{2}))?\s*$/i.exec(String(text ?? ''));
  if (!match) return null;
  const minutes = (Number(match[2]) * 60 + Number(match[3] ?? 0)) * (match[1] === '-' ? -1 : 1);
  return minutes >= -720 && minutes <= 840 ? minutes : null;
}

function formatOffset(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : ''}`;
}

module.exports = { monthName, isLeapYear, daysIn, parseBirthday, celebratesOn, localDate, ageOn, nextAge, daysUntil, formatDay, parseOffset, formatOffset };
