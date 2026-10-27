// With a second database (PETTO_DATA2_DATABASE_URL): what the main database already has of the avatar copies and of the threat lists is moved over in the
// background (db/dataMove.js), and an hourly pass deletes the copies whose avatar is not in the history any more (what the triggers of the main database did
// when the copies were in it). Without a second database this does nothing.
const dataMove = require('../db/dataMove');
const secondary = require('../db/secondary');
const images = require('../db/profileHistoryImages');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const START_DELAY_MS = 2 * 60_000;
const BUSY_MS = 5_000;
const IDLE_MS = 6 * 60 * 60_000;
const RECONCILE_MS = 60 * 60_000;
const PIECE = { malicious_links: 2000, profile_history_images: 60 };

/** One step of the move: a piece of the first table that still has rows. Returns true when something was moved. */
async function moveStep() {
  for (const [table, limit] of Object.entries(PIECE)) {
    const moved = await dataMove.movePiece(table, limit);
    if (moved) return { table, moved };
  }
  return null;
}

/** The whole table of copies, a page at a time. Returns how many copies were deleted. */
async function reconcileAll(pause = () => new Promise((resolve) => setTimeout(resolve, 200))) {
  let after = null;
  let removed = 0;
  do {
    const page = await images.reconcile({ after });
    removed += page.removed; after = page.after;
    if (after) await pause();
  } while (after);
  return removed;
}

function startDataMoveJob() {
  if (!secondary.isSeparate()) { images.setMovePending(false); return; }
  images.setMovePending(true); // until the main database is known to have nothing left
  let moved = { malicious_links: 0, profile_history_images: 0 };
  const run = exclusiveTask(async () => {
    const step = await moveStep();
    if (step) { moved[step.table] += step.moved; return true; }
    images.setMovePending(false);
    if (moved.malicious_links || moved.profile_history_images) logger.info(`Second database: moved ${moved.malicious_links} threat link(s) and ${moved.profile_history_images} avatar copy(ies) from the main database. A VACUUM FULL of both tables there gives its space back.`);
    moved = { malicious_links: 0, profile_history_images: 0 };
    return false;
  });
  const tick = () => run().then((more) => setTimeout(tick, more ? BUSY_MS : IDLE_MS).unref?.()).catch((error) => { logger.warn(`Second database: the move failed: ${error.message}`); setTimeout(tick, 10 * 60_000).unref?.(); });
  setTimeout(tick, START_DELAY_MS).unref?.();

  const clean = exclusiveTask(() => reconcileAll());
  const cleanTick = () => clean().then((removed) => { if (removed) logger.info(`Avatar copies: ${removed} deleted whose avatar is not in the history any more.`); }).catch((error) => logger.warn(`Avatar copies: the cleanup failed: ${error.message}`));
  setTimeout(cleanTick, 15 * 60_000).unref?.();
  setInterval(cleanTick, RECONCILE_MS).unref?.();
}

module.exports = { startDataMoveJob, moveStep, reconcileAll };
