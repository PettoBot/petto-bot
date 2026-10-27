// i18n-ignore-file: only logged, never shown to anyone
// Copies of the avatars of the profile history. Discord stops serving an old avatar soon after it is changed, so the picture is downloaded
// the moment Petto records it (it is live then) and kept in PostgreSQL (src/db/profileHistoryImages.js).
//
// A small queue does the downloads: two at a time with a short pause (0.5 s) after each, so a burst of profile changes (a big server joining,
// a restart) waits in line instead of hammering Discord's CDN. A failed download is tried once more a little later, then skipped; an
// answer that Discord no longer has the picture (404/403) is remembered so it is never asked again. The picture is drawn at 256x256 and
// kept as WebP: an animated avatar (a_ hash) keeps its first frame, the same still the history page and `!profilehistory` always showed
// (a GIF can weigh megabytes, and a person can have 100 avatars).
const { createCanvas } = require('@napi-rs/canvas');
const logger = require('./logger');

const config = require('../config');

const SIZE = 256;
const WEBP_QUALITY = 72; // 90 made copies twice as heavy for a difference nobody sees in an avatar
const DOWNLOAD_LIMIT = 2 * 1024 * 1024;
const TOTAL_LIMIT = config.avatarCopiesMaxMb * 1024 * 1024; // past it no new copy is made (AVATAR_COPIES_MAX_MB)
const TOTAL_CHECK_MS = 10 * 60_000;

const sourceUrl = (userId, hash) => `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=${SIZE}`;

/** Draws a picture at SIZE x SIZE (covering, centred) and returns it as WebP. */
function toWebp(image) {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  const scale = Math.max(SIZE / image.width, SIZE / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.drawImage(image, (SIZE - width) / 2, (SIZE - height) / 2, width, height);
  return canvas.toBuffer('image/webp', WEBP_QUALITY);
}

/**
 * `db` is src/db/profileHistoryImages.js (or a stand-in), `fetchBuffer(link, request, { maxBytes })` and `decode(bytes)` those of
 * src/utils/safeImage.js. Returns the queue: `enqueue(userId, hash)`, `forgetUser(userId)`, `idle()`, `stats()`.
 */
function createAvatarCopies({ db, fetchBuffer, decode, concurrency = 2, maxQueue = 300, retryDelayMs = 20_000, gapMs = 500, totalLimit = TOTAL_LIMIT } = {}) {
  const queue = [];
  const keys = new Set(); // queued, running or waiting for their retry
  const forgotten = new Set(); // people whose history was turned off or cleared while a download of theirs was running
  let running = 0;
  let idleWaiters = [];
  let total = { bytes: 0, at: 0 };
  const counts = { stored: 0, missing: 0, failed: 0, dropped: 0 };

  const keyOf = (userId, hash) => `${userId}:${hash}`;

  async function overLimit() {
    if (Date.now() - total.at > TOTAL_CHECK_MS) total = { bytes: await db.totalSize(), at: Date.now() };
    return total.bytes >= totalLimit;
  }

  function settle() {
    if (running || queue.length || keys.size) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  async function run(task) {
    const key = keyOf(task.userId, task.hash);
    let retry = false;
    try {
      if (await overLimit()) { counts.dropped += 1; return; }
      let bytes;
      try {
        const image = await decode(await fetchBuffer(sourceUrl(task.userId, task.hash), undefined, { maxBytes: DOWNLOAD_LIMIT }));
        bytes = toWebp(image);
      } catch (err) {
        if (forgotten.has(task.userId)) return;
        const status = Number(err?.status);
        if (status === 404 || status === 403) {
          counts.missing += 1;
          await db.markFailed(task.userId, task.hash, { missing: true });
        } else if (!task.retried) {
          retry = true;
        } else {
          counts.failed += 1;
          await db.markFailed(task.userId, task.hash, { missing: false });
        }
        return;
      }
      if (forgotten.has(task.userId)) return;
      if (await db.store(task.userId, task.hash, { contentType: 'image/webp', bytes })) {
        counts.stored += 1;
        total.bytes += bytes.length;
      }
    } catch (err) {
      logger.warn(`Profile history: could not keep the avatar ${task.hash} of ${task.userId}: ${err.message}`);
    } finally {
      const done = () => {
        running -= 1;
        if (retry) {
          const timer = setTimeout(() => {
            if (forgotten.has(task.userId) || !keys.has(key)) { keys.delete(key); settle(); return; }
            queue.push({ ...task, retried: true });
            pump();
          }, retryDelayMs);
          timer.unref?.();
        } else {
          keys.delete(key);
        }
        pump();
        settle();
      };
      if (gapMs > 0) setTimeout(done, gapMs).unref?.(); else done();
    }
  }

  function pump() {
    while (running < concurrency && queue.length) {
      const task = queue.shift();
      running += 1;
      run(task);
    }
  }

  /** Adds an avatar to copy. Returns 'queued', 'duplicate', 'full' or 'invalid'. */
  function enqueue(userId, hash) {
    if (!/^\d{15,25}$/.test(String(userId)) || !/^(a_)?[0-9a-f]{32}$/.test(String(hash ?? ''))) return 'invalid';
    const key = keyOf(userId, hash);
    if (keys.has(key)) return 'duplicate';
    if (queue.length >= maxQueue) { counts.dropped += 1; return 'full'; }
    forgotten.delete(String(userId));
    keys.add(key);
    queue.push({ userId: String(userId), hash: String(hash), retried: false });
    pump();
    return 'queued';
  }

  /** The person turned the history off or cleared it: what is waiting is dropped and what is running is not saved. */
  function forgetUser(userId) {
    const id = String(userId);
    forgotten.add(id);
    if (forgotten.size > 1000) forgotten.delete(forgotten.values().next().value);
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index].userId === id) {
        keys.delete(keyOf(id, queue[index].hash));
        queue.splice(index, 1);
      }
    }
    for (const key of [...keys]) if (key.startsWith(`${id}:`) && !queue.some((task) => keyOf(task.userId, task.hash) === key)) keys.delete(key);
    settle();
  }

  /** Resolves when nothing is queued, running or waiting for a retry. */
  function idle() {
    if (!running && !queue.length && !keys.size) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  const stats = () => ({ queued: queue.length, running, pending: keys.size, ...counts });

  return { enqueue, forgetUser, idle, stats, overLimit };
}

let shared = null;
/** The queue the bot uses, with the real database and downloader. */
function avatarCopies() {
  if (!shared) {
    const { fetchImageBuffer, decode } = require('./safeImage');
    shared = createAvatarCopies({ db: require('../db/profileHistoryImages'), fetchBuffer: fetchImageBuffer, decode });
  }
  return shared;
}

module.exports = { createAvatarCopies, avatarCopies, sourceUrl, toWebp, SIZE, TOTAL_LIMIT, WEBP_QUALITY };
