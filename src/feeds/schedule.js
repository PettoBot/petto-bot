// The auto feeds (the Pokémon, an article of Wikipedia, a puzzle of Chess.com, a cat, a dog or a fox) have nothing to wait for: they post at a pace the server chooses, from once a
// day to every 5 minutes. The pace is part of the account (`every:15`), so the engine treats each pace as one account and asks for its content once for every
// server that uses it. The slots are counted from the clock (the Unix epoch), so every server that picked 15 minutes gets the same notice at the same time.
const MIN_MINUTES = 5; // less would only flood a channel; the content of a slot is asked once for every server, so a short pace costs the public APIs nothing extra
const DAY_MINUTES = 1440;
const LEGACY = { pokemon: 'daily', wikipedia: 'featured', chess: 'puzzle', cat: 'daily', dog: 'daily', fox: 'daily', animals: 'daily' }; // the account of the once-a-day feeds made before there was a pace to pick
const MINUTE_MS = 60_000;

/** The pace a person wrote (`15`, `30m`, `2h`, `1d`, `every:45`, or nothing for once a day) in minutes, or null when it is out of range. */
function parseMinutes(text) {
  const value = String(text ?? '').trim().toLowerCase();
  if (!value || value === 'daily' || value === 'featured' || value === 'puzzle') return DAY_MINUTES;
  const match = /^(?:every:)?(\d{1,4})\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?)?$/.exec(value);
  if (!match) return DAY_MINUTES; // anything else (the page of the platform the dashboard used to send) is the old once-a-day feed
  const unit = (match[2] ?? 'm')[0];
  const minutes = Number(match[1]) * (unit === 'h' ? 60 : unit === 'd' ? DAY_MINUTES : 1);
  return minutes >= MIN_MINUTES && minutes <= DAY_MINUTES ? minutes : null;
}

/** The account of a platform for a pace: the old name for once a day, `every:N` for the others. */
const accountIdFor = (platform, minutes) => (minutes === DAY_MINUTES ? LEGACY[platform] : `every:${minutes}`);

/** The pace of an account in minutes (once a day for the old ones). */
function minutesOf(accountId) {
  const match = /^every:(\d+)$/.exec(String(accountId ?? ''));
  return match ? Number(match[1]) : DAY_MINUTES;
}

const slotOf = (now, minutes) => Math.floor(now / (minutes * MINUTE_MS));
const slotStart = (slot, minutes) => slot * minutes * MINUTE_MS;

module.exports = { MIN_MINUTES, DAY_MINUTES, parseMinutes, accountIdFor, minutesOf, slotOf, slotStart };
