// The members whose welcome is waiting for them to finish the steps of the server (see utils/joinGate.js).
// Every statement is a single one, so two events for the same member (or two processes) cannot both take the same row.
const { getPrimaryPool } = require('./postgres');

const WAIT_DAYS = 7;

/** Adds a member to the waiting list; `dueMinutes` is the safety limit of the onboarding, counted from now (null: none yet). False when they were already on it. */
async function add(guildId, userId, dueMinutes = null) {
  const { rowCount } = await getPrimaryPool().query(
    "insert into join_waiting (guild_id, user_id, due_at) values ($1, $2, case when $3::int is null then null else now() + make_interval(mins => $3::int) end) on conflict (guild_id, user_id) do nothing",
    [String(guildId), String(userId), dueMinutes],
  );
  return rowCount > 0;
}

/** Starts the safety limit of a member who has none yet (the rules were just accepted). Does nothing when it already runs. */
async function startDue(guildId, userId, minutes) {
  const { rowCount } = await getPrimaryPool().query(
    'update join_waiting set due_at = now() + make_interval(mins => $3::int) where guild_id = $1 and user_id = $2 and due_at is null',
    [String(guildId), String(userId), minutes],
  );
  return rowCount > 0;
}

/** Takes a member off the list, answering their row (`{ expired }` is true after 7 days), or null when they were not on it. */
async function take(guildId, userId) {
  const { rows } = await getPrimaryPool().query(
    `delete from join_waiting where guild_id = $1 and user_id = $2 returning joined_at, joined_at < now() - interval '${WAIT_DAYS} days' as expired`,
    [String(guildId), String(userId)],
  );
  return rows[0] ?? null;
}

/** Takes off the list, and answers, up to `limit` members whose safety limit has passed. */
async function takeDue(limit = 100) {
  const { rows } = await getPrimaryPool().query(
    `delete from join_waiting where (guild_id, user_id) in (select guild_id, user_id from join_waiting where due_at <= now() and joined_at >= now() - interval '${WAIT_DAYS} days' order by due_at limit $1) returning guild_id, user_id`,
    [limit],
  );
  return rows;
}

/** Deletes every row older than 7 days. Answers the servers they were in (one entry for each row). */
async function removeExpired() {
  const { rows } = await getPrimaryPool().query(`delete from join_waiting where joined_at < now() - interval '${WAIT_DAYS} days' returning guild_id`);
  return rows.map((row) => row.guild_id);
}

/** How many members wait in each server, as a Map. */
async function countsByGuild() {
  const { rows } = await getPrimaryPool().query('select guild_id, count(*)::int as waiting from join_waiting group by guild_id');
  return new Map(rows.map((row) => [row.guild_id, row.waiting]));
}

module.exports = { WAIT_DAYS, add, startDue, take, takeDue, removeExpired, countsByGuild };
