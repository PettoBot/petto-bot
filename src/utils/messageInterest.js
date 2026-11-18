// i18n-ignore-file: internal piece of the memory of the bot, nothing here reaches a member.
// Which servers need the messages they receive to stay in memory.
//
// discord.js keeps each message it sees (up to 100 for each channel), and a cached message costs about 2 KB. They were all kept for an hour, in the 240
// servers, but the only thing that reads an old message is the log of messages (the text of a message that was edited or deleted, and what a bulk delete
// removed): `!snipe`, the counting game and the pages keep what they need in their own small stores. So a server that has no log of messages turned on does not
// need its messages for an hour: they are swept after `SHORT_LIFETIME_MS`, and the servers with the log keep them for `FULL_LIFETIME_MS`, as before.
//
// The servers with the log (a row of `log_entries` for the event `messages`) are read from the database every two minutes, and `remember` adds one the moment
// someone turns the log on from a command. Until the first reading works, and if the reading fails, nobody is swept earlier than before: it is never less than what it was.
const database = require('../db/database');
const logger = require('./logger');

const FULL_LIFETIME_MS = 60 * 60_000;
const SHORT_LIFETIME_MS = 10 * 60_000;
const REFRESH_MS = 2 * 60_000;
/** How often the sweeper of discord.js passes over the messages (seconds). */
const SWEEP_EVERY_SECONDS = 120;

/** The servers that keep their messages; null while it is not known (then every server does). */
let interested = null;
let timer = null;
let warnedAt = 0;

async function readGuilds() {
  const { data, error } = await database.from('log_entries').select('guild_id').eq('event', 'messages');
  if (error) throw error;
  return (data ?? []).map((row) => String(row.guild_id));
}

/** Reads who has the log of messages. A failure keeps what was known. Answers how many servers have it, or -1 when it could not be read. */
async function refresh(load = readGuilds) {
  try {
    interested = new Set((await load()).map(String));
    return interested.size;
  } catch (error) {
    // Said at most once an hour: a database that is down says it in many other places.
    if (Date.now() - warnedAt > 60 * 60_000) { warnedAt = Date.now(); logger.warn(`Messages kept for the log: the servers with the log could not be read, nothing is swept earlier than before (${error?.message ?? error}).`); }
    return -1;
  }
}

/** Whether the messages of this server have to be kept for an hour. */
function needsMessages(guildId) {
  return interested === null || (guildId != null && interested.has(String(guildId)));
}

/** A server that just turned the log of messages on (from a command) keeps its messages from now, before the next reading. */
function remember(guildId) {
  if (interested && guildId != null) interested.add(String(guildId));
}

/** How long a message of this server stays in memory. */
function lifetimeFor(guildId) {
  return needsMessages(guildId) ? FULL_LIFETIME_MS : SHORT_LIFETIME_MS;
}

/** The filter of the sweeper of messages of discord.js: a message goes when it is older than the time its server needs (counted from its last edit). */
function sweepFilter(now = Date.now) {
  return () => (message) => now() - (message.editedTimestamp ?? message.createdTimestamp ?? 0) > lifetimeFor(message.guildId);
}

/** Starts reading every two minutes (and now). */
function start() {
  if (timer) return;
  refresh().catch(() => {});
  timer = setInterval(() => { refresh().catch(() => {}); }, REFRESH_MS);
  timer.unref?.();
}

/** For the checks. */
function reset() { interested = null; warnedAt = 0; if (timer) { clearInterval(timer); timer = null; } }

module.exports = { FULL_LIFETIME_MS, SHORT_LIFETIME_MS, REFRESH_MS, SWEEP_EVERY_SECONDS, refresh, needsMessages, remember, lifetimeFor, sweepFilter, start, reset };
