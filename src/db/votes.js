const database = require('./database');
const { getPrimaryPool } = require('./postgres');

/** Stores a vote. Returns false when that vote was already stored (the list sent it again), true when it is new. */
async function recordVote({ source, voteId, userId, weight, votedAt, expiresAt }) {
  const { error } = await database.from('bot_votes').insert({ source, vote_id: voteId, user_id: userId, weight, voted_at: votedAt, expires_at: expiresAt });
  if (!error) return true;
  if (error.code === '23505') return false;
  throw error;
}

/** The votes of a user and of everyone (a vote that counts double counts as two). */
async function voteTotals(userId) {
  const pool = getPrimaryPool();
  const [mine, all] = await Promise.all([
    pool.query('SELECT COALESCE(SUM(weight), 0)::int AS total, MAX(voted_at) AS last FROM bot_votes WHERE user_id = $1', [userId]),
    pool.query('SELECT COALESCE(SUM(weight), 0)::int AS total, COUNT(DISTINCT user_id)::int AS voters FROM bot_votes'),
  ]);
  return { mine: mine.rows[0].total, last: mine.rows[0].last, total: all.rows[0].total, voters: all.rows[0].voters };
}

async function topVoters(limit = 10) {
  const result = await getPrimaryPool().query('SELECT user_id, SUM(weight)::int AS total FROM bot_votes GROUP BY user_id ORDER BY total DESC, MAX(voted_at) DESC LIMIT $1', [limit]);
  return result.rows;
}

module.exports = { recordVote, voteTotals, topVoters };
