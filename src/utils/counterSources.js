// The counter types read from the database instead of the caches of discord.js: the members a Vanity rule matches now (the identity
// tables) and the messages of the day (activity_stats, the day of Colombia like the other daily stats). Each is read at most once a
// minute per server, and only for servers that have such a counter (or when the dashboard asks).
const { DB_TYPES } = require('./counterNames');
const { storeValue, storedValue } = require('./counterValues');
const { botDay } = require('./botTime');

const FRESH_MS = 55_000;

async function readValue(guildId, type, now) {
  const { getPrimaryPool } = require('../db/postgres');
  const pool = getPrimaryPool();
  if (type === 'vanity_users') {
    const { rows } = await pool.query("select count(distinct user_id)::int as n from identity_role_grants where guild_id = $1 and source_type = 'vanity' and matched = true", [String(guildId)]);
    return rows[0]?.n ?? 0;
  }
  if (type === 'messages_today') {
    const { rows } = await pool.query('select coalesce(sum(messages), 0)::int as n from activity_stats where guild_id = $1 and day = $2::date', [String(guildId), botDay(new Date(now))]);
    return rows[0]?.n ?? 0;
  }
  return 0;
}

let reader = readValue;

/** Makes sure the value of a database type is at most a minute old. Keeps the last value when the database does not answer. */
async function loadValue(guildId, type, { now = Date.now(), force = false } = {}) {
  if (!DB_TYPES.has(type)) return null;
  const last = storedValue(guildId, type);
  if (!force && last && now - last.at < FRESH_MS) return last.value;
  try {
    const value = Math.max(0, Math.trunc(Number(await reader(guildId, type, now)) || 0));
    storeValue(guildId, type, value, now);
    return value;
  } catch {
    if (last) storeValue(guildId, type, last.value, now);
    return last?.value ?? 0;
  }
}

/** For the checks: reads the values another way. */
function setReader(fn) { reader = fn ?? readValue; }

module.exports = { loadValue, setReader, FRESH_MS };
