// Whether the picture of a notice can be loaded yet. A live stream is announced within a minute of its start, and its platform makes the preview of the
// stream a little later: Discord shows a broken picture for one that does not exist, so the notice goes out with a stand-in picture of the platform and
// the engine edits the real one in when it exists.
const { USER_AGENT } = require('../utils/integrations');

const KEEP_MS = 30 * 60_000;
const ready = new Map(); // url -> until (a picture that loaded is remembered)

async function imageReady(url) {
  if (ready.has(url) && ready.get(url) > Date.now()) return true;
  try {
    const response = await globalThis.fetch(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(5000), redirect: 'follow' });
    const type = response.headers.get('content-type');
    const ok = response.ok && (!type || /^image\//i.test(type));
    if (ok) {
      ready.set(url, Date.now() + KEEP_MS);
      for (const [key, until] of ready) if (until < Date.now()) ready.delete(key);
    }
    return ok;
  } catch {
    return false;
  }
}

/** The item with its own picture when that loads, or with the stand-in (`placeholder` tells it is one, and keeps the real address to look again). */
async function withStandIn(item, standIn) {
  if (!item) return item;
  if (item.image && await imageReady(item.image)) return item;
  return { ...item, placeholder: Boolean(item.image), image: standIn };
}

module.exports = { imageReady, withStandIn };
