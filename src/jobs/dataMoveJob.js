// With a second database (PETTO_DATA2_DATABASE_URL): what the main database already has of the public threat lists is moved over in the background
// (db/dataMove.js). Without a second database this does nothing.
const dataMove = require('../db/dataMove');
const secondary = require('../db/secondary');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const START_DELAY_MS = 2 * 60_000;
const BUSY_MS = 5_000;
const IDLE_MS = 6 * 60 * 60_000;
const PIECE = { malicious_links: 2000 };

/** One step of the move: a piece of the first table that still has rows. Returns true when something was moved. */
async function moveStep() {
  for (const [table, limit] of Object.entries(PIECE)) {
    const moved = await dataMove.movePiece(table, limit);
    if (moved) return { table, moved };
  }
  return null;
}

function startDataMoveJob() {
  if (!secondary.isSeparate()) return;
  let moved = { malicious_links: 0 };
  const run = exclusiveTask(async () => {
    const step = await moveStep();
    if (step) { moved[step.table] += step.moved; return true; }
    if (moved.malicious_links) logger.info(`Second database: moved ${moved.malicious_links} threat link(s) from the main database. A VACUUM FULL of the table there gives its space back.`);
    moved = { malicious_links: 0 };
    return false;
  });
  const tick = () => run().then((more) => setTimeout(tick, more ? BUSY_MS : IDLE_MS).unref?.()).catch((error) => { logger.warn(`Second database: the move failed: ${error.message}`); setTimeout(tick, 10 * 60_000).unref?.(); });
  setTimeout(tick, START_DELAY_MS).unref?.();
}

module.exports = { startDataMoveJob, moveStep };
