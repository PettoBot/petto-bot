// i18n-ignore-file: failures here only mean "draw the initial instead", nothing is shown to anyone
// Small avatars for the pictures Petto draws (the podium of the leaderboard). A picture is fetched from Discord's own CDN only, as a small WebP,
// with a short time limit, and kept as its bytes (about 3 KB each) in an LRU, so the next picture that needs the same avatar does no network at
// all. Two requests for the same avatar at the same time share one download. An avatar that cannot be had is remembered as missing for a minute,
// so a slow CDN is not asked again for every row; the caller then draws a circle with the initial.
//   AVATAR_CACHE_ENTRIES     how many avatars are kept (default 500, 10 to 5000)
//   AVATAR_CACHE_TTL_MS      how long (default 10 minutes, 10 seconds to 24 hours)
//   AVATAR_FETCH_TIMEOUT_MS  the time limit of one download (default 1500, 200 to 8000)
const { loadImage } = require('@napi-rs/canvas');

const number = (name, fallback, min, max) => Math.min(max, Math.max(min, Math.floor(Number(process.env[name])) || fallback));
const HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const MAX_BYTES = 256 * 1024;
const MISSING_MS = 60_000;

const cache = new Map(); // normalized link -> { buffer | null, expires }
const pending = new Map();

/** The link of a small WebP of an avatar, or null when the link is not one of Discord's CDN. `size` is a power of two from 16 to 256. */
function avatarLink(link, size = 128) {
  let url;
  try { url = new URL(String(link)); } catch { return null; }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.username || url.password || url.port) return null;
  url.pathname = url.pathname.replace(/\.(png|jpe?g|gif)$/i, '.webp');
  url.search = `?size=${size}`;
  return url.toString();
}

async function download(link) {
  const res = await fetch(link, { signal: AbortSignal.timeout(number('AVATAR_FETCH_TIMEOUT_MS', 1500, 200, 8000)), headers: { 'User-Agent': 'PettoCards/1.0', Accept: 'image/*' } });
  if (!res.ok) throw new Error(`status ${res.status}`);
  if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('too large');
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new Error('too large');
  return buffer;
}
let fetcher = download;
/** For tests: replaces the download with `(link) => Buffer`. Without an argument the real one comes back. */
function setAvatarFetcher(fn) { fetcher = fn ?? download; }

async function bytesFor(link) {
  const hit = cache.get(link);
  if (hit && hit.expires > Date.now()) { cache.delete(link); cache.set(link, hit); return hit.buffer; }
  let job = pending.get(link);
  if (!job) {
    job = (async () => {
      let buffer = null;
      const limit = number('AVATAR_FETCH_TIMEOUT_MS', 1500, 200, 8000) + 300; // a fetcher that never answers cannot hold a picture for ever
      let timer;
      try { buffer = await Promise.race([fetcher(link), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), limit); })]); } catch { buffer = null; } finally { clearTimeout(timer); }
      const ttl = buffer ? number('AVATAR_CACHE_TTL_MS', 600_000, 10_000, 86_400_000) : MISSING_MS;
      cache.set(link, { buffer, expires: Date.now() + ttl });
      while (cache.size > number('AVATAR_CACHE_ENTRIES', 500, 10, 5000)) cache.delete(cache.keys().next().value);
      return buffer;
    })().finally(() => pending.delete(link));
    pending.set(link, job);
  }
  return job;
}

/** The decoded avatar for a link (an image to draw), or null when it cannot be had in time. It never throws. */
async function loadAvatar(link, size = 128) {
  const normal = avatarLink(link, size);
  if (!normal) return null;
  const buffer = await bytesFor(normal);
  if (!buffer) return null;
  try { return await loadImage(buffer); } catch { return null; }
}

function clearAvatars() { cache.clear(); pending.clear(); }
function avatarCacheSize() { return { entries: cache.size, bytes: [...cache.values()].reduce((sum, item) => sum + (item.buffer?.length ?? 0), 0) }; }

module.exports = { avatarLink, loadAvatar, setAvatarFetcher, clearAvatars, avatarCacheSize };
