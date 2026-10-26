// What `!stats` reads. The small counters (per channel, hour, day, content, stay) come with a plain select; what is per member is added up by the
// database, so a big server does not send a row for every member and every day.
const database = require('./database');
const { getPrimaryPool } = require('./postgres');
const { botDay } = require('../utils/botTime');

const DAY_MS = 86_400_000;
const startOf = (days, now = new Date()) => botDay(new Date(now.getTime() - Math.max(0, days - 1) * DAY_MS));

async function select(table, columns, guildId, fromDay) {
  const { data, error } = await database.from(table).select(columns).eq('guild_id', guildId).gte('day', fromDay).order('day', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Everything for the server statistics of `days` days and the same number before them. `memberTotal` is the members the server has now, for the
 * growth line. `perMember` is false when the server keeps no counts per member: the member lists then come empty.
 */
async function readServerStats(guildId, days, { perMember = true, now = new Date() } = {}) {
  const from = startOf(days * 2, now);
  const currentFrom = startOf(days, now);
  const pool = getPrimaryPool();
  const [channelRows, hourlyRows, flowRows, contentRows, lifespanRows, memberDaily, memberTotals, distinct] = await Promise.all([
    select('activity_stats', 'channel_id, day, messages, reactions, voice_seconds', guildId, from),
    select('activity_hourly', 'day, hour, messages, voice_seconds', guildId, currentFrom),
    select('member_flow', 'day, joins, leaves, invited', guildId, from),
    select('activity_content', 'day, links, attachments, replies, mentions', guildId, from),
    select('member_lifespan', 'day, bucket, members', guildId, currentFrom),
    perMember ? pool.query(`select day::text as day, count(*)::int as active from activity_members where guild_id = $1 and day >= $2 and (messages > 0 or voice_seconds > 0) group by day`, [guildId, from]).then((r) => r.rows) : [],
    perMember ? pool.query(`select user_id, sum(messages)::int as messages, sum(voice_seconds)::int as voice_seconds, count(*) filter (where messages > 0 or voice_seconds > 0)::int as active_days from activity_members where guild_id = $1 and day >= $2 group by user_id`, [guildId, currentFrom]).then((r) => r.rows) : [],
    perMember ? pool.query(`select count(distinct user_id) filter (where day >= $3)::int as current, count(distinct user_id) filter (where day < $3)::int as previous from activity_members where guild_id = $1 and day >= $2 and (messages > 0 or voice_seconds > 0)`, [guildId, from, currentFrom]).then((r) => r.rows[0]) : null,
  ]);
  return { channelRows, hourlyRows, flowRows, contentRows, lifespanRows, memberDaily, memberTotals, activeDistinct: distinct };
}

/** The counters per day of one member in the period and the one before, and the totals of every member in the period (for their place). */
async function readMemberStats(guildId, userId, days, { now = new Date() } = {}) {
  const pool = getPrimaryPool();
  const [userRows, memberTotals] = await Promise.all([
    pool.query('select day::text as day, messages, voice_seconds from activity_members where guild_id = $1 and user_id = $2 and day >= $3 order by day', [guildId, userId, startOf(days * 2, now)]).then((r) => r.rows),
    pool.query('select user_id, sum(messages)::int as messages, sum(voice_seconds)::int as voice_seconds from activity_members where guild_id = $1 and day >= $2 group by user_id', [guildId, startOf(days, now)]).then((r) => r.rows),
  ]);
  return { userRows, memberTotals };
}

module.exports = { startOf, readServerStats, readMemberStats };
