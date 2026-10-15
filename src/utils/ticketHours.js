// The hours of the staff for tickets: whether it is inside them now (in the timezone the server chose) and the text that says so.
// Days are 0 (Sunday) to 6 (Saturday). A range that ends before it starts (22:00 to 06:00) runs through the night into the next day.
const { t, currentLanguage, DEFAULT_LANGUAGE } = require('../i18n');

const DEFAULT_MESSAGE = t(DEFAULT_LANGUAGE, 'tickets.hours.defaultMessage');

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMinutes = (text) => { const m = TIME.exec(String(text ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** True for a timezone name Intl knows (`America/Bogota`, `UTC`...). */
function isValidTimezone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: String(tz) }); return true; } catch { return false; }
}

/** The weekday (0-6) and the minutes since midnight of an instant in a timezone. */
function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** True when the staff is on duty (or the hours are not turned on). */
function isWithinHours(settings, date = new Date()) {
  if (!settings?.hours_enabled) return true;
  const start = toMinutes(settings.hours_start);
  const end = toMinutes(settings.hours_end);
  const days = Array.isArray(settings.hours_days) && settings.hours_days.length ? settings.hours_days.map(Number) : [1, 2, 3, 4, 5];
  const timezone = isValidTimezone(settings.hours_timezone) ? settings.hours_timezone : 'UTC';
  if (start === null || end === null) return true;
  const { day, minutes } = localParts(date, timezone);
  if (start === end) return days.includes(day); // the whole day
  if (start < end) return days.includes(day) && minutes >= start && minutes < end;
  // Through the night: the evening belongs to that day, the early morning to the day before.
  if (minutes >= start) return days.includes(day);
  if (minutes < end) return days.includes((day + 6) % 7);
  return false;
}

/** The message for outside the hours (the server's own, or Petto's in `lang`), with {start}, {end} and {timezone} filled in. */
function outsideHoursText(settings, lang = currentLanguage()) {
  const text = String(settings?.hours_message || t(lang, 'tickets.hours.defaultMessage'));
  return text.replaceAll('{start}', settings?.hours_start ?? '').replaceAll('{end}', settings?.hours_end ?? '').replaceAll('{timezone}', settings?.hours_timezone ?? 'UTC').slice(0, 1000);
}

module.exports = { DEFAULT_MESSAGE, isValidTimezone, isWithinHours, outsideHoursText, toMinutes };
