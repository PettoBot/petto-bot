const database = require('./database');
const { getPrimaryPool } = require('./postgres');

/** Stores a vote. Returns false when that vote was already stored (the list sent it again), true when it is new. */
async function recordVote({ source, voteId, userId, weight, votedAt, expiresAt }) {
  const { error } = await database.from('bot_votes').insert({ source, vote_id: voteId, user_id: userId, weight, voted_at: votedAt, expires_at: expiresAt });
  if (!error) return true;
  if (error.code === '23505') return false;
  throw error;
}

/**
 * The votes of a user and of everyone (a vote that counts double counts as two). `lists` splits them by `bot_votes.source` with one
 * more query: `{ topgg: { total, mine }, omniplex: { total, mine } }` (only the sources that have votes appear). The other fields
 * are the combined numbers and do not depend on it.
 */
async function voteTotals(userId) {
  const pool = getPrimaryPool();
  const [mine, all, bySource] = await Promise.all([
    pool.query('SELECT COALESCE(SUM(weight), 0)::int AS total, MAX(voted_at) AS last FROM bot_votes WHERE user_id = $1', [userId]),
    pool.query('SELECT COALESCE(SUM(weight), 0)::int AS total, COUNT(DISTINCT user_id)::int AS voters FROM bot_votes'),
    pool.query('SELECT source, COALESCE(SUM(weight), 0)::int AS total, COALESCE(SUM(weight) FILTER (WHERE user_id = $1), 0)::int AS mine FROM bot_votes GROUP BY source', [userId]),
  ]);
  const lists = {};
  for (const row of bySource.rows) lists[row.source] = { total: row.total, mine: row.mine };
  return { mine: mine.rows[0].total, last: mine.rows[0].last, total: all.rows[0].total, voters: all.rows[0].voters, lists };
}

/**
 * The votes a person cast in the last 2 days (a boost lasts 12 hours, so older votes cannot matter), newest first: one query that
 * the index on (user_id, voted_at) answers. The boost ends at the latest expiry among them (`latestExpiry` in utils/voteBoost.ts).
 */
async function recentVotes(userId) {
  const result = await getPrimaryPool().query(
    "SELECT voted_at, expires_at FROM bot_votes WHERE user_id = $1 AND voted_at > now() - interval '2 days' ORDER BY voted_at DESC LIMIT 20",
    [userId],
  );
  return result.rows;
}

async function topVoters(limit = 10) {
  const result = await getPrimaryPool().query('SELECT user_id, SUM(weight)::int AS total FROM bot_votes GROUP BY user_id ORDER BY total DESC, MAX(voted_at) DESC LIMIT $1', [limit]);
  return result.rows;
}

module.exports = { recordVote, voteTotals, topVoters, recentVotes };
