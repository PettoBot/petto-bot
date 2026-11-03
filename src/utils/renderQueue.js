// i18n-ignore-file: infrastructure for generated pictures, nothing here is shown to anyone
// What makes a generated picture instant the second time and harmless in a burst: a cache of finished files with a time to live and a size
// limit, one render shared by identical requests that arrive together, and a small limit on how many pictures are drawn at once so a burst of
// commands never holds the event loop for long (drawing is short, but 50 of them in a row are not).
//   IMAGE_RENDER_CONCURRENCY  pictures drawn at the same time (default 4, 1 to 16)
//   IMAGE_CACHE_MAX_MB        the size limit of one cache of finished pictures (default 16 MB, 1 to 256)
const number = (name, fallback, min, max) => Math.min(max, Math.max(min, Math.floor(Number(process.env[name])) || fallback));

let running = 0;
const waiting = [];
/** Runs `job` when fewer than the limit are running; the rest wait their turn in order. */
function limited(job) {
  return new Promise((resolve, reject) => {
    const start = () => {
      running += 1;
      Promise.resolve().then(job).then(resolve, reject).finally(() => {
        running -= 1;
        const next = waiting.shift();
        if (next) next();
      });
    };
    if (running < number('IMAGE_RENDER_CONCURRENCY', 4, 1, 16)) start(); else waiting.push(start);
  });
}

/**
 * A cache of finished pictures. `get(key, make)` answers from the cache, joins a render of the same key that is already going, or runs
 * `make()` (through the limit) and keeps what it returns (`{ buffer, ... }`). A failed render is not kept. Entries expire after `ttlMs`
 * and the oldest go first when the cache is over `maxEntries` or over its size limit.
 */
function createPictureCache({ ttlMs, maxEntries = 200, maxMb = null }) {
  const done = new Map();
  const pending = new Map();
  let bytes = 0;
  const limitBytes = () => (maxMb ?? number('IMAGE_CACHE_MAX_MB', 16, 1, 256)) * 1024 * 1024;
  const drop = (key) => { const old = done.get(key); if (old) { bytes -= old.value.buffer.length; done.delete(key); } };

  async function get(key, make) {
    const hit = done.get(key);
    if (hit && hit.expires > Date.now()) { done.delete(key); done.set(key, hit); return hit.value; }
    if (hit) drop(key);
    let job = pending.get(key);
    if (!job) {
      job = limited(make).then((value) => {
        done.set(key, { value, expires: Date.now() + ttlMs });
        bytes += value.buffer.length;
        while (done.size > maxEntries || bytes > limitBytes()) drop(done.keys().next().value);
        return value;
      }).finally(() => pending.delete(key));
      pending.set(key, job);
    }
    return job;
  }
  return { get, clear() { done.clear(); pending.clear(); bytes = 0; }, stats: () => ({ entries: done.size, bytes }) };
}

module.exports = { limited, createPictureCache };
