// Whether the picture of a notice can be loaded yet. A live stream is announced within a minute of its start, and its platform makes the preview of the
// stream a little later: Discord shows a broken picture for one that does not exist, so the notice goes out with a stand-in picture of the platform and
// the engine edits the real one in when it exists.
const { USER_AGENT } = require('../utils/integrations');

const KEEP_MS = 30 * 60_000;
const MIN_BYTES = 2_000; // what a made preview weighs at the least: a few bytes is the empty answer a CDN gives while it is still making it
const MAGIC = [[0x89, 0x50, 0x4e, 0x47], [0xff, 0xd8, 0xff], [0x47, 0x49, 0x46, 0x38], [0x52, 0x49, 0x46, 0x46]]; // png, jpeg, gif, riff (webp)
const ready = new Map(); // url -> until (a picture that loaded is remembered)

async function imageReady(url) {
  if (ready.has(url) && ready.get(url) > Date.now()) return true;
  try {
    // A real look at the first bytes (not only the headers): Discord reads the picture itself, and a CDN that answers a HEAD with 200 can still have nothing to show.
    const response = await globalThis.fetch(url, { headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-4095' }, signal: AbortSignal.timeout(6000), redirect: 'follow' });
    const type = response.headers.get('content-type');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const total = Number(/\/(\d+)$/.exec(response.headers.get('content-range') ?? '')?.[1] ?? response.headers.get('content-length') ?? bytes.length);
    const ok = response.ok && (!type || /^image\//i.test(type)) && total >= MIN_BYTES && MAGIC.some((magic) => magic.every((byte, i) => bytes[i] === byte));
    if (ok) {
      ready.set(url, Date.now() + KEEP_MS);
      for (const [key, until] of ready) if (until < Date.now()) ready.delete(key);
    }
    return ok;
  } catch {
    return false;
  }
}

/**
 * The item with its own picture when that loads, or with the stand-in (`placeholder` tells it is one, and keeps the real address to look again).
 * `minAgeMs`: a stream younger than that has no preview yet whatever its address answers (Discord asks once, and what it could not load stays broken), so it goes with the stand-in.
 */
async function withStandIn(item, standIn, { minAgeMs = 0, now = Date.now() } = {}) {
  if (!item) return item;
  const young = minAgeMs > 0 && Number.isFinite(item.publishedAt) && now - item.publishedAt < minAgeMs;
  if (item.image && !young && await imageReady(item.image)) return item;
  return { ...item, placeholder: true, image: standIn };
}

module.exports = { imageReady, withStandIn };
