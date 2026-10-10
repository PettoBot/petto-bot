// The time Petto works in: GMT-5, the time of Colombia (it has no daylight saving). Days, weeks and hours that Petto counts,
// the times people type and the times it writes out all use it, and it says so (`BOT_TIME_LABEL`).
const BOT_TIME_LABEL = 'GMT-5';
const BOT_TIME_NAME = 'GMT-5 (Colombia)';
const BOT_TIME_ZONE = 'America/Bogota';
const OFFSET_MS = -5 * 60 * 60 * 1000;

/** A date moved so that its UTC fields (getUTCHours, getUTCDate...) are the clock of Colombia. */
function shifted(date = new Date()) {
  return new Date(new Date(date).getTime() + OFFSET_MS);
}

/** The day, `YYYY-MM-DD`, in Colombia. */
function botDay(date = new Date()) {
  return shifted(date).toISOString().slice(0, 10);
}

/** The hour of the day, 0 to 23, in Colombia. */
function botHour(date = new Date()) {
  return shifted(date).getUTCHours();
}

/** A date written out with its zone: `Oct 10, 2026, 9:02 PM GMT-5`. */
function formatBotTime(date = new Date(), options = { dateStyle: 'medium', timeStyle: 'short' }) {
  return `${new Intl.DateTimeFormat('en-US', { ...options, timeZone: BOT_TIME_ZONE }).format(new Date(date))} ${BOT_TIME_LABEL}`;
}

module.exports = { BOT_TIME_LABEL, BOT_TIME_NAME, BOT_TIME_ZONE, OFFSET_MS, shifted, botDay, botHour, formatBotTime };
