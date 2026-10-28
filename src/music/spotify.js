// i18n-ignore-file: the lines of the log are not messages of Petto.
// A Spotify link read WITHOUT the Spotify keys. Lavalink (LavaSrc) needs keys to read a song, an album or a playlist; when it cannot (no keys, or Spotify
// refuses them), the public embed page of the same link (the one Spotify gives to websites) holds the title, the artists and the length of its songs, which is
// all the bot needs: the recording is searched later, from those. The embed page shows the first 50 to 100 songs of a playlist.
const logger = require('../utils/logger');

const EMBED = 'https://open.spotify.com/embed';
const TIMEOUT_MS = 10_000;
const KINDS = new Set(['track', 'album', 'playlist', 'artist']);

/** The data of the page: `props.pageProps.state.data.entity`, or null when Spotify changed the page. */
function entityOf(html) {
  const match = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(String(html ?? ''));
  if (!match) return null;
  try {
    return JSON.parse(match[1])?.props?.pageProps?.state?.data?.entity ?? null;
  } catch {
    return null;
  }
}

const artistsOf = (entity) => (Array.isArray(entity.artists) ? entity.artists.map((artist) => artist?.name).filter(Boolean).join(', ') : '') || String(entity.subtitle ?? '');

/**
 * The songs of a page: `{ name, cover, tracks: [{ title, artist, lengthMs, uri }] }`, or null when there is nothing in it.
 * @param {object} entity the entity of the embed page
 */
function songsOf(entity) {
  if (!entity) return null;
  const cover = entity.coverArt?.sources?.[0]?.url ?? null;
  const list = Array.isArray(entity.trackList) ? entity.trackList : null;
  const rows = list ?? (entity.type === 'track' ? [{ title: entity.title ?? entity.name, subtitle: artistsOf(entity), duration: entity.duration, uri: entity.uri }] : []);
  const tracks = rows
    .filter((row) => row?.title) // `isPlayable` is about Spotify itself: the recording is searched somewhere else
    .map((row) => ({ title: String(row.title), artist: String(row.subtitle ?? '').replace(/ /g, ' '), lengthMs: Number(row.duration) || 0, uri: row.uri ?? null }));
  if (!tracks.length) return null;
  return { name: String(entity.name ?? entity.title ?? ''), cover, tracks };
}

/**
 * Reads the embed page of a Spotify link. `kind`: track, album, playlist or artist. Returns null when it cannot (never throws).
 * `fetchImpl` is only for the checks.
 */
async function read(kind, id, { fetchImpl = fetch } = {}) {
  if (!KINDS.has(kind) || !/^[A-Za-z0-9]+$/.test(String(id ?? ''))) return null;
  try {
    const response = await fetchImpl(`${EMBED}/${kind}/${id}`, { headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'en' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) { logger.warn(`Music: the Spotify page answered ${response.status}`); return null; }
    const found = songsOf(entityOf(await response.text()));
    if (!found) logger.warn('Music: the Spotify page has no songs (did it change?)');
    return found;
  } catch (error) {
    logger.warn(`Music: the Spotify page could not be read: ${error?.message ?? error}`);
    return null;
  }
}

module.exports = { read, entityOf, songsOf };
