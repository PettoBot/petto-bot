// The copies of avatars made when the quality was higher are rewritten, a few at a time, at the quality used now (about half the size). A copy
// is only replaced when the new one is clearly smaller, and each is looked at once. The space is reused by the database; the size shown by the host
// goes down when the table is rewritten (VACUUM FULL).
const { loadImage } = require('@napi-rs/canvas');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const START_DELAY_MS = 3 * 60_000;
const STEP_MS = 60_000;
const BATCH = 40;
const GAIN = 0.85; // the new copy must be at most this share of the old one

/** One batch. Returns { looked, packed, saved } (bytes saved). `db` and `toWebp` can be stand-ins. */
async function packStep({ db = require('../db/profileHistoryImages'), toWebp = require('../utils/avatarCopies').toWebp, batch = BATCH } = {}) {
  const rows = await db.unpacked(batch);
  const out = { looked: rows.length, packed: 0, saved: 0 };
  for (const row of rows) {
    try {
      const smaller = toWebp(await loadImage(row.bytes));
      if (smaller.length <= row.bytes.length * GAIN) {
        await db.markPacked(row.user_id, row.hash, smaller);
        out.packed += 1; out.saved += row.bytes.length - smaller.length;
      } else await db.markPacked(row.user_id, row.hash);
    } catch {
      await db.markPacked(row.user_id, row.hash).catch(() => {}); // a picture that cannot be read is left as it is, once
    }
  }
  return out;
}

function startAvatarPackJob() {
  let total = { packed: 0, saved: 0 };
  const run = exclusiveTask(async () => {
    const step = await packStep();
    total = { packed: total.packed + step.packed, saved: total.saved + step.saved };
    if (!step.looked) {
      if (total.packed) logger.info(`Avatar copies: ${total.packed} rewritten smaller, ${(total.saved / 1048576).toFixed(1)} MB less.`);
      total = { packed: 0, saved: 0 };
      return false;
    }
    return true;
  });
  const tick = () => run().then((more) => setTimeout(tick, more ? STEP_MS : 6 * 60 * 60_000).unref?.()).catch((error) => { logger.warn(`Avatar copies: the repacking failed: ${error.message}`); setTimeout(tick, 60 * 60_000).unref?.(); });
  setTimeout(tick, START_DELAY_MS).unref?.();
}

module.exports = { startAvatarPackJob, packStep };
