// i18n-ignore-file: the lines of the log are not messages of Petto.
// Autoplay: when the queue is about to run out, songs like the one that plays are added. "Like" is what Last.fm says people who listen to that song also
// listen to (its `track.getSimilar`, and the similar artists when that gives little), which follows the genre, the language and the artist without Spotify.
// It needs the Last.fm key of the bot (`LASTFM_API_KEY`).
const config = require('../config');
const match = require('./match');
const logger = require('../utils/logger');

const API = 'https://ws.audioscrobbler.com/2.0/';
const TIMEOUT_MS = 6000;

const available = () => Boolean(config.lastfmApiKey);

/** The first artist of an author as YouTube writes it: "Radiohead - Topic", "ArtistVEVO", "A, B & C" -> "Radiohead", "Artist", "A". */
function cleanArtist(item) {
  const raw = String(item?.meta?.artist ?? item?.author ?? '');
  return raw.split(/,|&| feat\.? | ft\.? | x /i)[0].replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').replace(/\s+official$/i, '').trim();
}

/** The title without what is in brackets and without "Artist - " in front: "Radiohead - Creep (Official Video)" -> "Creep". */
function cleanTitle(item, artist) {
  const title = String(item?.meta?.title ?? item?.title ?? '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = title.split(/\s[-–—]\s/);
  if (parts.length < 2) return title;
  return artist && match.normalize(parts[0]).includes(match.normalize(artist)) ? parts.slice(1).join(' - ').trim() : parts[0].trim(); // "Artist - Song", or "Song - Remastered"
}

async function call(params, fetchImpl) {
  try {
    const url = `${API}?${new URLSearchParams({ ...params, api_key: config.lastfmApiKey, format: 'json', autocorrect: '1' })}`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.error ? null : body;
  } catch (error) {
    logger.warn(`Music: Last.fm did not answer for the autoplay: ${error?.message ?? error}`);
    return null;
  }
}

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

/**
 * Songs like `item`, best first: `[{ title, artist, lengthMs: 0 }]` (empty when Last.fm has nothing or no key). `fetchImpl` is only for the checks.
 */
async function similarTo(item, { limit = 12, fetchImpl = fetch } = {}) {
  if (!available()) return [];
  const artist = cleanArtist(item);
  const title = cleanTitle(item, artist);
  if (!artist || !title) return [];

  const songs = [];
  const seen = new Set();
  const add = (name, by) => {
    const key = `${match.normalize(by)}|${match.normalize(name)}`;
    if (!name || !by || seen.has(key)) return;
    seen.add(key);
    songs.push({ title: String(name), artist: String(by), lengthMs: 0 });
  };

  const similar = await call({ method: 'track.getsimilar', artist, track: title, limit: String(limit) }, fetchImpl);
  for (const track of asArray(similar?.similartracks?.track)) add(track?.name, track?.artist?.name);

  if (songs.length < 3) {
    // little to go on: the top songs of similar artists
    const artists = await call({ method: 'artist.getsimilar', artist, limit: '4' }, fetchImpl);
    for (const other of asArray(artists?.similarartists?.artist).slice(0, 3)) {
      const top = await call({ method: 'artist.gettoptracks', artist: other?.name, limit: '2' }, fetchImpl);
      for (const track of asArray(top?.toptracks?.track)) add(track?.name, other?.name);
    }
  }
  return songs.slice(0, limit);
}

module.exports = { available, similarTo, cleanArtist, cleanTitle };
