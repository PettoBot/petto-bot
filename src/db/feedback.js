// i18n-ignore-file: SQL for the feedback board, no text anybody reads
// The feedback board of the website (petto.sbs/feedback): the posts, votes and comments are in the main database (the website writes them
// through the dashboard API); the bot reads a post to draw its card and writes the votes that come from the buttons of that card.
// The counters of the post (likes, dislikes, comments) follow the votes and comments with database triggers.
const { getPrimaryPool } = require('./postgres');

const COLUMNS = 'id::text as id, user_id, username, avatar, kind, title, body, tags, status, status_note, votes_up, votes_down, comments_count, discord_channel_id, discord_message_id, created_at, updated_at';

async function getPost(id) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) return null;
  const { rows } = await getPrimaryPool().query(`select ${COLUMNS} from feedback_posts where id = $1`, [Number(id)]);
  return rows[0] ?? null;
}

/** The vote (1, -1 or 0) a person gave to a post. */
async function currentVote(postId, userId) {
  const { rows } = await getPrimaryPool().query('select value from feedback_votes where post_id = $1 and user_id = $2', [Number(postId), String(userId)]);
  return Number(rows[0]?.value) || 0;
}

/** Sets the vote of a person (1, -1) or takes it back (0). */
async function setVote(postId, userId, value) {
  const pool = getPrimaryPool();
  if (!value) {
    await pool.query('delete from feedback_votes where post_id = $1 and user_id = $2', [Number(postId), String(userId)]);
    return;
  }
  await pool.query(
    'insert into feedback_votes (post_id, user_id, value) values ($1, $2, $3) on conflict (post_id, user_id) do update set value = excluded.value',
    [Number(postId), String(userId), value],
  );
}

async function saveMessage(postId, channelId, messageId) {
  await getPrimaryPool().query('update feedback_posts set discord_channel_id = $2, discord_message_id = $3 where id = $1', [Number(postId), channelId ?? null, messageId ?? null]);
}

/** The posts that have a card in the channel, newest first (to draw them again with another bot). */
async function postsWithCard(limit = 500) {
  const { rows } = await getPrimaryPool().query(`select ${COLUMNS} from feedback_posts where discord_message_id is not null order by id desc limit $1`, [limit]);
  return rows;
}

module.exports = { getPost, currentVote, setVote, saveMessage, postsWithCard };
