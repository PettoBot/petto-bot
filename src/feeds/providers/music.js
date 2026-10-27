// The music platforms: new releases of an artist on Deezer, Apple Music and Spotify, and the episodes of a podcast on Spotify. Deezer and Apple Music need
// no key; Spotify uses the app of the bot (SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET, client credentials: only the public catalog).
const config = require('../../config');
const { fetchJsonBody } = require('../http');
const { IntegrationError } = require('../../utils/integrations');

const clean = (text, max = 120) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const https = (value) => (/^https:\/\//i.test(String(value ?? '')) ? String(value) : null);
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k` : String(n));
/** A release date as the services write it (`2026-10-23`, `2026-10`, `2026`) in ms, at the start of that day (UTC). */
const dateMs = (value) => { const text = String(value ?? ''); const full = /^\d{4}$/.test(text) ? `${text}-01-01` : /^\d{4}-\d{2}$/.test(text) ? `${text}-01` : text; return Date.parse(full) || null; };

// --- Deezer -----------------------------------------------------------------------------------------------------------------------------------------
const DEEZER = 'https://api.deezer.com';

/** The id of an artist from a number, a link (`deezer.com/en/artist/27`) or null when it is a name. */
function parseDeezerArtist(input) {
  const text = String(input ?? '').trim();
  const link = /deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?artist\/(\d{1,12})/i.exec(text);
  if (link) return link[1];
  return /^\d{1,12}$/.test(text) ? text : null;
}

const deezerArtist = (artist) => ({ id: String(artist.id), name: clean(artist.name, 80), avatar: https(artist.picture_xl || artist.picture_big || artist.picture_medium), url: String(artist.link ?? `https://www.deezer.com/artist/${artist.id}`), fans: artist.nb_fan });

async function deezerGet(path) {
  const body = await fetchJsonBody(`${DEEZER}${path}`);
  if (body?.error) throw new IntegrationError(body.error.code === 800 ? 'notFound' : 'unavailable'); // 800: no data for that id
  return body;
}

async function deezerSearch(query) {
  const body = await deezerGet(`/search/artist?q=${encodeURIComponent(query)}&limit=8`);
  return (body?.data ?? []).map((artist) => ({ value: String(artist.id), name: clean(artist.name, 80), avatar: https(artist.picture_medium || artist.picture_big), url: artist.link, detail: Number.isFinite(artist.nb_fan) ? `${compact(artist.nb_fan)} fans` : '' })); // i18n-ignore: a count beside an artist
}

async function deezerResolve(input) {
  let id = parseDeezerArtist(input);
  if (!id) {
    const text = clean(input, 100);
    if (!text) throw new IntegrationError('badInput');
    id = (await deezerGet(`/search/artist?q=${encodeURIComponent(text)}&limit=1`))?.data?.[0]?.id;
    if (!id) throw new IntegrationError('notFound');
  }
  return deezerArtist(await deezerGet(`/artist/${id}`));
}

/** The newest releases of an artist (albums, singles, EPs), newest first. A release dated in the future (pre-saves) waits for its day. */
async function deezerReleases(account, now = Date.now()) {
  const body = await deezerGet(`/artist/${account.id}/albums?limit=25`);
  return (body?.data ?? []).map((album) => ({ album, at: dateMs(album.release_date) })).filter((entry) => entry.at && entry.at <= now + 12 * 3_600_000)
    .sort((a, b) => b.at - a.at).slice(0, 8).map(({ album, at }) => ({
      platform: 'deezer', type: 'release', id: String(album.id), title: clean(album.title, 200), url: String(album.link ?? `https://www.deezer.com/album/${album.id}`), description: '',
      image: https(album.cover_xl || album.cover_big), avatar: account.avatar ?? null, author: account.name, authorUrl: account.url, publishedAt: at, extra: clean(album.record_type, 20).toUpperCase(),
    }));
}

// --- Apple Music (the free search and lookup of iTunes) ------------------------------------------------------------------------------------------------
const ITUNES = 'https://itunes.apple.com';

/** The id of an artist from a number or a link (`music.apple.com/us/artist/name/123`), or null. */
function parseAppleArtist(input) {
  const text = String(input ?? '').trim();
  const link = /music\.apple\.com\/[a-z]{2}\/artist\/(?:[^/?#]+\/)?(\d{3,12})/i.exec(text) ?? /itunes\.apple\.com\/[a-z]{2}\/artist\/(?:[^/?#]+\/)?(?:id)?(\d{3,12})/i.exec(text);
  if (link) return link[1];
  return /^\d{3,12}$/.test(text) ? text : null;
}

async function appleSearch(query) {
  const body = await fetchJsonBody(`${ITUNES}/search?term=${encodeURIComponent(query)}&entity=musicArtist&limit=8`);
  return (body?.results ?? []).filter((artist) => artist.artistId).map((artist) => ({ value: String(artist.artistId), name: clean(artist.artistName, 80), avatar: null, url: artist.artistLinkUrl ?? null, detail: clean(artist.primaryGenreName, 40) }));
}

/** The albums of an artist: `{ artist, albums }` (the picture of an artist is the cover of its newest album: Apple has no other). */
async function appleLookup(id, limit = 12) {
  const body = await fetchJsonBody(`${ITUNES}/lookup?id=${encodeURIComponent(id)}&entity=album&sort=recent&limit=${limit}`);
  const results = body?.results ?? [];
  const artist = results.find((entry) => entry.wrapperType === 'artist');
  if (!artist) throw new IntegrationError('notFound');
  return { artist, albums: results.filter((entry) => entry.wrapperType === 'collection') };
}

const appleCover = (url) => https(String(url ?? '').replace(/\/\d+x\d+(bb)?\.(jpg|png)/, '/600x600bb.$2'));

async function appleResolve(input) {
  let id = parseAppleArtist(input);
  if (!id) {
    const text = clean(input, 100);
    if (!text) throw new IntegrationError('badInput');
    id = (await appleSearch(text))[0]?.value;
    if (!id) throw new IntegrationError('notFound');
  }
  const { artist, albums } = await appleLookup(id, 1);
  return { id: String(artist.artistId), name: clean(artist.artistName, 80), avatar: appleCover(albums[0]?.artworkUrl100), url: artist.artistLinkUrl ?? `https://music.apple.com/artist/${artist.artistId}` };
}

async function appleReleases(account) {
  const { albums } = await appleLookup(account.id);
  return albums.map((album) => ({
    platform: 'applemusic', type: 'release', id: String(album.collectionId), title: clean(album.collectionName, 200), url: String(album.collectionViewUrl ?? account.url), description: '',
    image: appleCover(album.artworkUrl100), avatar: account.avatar ?? null, author: account.name, authorUrl: account.url, publishedAt: Date.parse(album.releaseDate) || null,
    extra: Number.isFinite(album.trackCount) ? `${album.trackCount} ${album.trackCount === 1 ? 'track' : 'tracks'}` : '', // i18n-ignore: a count beside a release
  })).filter((item) => item.publishedAt).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 8);
}

// --- Spotify ------------------------------------------------------------------------------------------------------------------------------------------
const SPOTIFY = 'https://api.spotify.com/v1';
let spotifyToken = null;
let spotifyPending = null;

async function spotifyAppToken(force = false) {
  if (!config.spotifyClientId || !config.spotifyClientSecret) throw new IntegrationError('notConfigured');
  if (!force && spotifyToken && spotifyToken.until > Date.now()) return spotifyToken.value;
  spotifyPending ??= fetchJsonBody('https://accounts.spotify.com/api/token', {
    method: 'POST', body: 'grant_type=client_credentials',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString('base64')}` },
  }).then((body) => {
    if (!body?.access_token) throw new IntegrationError('unavailable');
    spotifyToken = { value: body.access_token, until: Date.now() + Math.max(60, (Number(body.expires_in) || 3600) - 60) * 1000 };
    return spotifyToken.value;
  }).finally(() => { spotifyPending = null; });
  return spotifyPending;
}

async function spotifyApi(path) {
  const ask = async () => fetchJsonBody(`${SPOTIFY}${path}`, { headers: { Authorization: `Bearer ${await spotifyAppToken()}` } });
  try {
    return await ask();
  } catch (error) {
    if (String(error.message).includes('401')) { await spotifyAppToken(true); return ask(); } // the token ran out early
    throw error;
  }
}

/** `artist:ID` or `show:ID` (a podcast) from a link (`open.spotify.com/artist/ID`), a URI (`spotify:show:ID`) or an id written as that; null for a name. */
function parseSpotify(input) {
  const text = String(input ?? '').trim();
  const link = /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(artist|show)\/([A-Za-z0-9]{22})/i.exec(text) ?? /^spotify:(artist|show):([A-Za-z0-9]{22})$/i.exec(text) ?? /^(artist|show):([A-Za-z0-9]{22})$/i.exec(text);
  return link ? `${link[1].toLowerCase()}:${link[2]}` : null;
}

const spotifyPicture = (images) => https((images ?? [])[0]?.url);

async function spotifySearch(query) {
  const body = await spotifyApi(`/search?q=${encodeURIComponent(query)}&type=artist,show&limit=5&market=US`);
  const artists = (body?.artists?.items ?? []).filter(Boolean).map((artist) => ({ value: `artist:${artist.id}`, name: clean(artist.name, 80), avatar: spotifyPicture(artist.images), url: artist.external_urls?.spotify ?? null, detail: ['Artist', Number.isFinite(artist.followers?.total) ? `${compact(artist.followers.total)} followers` : null].filter(Boolean).join(' · ') })); // i18n-ignore: labels of a search result
  const shows = (body?.shows?.items ?? []).filter(Boolean).map((show) => ({ value: `show:${show.id}`, name: clean(show.name, 80), avatar: spotifyPicture(show.images), url: show.external_urls?.spotify ?? null, detail: ['Podcast', clean(show.publisher, 40)].filter(Boolean).join(' · ') })); // i18n-ignore: labels of a search result
  return [...artists, ...shows].slice(0, 8);
}

async function spotifyResolve(input) {
  let id = parseSpotify(input);
  if (!id) {
    const text = clean(input, 100);
    if (!text) throw new IntegrationError('badInput');
    id = (await spotifySearch(text))[0]?.value;
    if (!id) throw new IntegrationError('notFound');
  }
  const [kind, raw] = id.split(':');
  let body;
  try { body = await spotifyApi(`/${kind}s/${raw}${kind === 'show' ? '?market=US' : ''}`); } catch (error) { if (String(error.message).includes('404') || error.kind === 'notFound') throw new IntegrationError('notFound'); throw error; }
  return { id, name: clean(body.name, 80), avatar: spotifyPicture(body.images), url: body.external_urls?.spotify ?? `https://open.spotify.com/${kind}/${raw}` };
}

/** The newest releases of an artist, or the newest episodes of a podcast, newest first. */
async function spotifyReleases(account) {
  const [kind, raw] = account.id.split(':');
  if (kind === 'show') {
    const body = await spotifyApi(`/shows/${raw}/episodes?limit=8&market=US`);
    return (body?.items ?? []).filter(Boolean).map((episode) => ({
      platform: 'spotify', type: 'episode', id: episode.id, title: clean(episode.name, 200), url: episode.external_urls?.spotify ?? account.url, description: clean(episode.description, 300),
      image: spotifyPicture(episode.images), avatar: account.avatar ?? null, author: account.name, authorUrl: account.url, publishedAt: dateMs(episode.release_date), extra: Number.isFinite(episode.duration_ms) ? `${Math.max(1, Math.round(episode.duration_ms / 60_000))} min` : '', // i18n-ignore: a length beside an episode
    })).filter((item) => item.publishedAt);
  }
  const body = await spotifyApi(`/artists/${raw}/albums?include_groups=album,single&limit=10&market=US`);
  return (body?.items ?? []).filter(Boolean).map((album) => ({
    platform: 'spotify', type: 'release', id: album.id, title: clean(album.name, 200), url: album.external_urls?.spotify ?? account.url, description: '',
    image: spotifyPicture(album.images), avatar: account.avatar ?? null, author: account.name, authorUrl: account.url, publishedAt: dateMs(album.release_date),
    extra: [clean(album.album_type, 20).toUpperCase(), Number.isFinite(album.total_tracks) ? `${album.total_tracks} ${album.total_tracks === 1 ? 'track' : 'tracks'}` : null].filter(Boolean).join(' · '), // i18n-ignore: labels beside a release
  })).filter((item) => item.publishedAt).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 8);
}

module.exports = {
  parseDeezerArtist, deezerSearch, deezerResolve, deezerReleases,
  parseAppleArtist, appleSearch, appleResolve, appleReleases,
  parseSpotify, spotifySearch, spotifyResolve, spotifyReleases,
};
