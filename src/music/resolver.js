// i18n-ignore-file: the identifiers sent to Lavalink (ytmsearch:, scsearch:...) and lines of the log are not messages of Petto.
// From what a person typed (a link or a name) to the songs to queue. A name is searched on YouTube Music and SoundCloud and the results are judged by
// `match.js`; a Spotify link only gives the name, artist, length and ISRC of its songs (Lavalink reads them with LavaSrc), and the recording is chosen
// when the song is about to play, so a playlist of 300 songs does not make 300 searches at once.
const match = require('./match');
const spotify = require('./spotify');
const logger = require('../utils/logger');

const MAX_ADDED = 200; // songs one command can add (a playlist is cut there)
const CACHE_LIMIT = 500;
const CACHE_MS = 6 * 3_600_000;
const chosen = new Map(); // key of a song -> { until, list: [encoded...] }
const YOUTUBE_DOWN_MS = 10 * 60_000;
let youtubeDownUntil = 0;

/** YouTube asked for a login or blocked the node: for a while the recordings of other services are tried first. */
const markYoutubeDown = () => { youtubeDownUntil = Date.now() + YOUTUBE_DOWN_MS; };
const youtubeDown = () => Date.now() < youtubeDownUntil;
const arrange = (tracks) => match.diversify(tracks, { preferNot: youtubeDown() ? 'youtube' : null });

const thumbnailOf = (info) => info.artworkUrl || (String(info.sourceName).toLowerCase() === 'youtube' && info.identifier ? `https://i.ytimg.com/vi/${info.identifier}/hqdefault.jpg` : null);

/** The thing the queue keeps for a track that is ready to play. */
function itemFromTrack(track, requestedBy) {
  const info = track.info ?? {};
  return {
    encoded: track.encoded, title: info.title ?? '', author: info.author ?? '', lengthMs: Number(info.length) || 0, uri: info.uri ?? null,
    artwork: thumbnailOf(info), isrc: info.isrc ?? null, source: String(info.sourceName ?? '').toLowerCase(), requestedBy, lazy: false, candidates: null,
  };
}

/** The thing the queue keeps for a song whose recording is chosen later (a Spotify track): `meta` is what Spotify says of it. */
function lazyItem(track, requestedBy) {
  const item = itemFromTrack(track, requestedBy);
  return { ...item, encoded: null, fallback: track.encoded, lazy: true, meta: { title: item.title, artist: item.author, lengthMs: item.lengthMs, isrc: item.isrc } };
}

/** A song read from the embed page of Spotify (no Lavalink track): its recording is chosen when it is about to play, like the lazy ones. */
function scrapedItem(song, cover, requestedBy) {
  return {
    encoded: null, fallback: null, title: song.title, author: song.artist, lengthMs: song.lengthMs, uri: song.uri ? `https://open.spotify.com/track/${String(song.uri).split(':').pop()}` : null,
    artwork: cover, isrc: null, source: 'spotify', requestedBy, lazy: true, candidates: null,
    meta: { title: song.title, artist: song.artist, lengthMs: song.lengthMs, isrc: null },
  };
}

/** What to queue for a Spotify link when Lavalink could not read it (no keys): its embed page. Returns the same shape as `resolveInput`, or null. */
async function resolveSpotifyPage(kind, requestedBy, limit) {
  const page = await spotify.read(kind.what, kind.id);
  if (!page) return null;
  const items = page.tracks.slice(0, limit).map((song) => scrapedItem(song, page.cover, requestedBy));
  if (kind.what === 'track') return { type: 'track', items: items.slice(0, 1) };
  return { type: 'playlist', name: page.name, items, cut: Math.max(0, page.tracks.length - limit) };
}

async function lookup(node, identifier) {
  try {
    return await node.rest.resolve(identifier);
  } catch (error) {
    logger.warn(`Music: Lavalink could not answer ${identifier.split(':')[0]}: ${error?.message ?? error}`);
    return undefined;
  }
}

async function searchPrefix(node, prefix, query) {
  const result = await lookup(node, `${prefix}:${query}`);
  return result?.loadType === 'search' ? result.data : [];
}

/** The results of the searches for a text: YouTube Music (the official recordings) and SoundCloud together; YouTube itself only when those two give nothing. */
async function searchAll(node, query) {
  const [music, cloud] = await Promise.all([searchPrefix(node, 'ytmsearch', query), searchPrefix(node, 'scsearch', query)]);
  let tracks = [...music, ...cloud];
  if (!tracks.length) tracks = await searchPrefix(node, 'ytsearch', query);
  return tracks;
}

/** A text to search: the best recording first, and the rest as alternatives. */
async function searchText(node, query, requestedBy) {
  const tracks = await searchAll(node, query);
  if (!tracks.length) return { type: 'none', items: [] };
  const { list: ordered } = match.order(tracks, { query });
  const list = arrange(ordered);
  if (!list.length) return { type: 'none', items: [] };
  const [best, ...rest] = list;
  const item = itemFromTrack(best, requestedBy);
  item.candidates = [best.encoded, ...rest.map((track) => track.encoded)].slice(0, 4);
  return { type: 'track', items: [item], alternatives: rest.slice(0, 4).map((track) => itemFromTrack(track, requestedBy)) };
}

/**
 * What to queue for what a person wrote.
 * Returns `{ type: 'track' | 'playlist' | 'none' | 'error' | 'unsupported', items, name?, alternatives?, error? }`.
 */
async function resolveInput(node, input, { requestedBy = null, limit = MAX_ADDED } = {}) {
  const kind = match.kindOfInput(input);
  if (kind.kind === 'text') return kind.query ? searchText(node, kind.query, requestedBy) : { type: 'none', items: [] };
  if (kind.kind === 'other') return { type: 'unsupported', items: [] };

  const result = await lookup(node, kind.url);
  if (kind.kind === 'spotify' && !['track', 'playlist', 'search'].includes(result?.loadType)) {
    const page = await resolveSpotifyPage(kind, requestedBy, limit); // Lavalink has no Spotify keys (or Spotify refused them): the public page of the link
    if (page) return page;
  }
  if (!result) return { type: 'error', items: [], error: 'unavailable' };
  const make = kind.kind === 'spotify' ? lazyItem : itemFromTrack;
  switch (result.loadType) {
    case 'track': return { type: 'track', items: [make(result.data, requestedBy)] };
    case 'playlist': {
      const tracks = result.data.tracks ?? [];
      return { type: 'playlist', name: result.data.info?.name ?? '', items: tracks.slice(0, limit).map((track) => make(track, requestedBy)), cut: Math.max(0, tracks.length - limit) };
    }
    case 'search': {
      const [first] = result.data ?? [];
      return first ? { type: 'track', items: [make(first, requestedBy)] } : { type: 'none', items: [] };
    }
    case 'error': return { type: 'error', items: [], error: result.data?.message ?? 'unavailable' };
    default: return { type: 'none', items: [] };
  }
}

const keyOf = (meta) => `${String(meta.isrc ?? '').toUpperCase() || match.normalize(`${meta.artist} ${meta.title}`)}:${Math.round((meta.lengthMs || 0) / 1000)}`;

/**
 * The recordings to try for a song of Spotify, best first (`[encoded, ...]`), or `[]` when there is nothing to play. Kept for 6 hours.
 * The track of LavaSrc itself (`item.fallback`) goes last: it is the node's own mirror and is only used when everything else failed.
 */
async function recordingsFor(node, item) {
  if (item.encoded && !item.lazy) return [item.encoded, ...(item.candidates ?? []).filter((encoded) => encoded !== item.encoded)];
  const meta = item.meta;
  const key = keyOf(meta);
  const hit = chosen.get(key);
  if (hit && hit.until > Date.now()) return [...hit.list, ...(item.fallback ? [item.fallback] : [])];

  const first = String(meta.artist ?? '').split(/,|&/)[0].trim();
  const tracks = await searchAll(node, `${first} ${meta.title}`.trim());
  const { list: ordered } = match.order(tracks, { title: meta.title, artist: meta.artist, lengthMs: meta.lengthMs, isrc: meta.isrc, query: `${first} ${meta.title}` });
  const best = arrange(ordered).slice(0, 4);
  const encoded = best.map((track) => track.encoded);
  if (!item.artwork && best[0]) item.artwork = thumbnailOf(best[0].info ?? {}); // a song read from a page has no cover of its own: the one of the recording
  if (encoded.length) {
    if (chosen.size >= CACHE_LIMIT) chosen.delete(chosen.keys().next().value);
    chosen.set(key, { until: Date.now() + CACHE_MS, list: encoded });
  }
  return [...encoded, ...(item.fallback ? [item.fallback] : [])];
}

const forgetChosen = () => { chosen.clear(); youtubeDownUntil = 0; }; // for the checks

module.exports = { MAX_ADDED, itemFromTrack, lazyItem, scrapedItem, searchAll, searchText, resolveInput, recordingsFor, markYoutubeDown, youtubeDown, forgetChosen };
