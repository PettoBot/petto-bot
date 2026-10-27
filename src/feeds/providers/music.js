// The music platforms: new releases of an artist on Deezer, Apple Music and Spotify, the episodes of a podcast on Spotify, and more than one artist: the new songs
// of a playlist (Deezer and Spotify), the charts (Deezer by genre, Apple Music by country) and the new albums of a country (Spotify). The link of a song or an album
// follows its artist. Deezer and Apple Music need no key; Spotify uses the app of the bot (SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET, client credentials: only
// the public catalog).
const config = require('../../config');
const { fetchJsonBody } = require('../http');
const { IntegrationError } = require('../../utils/integrations');
const { t } = require('../../i18n');

const L = (lang, key, vars) => t(lang, `feeds.list.${key}`, vars);

const clean = (text, max = 120) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const https = (value) => (/^https:\/\//i.test(String(value ?? '')) ? String(value) : null);
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k` : String(n));
/** A release date as the services write it (`2026-10-23`, `2026-10`, `2026`) in ms, at the start of that day (UTC). */
const dateMs = (value) => { const text = String(value ?? ''); const full = /^\d{4}$/.test(text) ? `${text}-01-01` : /^\d{4}-\d{2}$/.test(text) ? `${text}-01` : text; return Date.parse(full) || null; };

/** What a person typed when they want a chart: `top`, `charts`, `top rock`, `top colombia`; the rest of the words ("rock", "colombia") or ''. null when it is not a chart. */
const chartWords = (text) => { const match = /^(?:top|tops|chart|charts|ranking|hits|exitos|éxitos|sucessos|parada|paradas|populares)(?:\s+(.*))?$/i.exec(String(text ?? '').trim()); return match ? String(match[1] ?? '').trim() : null; };
/** What a person typed when they want the new albums of a country: `new`, `new colombia`, `nuevos`, `lanzamientos`; the rest of the words or ''. null otherwise. */
const newWords = (text) => { const match = /^(?:new|news|nuevo|nuevos|novo|novos|novedades|novidades|lanzamientos|lançamentos|releases|new releases)(?:\s+(.*))?$/i.exec(String(text ?? '').trim()); return match ? String(match[1] ?? '').trim() : null; };

// The storefronts that have charts and new releases, by two letters; a person can write the name of the country in English or Spanish, or its two letters.
const COUNTRIES = ['us', 'co', 'mx', 'es', 'ar', 'cl', 'pe', 've', 'ec', 'uy', 'py', 'bo', 'cr', 'pa', 'do', 'gt', 'hn', 'sv', 'ni', 'pr', 'br', 'pt', 'gb', 'ie', 'fr', 'de', 'it', 'nl', 'be', 'ch', 'at', 'se', 'no', 'dk', 'fi', 'pl', 'tr', 'gr', 'ca', 'au', 'nz', 'jp', 'kr', 'in', 'id', 'ph', 'th', 'za', 'ng', 'eg', 'ae', 'sa'];
let countryNames = null;
/** The two letters of the country a person wrote (`colombia`, `Colombia`, `co`, `United States`), or null. */
function countryOf(text) {
  const value = String(text ?? '').trim().toLowerCase();
  if (!value) return null;
  if (value.length === 2) return COUNTRIES.includes(value) ? value : null;
  if (!countryNames) {
    countryNames = new Map();
    for (const locale of ['en', 'es']) {
      const names = new Intl.DisplayNames([locale], { type: 'region' });
      for (const code of COUNTRIES) countryNames.set(names.of(code.toUpperCase()).toLowerCase(), code);
    }
    countryNames.set('usa', 'us'); countryNames.set('uk', 'gb'); countryNames.set('eeuu', 'us'); countryNames.set('ee.uu.', 'us'); countryNames.set('estados unidos', 'us'); // i18n-ignore: names of countries a person may write
  }
  return countryNames.get(value) ?? null;
}
const COUNTRY_LABEL = (code, lang = 'en') => { try { return new Intl.DisplayNames([String(lang).slice(0, 2) || 'en'], { type: 'region' }).of(code.toUpperCase()); } catch { return code.toUpperCase(); } };

// --- Deezer -----------------------------------------------------------------------------------------------------------------------------------------
const DEEZER = 'https://api.deezer.com';

/** `{ kind, id }` of a link to an artist, an album, a song or a playlist of Deezer (`deezer.com/en/playlist/123`), or null. */
function parseDeezerLink(input) {
  const link = /deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(artist|album|track|playlist)\/(\d{1,14})/i.exec(String(input ?? ''));
  return link ? { kind: link[1].toLowerCase(), id: link[2] } : null;
}

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

async function deezerSearch(query, lang) {
  const chartText = chartWords(query);
  if (chartText !== null) {
    const wanted = chartText.toLowerCase();
    const genres = wanted ? (await deezerGenres()).filter((genre) => genre.name.toLowerCase().includes(wanted)).slice(0, 4) : [{ id: '0', name: 'All genres', picture: null }]; // i18n-ignore: the name of a chart
    const accounts = await Promise.all(genres.flatMap((genre) => [deezerChartAccount(genre.id, 'tracks', lang), deezerChartAccount(genre.id, 'albums', lang)]));
    return accounts.map((account) => ({ value: account.id, name: account.name, avatar: account.avatar, url: account.url, detail: L(lang, account.id.endsWith(':albums') ? 'detail.chartAlbums' : 'detail.chartSongs') }));
  }
  const [artists, playlists] = await Promise.all([deezerGet(`/search/artist?q=${encodeURIComponent(query)}&limit=6`), deezerGet(`/search/playlist?q=${encodeURIComponent(query)}&limit=4`).catch(() => ({ data: [] }))]);
  const people = (artists?.data ?? []).map((artist) => ({ value: String(artist.id), name: clean(artist.name, 80), avatar: https(artist.picture_medium || artist.picture_big), url: artist.link, detail: Number.isFinite(artist.nb_fan) ? L(lang, 'detail.fans', { count: compact(artist.nb_fan) }) : '' }));
  const lists = (playlists?.data ?? []).filter((playlist) => playlist.public !== false).map((playlist) => ({ value: `playlist:${playlist.id}`, name: clean(playlist.title, 80), avatar: https(playlist.picture_medium || playlist.picture_big), url: playlist.link, detail: [L(lang, 'detail.playlist'), Number.isFinite(playlist.nb_tracks) ? L(lang, 'detail.playlistSongs', { count: playlist.nb_tracks }) : null].filter(Boolean).join(' · ') }));
  return [...people, ...lists];
}

const deezerPlaylist = (playlist) => ({ id: `playlist:${playlist.id}`, name: clean(playlist.title, 80), avatar: https(playlist.picture_xl || playlist.picture_big || playlist.picture_medium), url: String(playlist.link ?? `https://www.deezer.com/playlist/${playlist.id}`) });

let genreList = null;
/** The genres of Deezer (cached a day): `[{ id, name, picture }]`, without "All". */
async function deezerGenres() {
  if (genreList && genreList.until > Date.now()) return genreList.list;
  const body = await deezerGet('/genre');
  const list = (body?.data ?? []).filter((genre) => genre.id > 0).map((genre) => ({ id: String(genre.id), name: clean(genre.name, 40), picture: https(genre.picture_xl || genre.picture_big || genre.picture_medium) }));
  genreList = { until: Date.now() + 24 * 3_600_000, list };
  return list;
}

/** The chart account of a genre (`0` is all of them): the 10 songs or albums on top; a new one entering the top is what gets posted. */
async function deezerChartAccount(genreId, kind, lang) {
  const genre = genreId === '0' ? { id: '0', name: L(lang, 'allGenres'), picture: null } : (await deezerGenres()).find((entry) => entry.id === String(genreId)); // i18n-ignore: the name of a chart
  if (!genre) throw new IntegrationError('notFound');
  return { id: `chart:${genre.id}:${kind}`, name: L(lang, kind === 'albums' ? 'chartAlbums' : 'chartSongs', { name: genre.name }), avatar: genre.picture, url: 'https://www.deezer.com/' };
}

async function deezerResolve(input, lang) {
  const text = String(input ?? '').trim();
  const chart = /^chart:(\d{1,4}):(tracks|albums)$/.exec(text);
  if (chart) return deezerChartAccount(chart[1], chart[2], lang);
  const playlistId = /^playlist:(\d{1,14})$/.exec(text)?.[1];
  const link = parseDeezerLink(text);
  if (playlistId || link?.kind === 'playlist') {
    const playlist = await deezerGet(`/playlist/${playlistId ?? link.id}`);
    if (playlist.public === false) throw new IntegrationError('notFound');
    return deezerPlaylist(playlist);
  }
  // The link of a song or an album follows its artist.
  if (link?.kind === 'album' || link?.kind === 'track') {
    const found = await deezerGet(`/${link.kind}/${link.id}`);
    const artistId = found?.artist?.id;
    if (!artistId) throw new IntegrationError('notFound');
    return deezerArtist(await deezerGet(`/artist/${artistId}`));
  }
  let id = parseDeezerArtist(text);
  if (!id) {
    const name = clean(text, 100);
    if (!name) throw new IntegrationError('badInput');
    id = (await deezerGet(`/search/artist?q=${encodeURIComponent(name)}&limit=1`))?.data?.[0]?.id;
    if (!id) throw new IntegrationError('notFound');
  }
  return deezerArtist(await deezerGet(`/artist/${id}`));
}

const deezerTrackItem = (track, account, { extra = '', at = null } = {}) => {
  const album = track.album ?? {};
  return {
    platform: 'deezer', type: 'release', id: String(track.id), title: clean(track.title_short || track.title, 200), url: String(track.link ?? `https://www.deezer.com/track/${track.id}`), description: '',
    image: https(album.cover_xl || album.cover_big || album.cover_medium), avatar: account.avatar ?? null, author: clean(track.artist?.name, 120), authorUrl: track.artist?.link ?? null, publishedAt: at, extra,
  };
};

/** The songs added to a playlist, newest first (a playlist lists them from the oldest, so the end of the list is read). */
async function deezerPlaylistTracks(account) {
  const id = account.id.slice('playlist:'.length);
  const total = Number((await deezerGet(`/playlist/${id}/tracks?limit=1`))?.total) || 0;
  const body = await deezerGet(`/playlist/${id}/tracks?index=${Math.max(0, total - 30)}&limit=30`);
  return (body?.data ?? []).filter((track) => track.time_add).sort((a, b) => b.time_add - a.time_add).slice(0, 10)
    .map((track) => deezerTrackItem(track, account, { extra: account.name, at: track.time_add * 1000 }));
}

/** The 10 on top of a chart; the ones that were not there before are the news (the engine remembers what it posted). */
async function deezerChart(account, now) {
  const [, genre, kind] = account.id.split(':');
  const body = await deezerGet(`/chart/${genre}/${kind}?limit=10`);
  return (body?.data ?? []).map((entry, index) => {
    const extra = `TOP ${entry.position ?? index + 1}`;
    if (kind === 'albums') {
      return { platform: 'deezer', type: 'release', id: String(entry.id), title: clean(entry.title, 200), url: String(entry.link ?? `https://www.deezer.com/album/${entry.id}`), description: '', image: https(entry.cover_xl || entry.cover_big), avatar: account.avatar ?? null, author: clean(entry.artist?.name, 120), authorUrl: entry.artist?.link ?? null, publishedAt: now, extra };
    }
    return deezerTrackItem(entry, account, { extra, at: now });
  });
}

const randomSongs = new Map(); // `${minutes}:${slot}` -> item | null
/** A song picked at random from the charts of a random genre of Deezer, the same for everybody in a slot of time (`30:123456`); null when Deezer has none. */
async function deezerRandomSong(key, at) {
  if (randomSongs.has(key)) return randomSongs.get(key);
  const hash = (Math.abs(Number(String(key).split(':')[1]) || 0) * 2654435761) >>> 0;
  const genres = [{ id: '0', name: '' }, ...(await deezerGenres())];
  const genre = genres[hash % genres.length];
  const list = (await deezerGet(`/chart/${genre.id}/tracks?limit=100`))?.data ?? [];
  const track = list.length ? list[(hash >>> 8) % list.length] : null;
  const item = track ? { ...deezerTrackItem(track, { avatar: null }, { extra: genre.name, at }), type: 'track', id: key } : null;
  if (randomSongs.size > 200) randomSongs.clear();
  randomSongs.set(key, item);
  return item;
}

/** The newest releases of an artist (albums, singles, EPs), newest first. A release dated in the future (pre-saves) waits for its day. */
async function deezerReleases(account, now = Date.now()) {
  if (account.id.startsWith('playlist:')) return deezerPlaylistTracks(account);
  if (account.id.startsWith('chart:')) return deezerChart(account, now);
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

/** `{ kind: 'album' | 'song' | 'playlist', id }` of a link of Apple Music (an album, a song inside an album with `?i=`, a playlist), or null. */
function parseAppleLink(input) {
  const text = String(input ?? '');
  const playlist = /music\.apple\.com\/[a-z]{2}\/playlist\/(?:[^/?#]+\/)?(pl\.[A-Za-z0-9]+)/i.exec(text);
  if (playlist) return { kind: 'playlist', id: playlist[1] };
  const album = /music\.apple\.com\/[a-z]{2}\/album\/(?:[^/?#]+\/)?(\d{3,14})(?:\?[^#]*?\bi=(\d{3,14}))?/i.exec(text);
  if (album) return album[2] ? { kind: 'song', id: album[2] } : { kind: 'album', id: album[1] };
  return null;
}

const APPLE_CHARTS = 'https://rss.marketingtools.apple.com/api/v2';
const appleChartAccount = (country, kind, lang) => ({ id: `chart:${country}:${kind}`, name: L(lang, kind === 'albums' ? 'chartAlbums' : 'chartSongs', { name: COUNTRY_LABEL(country, lang) }), avatar: null, url: 'https://music.apple.com/' });

async function appleSearch(query, lang) {
  const chartText = chartWords(query);
  if (chartText !== null) {
    const country = countryOf(chartText) ?? (chartText ? null : 'us');
    if (!country) return [];
    return ['songs', 'albums'].map((kind) => { const account = appleChartAccount(country, kind, lang); return { value: account.id, name: account.name, avatar: null, url: account.url, detail: L(lang, kind === 'albums' ? 'detail.chartAlbums' : 'detail.chartSongs') }; });
  }
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

async function appleResolve(input, lang) {
  const text = String(input ?? '').trim();
  const chart = /^chart:([a-z]{2}):(songs|albums)$/.exec(text);
  if (chart) { if (!COUNTRIES.includes(chart[1])) throw new IntegrationError('notFound'); return appleChartAccount(chart[1], chart[2], lang); }
  const link = parseAppleLink(text);
  if (link?.kind === 'playlist') throw new IntegrationError('unsupported'); // Apple Music only lets its own apps and developers with a paid key read a playlist
  if (link) { // the link of a song or an album follows its artist
    const body = await fetchJsonBody(`${ITUNES}/lookup?id=${encodeURIComponent(link.id)}`);
    const artistId = body?.results?.[0]?.artistId;
    if (!artistId) throw new IntegrationError('notFound');
    const { artist, albums } = await appleLookup(artistId, 1);
    return { id: String(artist.artistId), name: clean(artist.artistName, 80), avatar: appleCover(albums[0]?.artworkUrl100), url: artist.artistLinkUrl ?? `https://music.apple.com/artist/${artist.artistId}` };
  }
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

/** The 10 on top of the chart of a country; the ones that were not there before are the news (the engine remembers what it posted). */
async function appleChart(account, now) {
  const [, country, kind] = account.id.split(':');
  const body = await fetchJsonBody(`${APPLE_CHARTS}/${country}/music/most-played/10/${kind}.json`);
  return (body?.feed?.results ?? []).map((entry, index) => ({
    platform: 'applemusic', type: 'release', id: String(entry.id), title: clean(entry.name, 200), url: String(entry.url ?? account.url), description: '', image: appleCover(entry.artworkUrl100), avatar: null,
    author: clean(entry.artistName, 120), authorUrl: entry.artistUrl ?? null, publishedAt: now, extra: `TOP ${index + 1}`,
  }));
}

async function appleReleases(account, now = Date.now()) {
  if (account.id.startsWith('chart:')) return appleChart(account, now);
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

/** `kind:ID` from a link (`open.spotify.com/playlist/ID`), a URI (`spotify:album:ID`) or an id written as that. The kind is `artist`, `show` (a podcast), `playlist`, `album` or `track`; null for a name. */
function parseSpotify(input) {
  const text = String(input ?? '').trim();
  const kinds = 'artist|show|playlist|album|track';
  const link = new RegExp(`open\\.spotify\\.com/(?:intl-[a-z]{2}/)?(${kinds})/([A-Za-z0-9]{22})`, 'i').exec(text) ?? new RegExp(`^spotify:(${kinds}):([A-Za-z0-9]{22})$`, 'i').exec(text) ?? new RegExp(`^(${kinds}):([A-Za-z0-9]{22})$`, 'i').exec(text);
  return link ? `${link[1].toLowerCase()}:${link[2]}` : null;
}

const spotifyPicture = (images) => https((images ?? [])[0]?.url);

const spotifyNewAccount = (country, lang) => ({ id: `new:${country.toUpperCase()}`, name: L(lang, 'newAlbums', { country: COUNTRY_LABEL(country, lang) }), avatar: null, url: 'https://open.spotify.com/' });

async function spotifySearch(query, lang) {
  const fresh = newWords(query);
  if (fresh !== null) {
    const country = countryOf(fresh) ?? (fresh ? null : 'us');
    if (!country) return [];
    const account = spotifyNewAccount(country, lang);
    return [{ value: account.id, name: account.name, avatar: null, url: account.url, detail: L(lang, 'detail.newReleases') }];
  }
  const body = await spotifyApi(`/search?q=${encodeURIComponent(query)}&type=artist,show,playlist&limit=5&market=US`);
  const artists = (body?.artists?.items ?? []).filter(Boolean).map((artist) => ({ value: `artist:${artist.id}`, name: clean(artist.name, 80), avatar: spotifyPicture(artist.images), url: artist.external_urls?.spotify ?? null, detail: Number.isFinite(artist.followers?.total) ? L(lang, 'detail.followers', { count: compact(artist.followers.total) }) : '' }));
  const shows = (body?.shows?.items ?? []).filter(Boolean).map((show) => ({ value: `show:${show.id}`, name: clean(show.name, 80), avatar: spotifyPicture(show.images), url: show.external_urls?.spotify ?? null, detail: [L(lang, 'detail.podcast'), clean(show.publisher, 40)].filter(Boolean).join(' · ') }));
  const lists = (body?.playlists?.items ?? []).filter(Boolean).map((list) => ({ value: `playlist:${list.id}`, name: clean(list.name, 80), avatar: spotifyPicture(list.images), url: list.external_urls?.spotify ?? null, detail: [L(lang, 'detail.playlist'), clean(list.owner?.display_name, 40)].filter(Boolean).join(' · ') }));
  return [...artists, ...shows, ...lists].slice(0, 10);
}

async function spotifyResolve(input, lang) {
  const text = String(input ?? '').trim();
  const fresh = /^new:([A-Za-z]{2})$/.exec(text);
  if (fresh) { if (!COUNTRIES.includes(fresh[1].toLowerCase())) throw new IntegrationError('notFound'); return spotifyNewAccount(fresh[1], lang); }
  let id = parseSpotify(text);
  if (!id) {
    const name = clean(text, 100);
    if (!name) throw new IntegrationError('badInput');
    id = (await spotifySearch(name, lang)).find((entry) => !entry.value.startsWith('playlist:'))?.value;
    if (!id) throw new IntegrationError('notFound');
  }
  let [kind, raw] = id.split(':');
  const ask = async (path) => { try { return await spotifyApi(path); } catch (error) { if (String(error.message).includes('404') || error.kind === 'notFound') throw new IntegrationError('notFound'); throw error; } };
  if (kind === 'album' || kind === 'track') { // the link of a song or an album follows its artist
    const found = await ask(`/${kind}s/${raw}?market=US`);
    const artist = found?.artists?.[0];
    if (!artist?.id) throw new IntegrationError('notFound');
    kind = 'artist'; raw = artist.id; id = `artist:${raw}`;
  }
  const body = await ask(`/${kind === 'artist' ? 'artists' : kind === 'show' ? 'shows' : 'playlists'}/${raw}${kind === 'show' ? '?market=US' : kind === 'playlist' ? '?fields=name,images,external_urls' : ''}`);
  return { id, name: clean(body.name, 80), avatar: spotifyPicture(body.images), url: body.external_urls?.spotify ?? `https://open.spotify.com/${kind}/${raw}` };
}

const spotifyAlbumItem = (album, account, extra = '') => ({
  platform: 'spotify', type: 'release', id: album.id, title: clean(album.name, 200), url: album.external_urls?.spotify ?? account.url, description: '',
  image: spotifyPicture(album.images), avatar: account.avatar ?? null, author: clean((album.artists ?? []).map((artist) => artist.name).join(', '), 120) || account.name, authorUrl: album.artists?.[0]?.external_urls?.spotify ?? account.url, publishedAt: dateMs(album.release_date), extra,
});

/** The songs added to a playlist, newest first (a playlist lists them from the oldest, so the end of the list is read). */
async function spotifyPlaylistTracks(account, raw) {
  const fields = 'items(added_at,track(id,name,type,external_urls,artists(name,external_urls),album(images)))';
  const total = Number((await spotifyApi(`/playlists/${raw}/tracks?limit=1&fields=total`))?.total) || 0;
  const body = await spotifyApi(`/playlists/${raw}/tracks?offset=${Math.max(0, total - 30)}&limit=30&market=US&fields=${encodeURIComponent(fields)}`);
  return (body?.items ?? []).filter((entry) => entry?.track?.id && entry.track.type !== 'episode' && entry.added_at).sort((a, b) => Date.parse(b.added_at) - Date.parse(a.added_at)).slice(0, 10).map(({ track, added_at: addedAt }) => ({
    platform: 'spotify', type: 'release', id: track.id, title: clean(track.name, 200), url: track.external_urls?.spotify ?? account.url, description: '', image: spotifyPicture(track.album?.images), avatar: account.avatar ?? null,
    author: clean((track.artists ?? []).map((artist) => artist.name).join(', '), 120), authorUrl: track.artists?.[0]?.external_urls?.spotify ?? null, publishedAt: Date.parse(addedAt) || null, extra: account.name,
  }));
}

/** The newest releases of an artist, or the newest episodes of a podcast, newest first. */
async function spotifyReleases(account) {
  const [kind, raw] = account.id.split(':');
  if (kind === 'playlist') return spotifyPlaylistTracks(account, raw);
  if (kind === 'new') { // the new albums of a country, as Spotify lists them
    const body = await spotifyApi(`/browse/new-releases?country=${encodeURIComponent(raw)}&limit=10`);
    return (body?.albums?.items ?? []).filter((album) => album?.id && album.album_type !== 'compilation').map((album) => spotifyAlbumItem(album, account, clean(album.album_type, 20).toUpperCase())).filter((item) => item.publishedAt);
  }
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
  parseDeezerArtist, parseDeezerLink, deezerSearch, deezerResolve, deezerReleases,
  parseAppleArtist, parseAppleLink, appleSearch, appleResolve, appleReleases,
  parseSpotify, spotifySearch, spotifyResolve, spotifyReleases,
  deezerRandomSong, chartWords, newWords, countryOf,
};
