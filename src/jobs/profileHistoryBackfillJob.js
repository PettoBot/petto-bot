// The avatars recorded before Petto kept copies (or whose copy failed) are tried once, slowly, in the background: a little after the bot
// starts, a few at a time through the same queue as the new ones (two downloads at a time), newest first, since a recent avatar is the
// most likely one Discord still serves. One that Discord no longer has is marked and never asked again, so when the backlog is done this
// only looks every few hours for a failed try to repeat (at most 3 tries per avatar).
const logger = require('../utils/logger');

const START_DELAY_MS = 2 * 60_000;
const STEP_MS = 30_000; // a new piece every 30 s at most, and only when the queue has (nearly) caught up
const NEXT_MS = 1_000; // a piece with nothing to try: the next one soon
const IDLE_MS = 6 * 60 * 60_000; // the whole history was read: again in 6 hours (for the failed tries that have attempts left)
const CHUNK = 200;

/**
 * One step: reads the next piece of the history after `cursor` and adds what it has without a copy to the queue, when the queue is nearly
 * empty. Returns `{ added, cursor, done }`, or null when it waited (queue busy) or the total limit is reached.
 */
async function backfillStep({ db, copies, cursor = null, chunk = CHUNK }) {
  if (copies.stats().pending > 5) return null;
  if (await copies.overLimit()) return null;
  const piece = await db.backfillCandidates(cursor, chunk);
  let added = 0;
  for (const row of piece.rows) if (copies.enqueue(row.user_id, row.hash) === 'queued') added += 1;
  return { added, cursor: piece.cursor, done: piece.cursor === null };
}

function startProfileHistoryBackfillJob() {
  const db = require('../db/profileHistoryImages');
  const { avatarCopies } = require('../utils/avatarCopies');
  const copies = avatarCopies();
  let cursor = null;
  let total = 0;
  // Each step plans the next one, so two never run at the same time.
  const step = async () => {
    const result = await backfillStep({ db, copies, cursor });
    if (!result) return STEP_MS;
    total += result.added;
    cursor = result.cursor;
    if (result.done) {
      if (total) logger.info(`Profile history: tried ${total} saved avatar(s) without a copy (${JSON.stringify(copies.stats())}).`);
      total = 0;
      return IDLE_MS;
    }
    return result.added ? STEP_MS : NEXT_MS;
  };
  const schedule = (ms) => setTimeout(() => {
    step().then(schedule).catch((err) => { logger.error('Profile history backfill error:', err); schedule(IDLE_MS); });
  }, ms).unref?.();
  schedule(START_DELAY_MS);
}

module.exports = { startProfileHistoryBackfillJob, backfillStep };
