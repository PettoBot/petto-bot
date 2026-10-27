// The search of the dashboard: a person types a name and sees the accounts that match, with their picture, instead of having to paste a link.
// Each platform that has a public search is asked for it; the others answer with the account the text points at (a link or a name), if any.
// An answer is `{ value, name, avatar, url, detail }`: `value` is what goes to `createFeed` as the account, so nothing is looked up again.
const config = require('../config');
const { fetchJsonBody } = require('./http');
const { PROVIDERS, isProvider } = require('./providers');
const { IntegrationError, USER_AGENT } = require('../utils/integrations');
const youtube = require('./providers/youtube');
const music = require('./providers/music');
const { t } = require('../i18n');
const modrinthList = require('./providers/modrinth');
const steamList = require('./providers/steam');

const MIN_CHARS = 2;
const MAX_RESULTS = 10;
const KEEP_MS = 5 * 60_000;
const YOUTUBE_KEEP_MS = 24 * 3_600_000;
const YOUTUBE_SEARCHES_A_DAY = 60; // a search of channels costs 100 units of the 10,000 a day of the key
const YOUTUBE_SEARCHES_PER_SERVER = 10; // and one server cannot spend them all
const cache = new Map(); // `${platform}:${text}` -> { until, results }
const youtubeDay = { day: '', used: 0, servers: new Map() };

const clean = (text, max = 120) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const https = (value) => (/^https:\/\//i.test(String(value ?? '')) ? String(value) : (/^\/\//.test(String(value ?? '')) ? `https:${value}` : null));
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k` : String(n));

async function searchYoutube(query, lang, scope = '') {
  if (!config.youtubeApiKey) throw new IntegrationError('notConfigured');
  // A link, an @name or a channel id points at one channel: one unit instead of a hundred.
  if (youtube.parseChannel(query) && (/^@/.test(query) || /youtube\.com|^UC[\w-]{22}$/.test(query))) return searchExact('youtube', query);
  // What is written like a name (one word) is tried as the @name of a channel first, for one unit: most people write the name of the channel as it is.
  if (/^[\w.-]{3,30}$/.test(query)) {
    const exact = await searchExact('youtube', `@${query}`, lang).catch(() => []);
    if (exact.length) return exact;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (youtubeDay.day !== today) { youtubeDay.day = today; youtubeDay.used = 0; youtubeDay.servers.clear(); }
  const server = youtubeDay.servers.get(scope) ?? 0;
  if (youtubeDay.used >= YOUTUBE_SEARCHES_A_DAY || (scope && server >= YOUTUBE_SEARCHES_PER_SERVER) || !youtube.canSpend(100, 0.5)) throw new IntegrationError('rateLimited'); // a search is 100 units: they stop at half of the day
  youtubeDay.used += 1;
  if (scope) youtubeDay.servers.set(scope, server + 1);
  youtube.spend(100);
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  for (const [key, value] of Object.entries({ part: 'snippet', type: 'channel', q: query, maxResults: 6, key: config.youtubeApiKey })) url.searchParams.set(key, String(value));
  const body = await fetchJsonBody(url.toString());
  return (body?.items ?? []).filter((item) => item.id?.channelId).map((item) => ({
    value: item.id.channelId, name: clean(item.snippet?.channelTitle ?? item.snippet?.title, 80), avatar: https(item.snippet?.thumbnails?.default?.url ?? item.snippet?.thumbnails?.medium?.url),
    url: `https://www.youtube.com/channel/${item.id.channelId}`, detail: clean(item.snippet?.description, 90),
  }));
}

async function searchTwitch(query) {
  const twitch = require('./providers/twitch');
  const body = await twitch.api(`/search/channels?query=${encodeURIComponent(query)}&first=${MAX_RESULTS}`);
  return (body?.data ?? []).map((channel) => ({
    value: channel.broadcaster_login, name: channel.display_name, avatar: https(channel.thumbnail_url), url: `https://www.twitch.tv/${channel.broadcaster_login}`,
    detail: channel.is_live ? `🔴 ${clean(channel.game_name, 40)}`.trim() : clean(channel.game_name, 40),
  }));
}

async function searchBluesky(query) {
  const body = await fetchJsonBody(`https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead?q=${encodeURIComponent(query)}&limit=${MAX_RESULTS}`);
  return (body?.actors ?? []).map((actor) => ({ value: actor.handle, name: clean(actor.displayName || actor.handle, 80), avatar: https(actor.avatar), url: `https://bsky.app/profile/${actor.handle}`, detail: `@${actor.handle}` }));
}

/** What a person typed when they want a list of what is new, not one account: `new`, `new mods`, `nuevos shaders`; the words after it or ''. null otherwise. */
const newListWords = (text) => { const match = /^(?:new|news|nuevo|nuevos|nueva|nuevas|novo|novos|nova|novas|novedades|novidades|lanzamientos|lançamentos|releases|top|tops|ranking|coming soon|pronto|em breve)(?:\s+(.*))?$/i.exec(String(text ?? '').trim()); return match ? String(match[1] ?? '').trim().toLowerCase() : null; };

async function searchSteam(query, lang) {
  if (newListWords(query) !== null) {
    const wanted = /^(?:top|tops|ranking)\b/i.test(query) ? 'top' : /^(?:coming soon|pronto|em breve)/i.test(query) ? 'soon' : 'new';
    return Object.keys(steamList.STORE_LISTS).filter((kind) => kind === wanted || wanted === 'new' && newListWords(query) === '').map((kind) => { const account = steamList.storeAccount(kind, lang); return { value: account.id, name: account.name, avatar: null, url: account.url, detail: t(lang, 'feeds.list.detail.store') }; });
  }
  const body = await fetchJsonBody(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`);
  return (body?.items ?? []).slice(0, MAX_RESULTS).map((game) => ({ value: String(game.id), name: clean(game.name, 80), avatar: https(game.tiny_image), url: `https://store.steampowered.com/app/${game.id}`, detail: '' }));
}

async function searchGithub(query) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT, ...(config.githubToken ? { Authorization: `Bearer ${config.githubToken}` } : {}) };
  const body = await fetchJsonBody(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${MAX_RESULTS}&sort=stars`, { headers });
  return (body?.items ?? []).map((repo) => ({ value: repo.full_name, name: repo.full_name, avatar: https(repo.owner?.avatar_url), url: repo.html_url, detail: `⭐ ${compact(repo.stargazers_count ?? 0)}${repo.description ? ` · ${clean(repo.description, 70)}` : ''}` }));
}

async function searchModrinth(query, lang) {
  const rest = newListWords(query);
  if (rest !== null && !/^(?:top|tops|ranking|coming soon|pronto|em breve)\b/i.test(query)) {
    const names = { mod: /mod/, modpack: /modpack|pack de mods/, resourcepack: /resource|texture|textura/, shader: /shader/, plugin: /plugin/, datapack: /data\s?pack/ };
    const kinds = Object.keys(modrinthList.NEW_KINDS).filter((kind) => !rest || names[kind].test(rest));
    // The kinds together in one feed come first (a server has a few places for each platform: one feed can cover several kinds), then each kind alone.
    const accounts = [...(kinds.length > 1 ? [modrinthList.newAccount(kinds, lang)] : []), ...kinds.map((kind) => modrinthList.newAccount(kind, lang))];
    return accounts.map((account) => ({ value: account.id, name: account.name, avatar: null, url: account.url, detail: t(lang, 'feeds.list.detail.newProjects') }));
  }
  const body = await fetchJsonBody(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&limit=${MAX_RESULTS}`);
  return (body?.hits ?? []).map((hit) => ({ value: hit.slug, name: clean(hit.title, 80), avatar: https(hit.icon_url), url: `https://modrinth.com/${hit.project_type}/${hit.slug}`, detail: clean(hit.description, 90) }));
}

async function searchNpm(query) {
  const body = await fetchJsonBody(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${MAX_RESULTS}`);
  return (body?.objects ?? []).map((entry) => ({ value: entry.package.name, name: entry.package.name, avatar: null, url: `https://www.npmjs.com/package/${entry.package.name}`, detail: `${entry.package.version} · ${clean(entry.package.description, 80)}` }));
}

async function searchAnilist(query) {
  const body = await fetchJsonBody('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    query: 'query($q:String){Page(perPage:8){media(search:$q,type:ANIME,sort:SEARCH_MATCH){id title{romaji english} coverImage{medium} seasonYear format}}}', variables: { q: query }, // i18n-ignore: a GraphQL query
  }) });
  return (body?.data?.Page?.media ?? []).map((media) => ({ value: String(media.id), name: clean(media.title.english || media.title.romaji, 80), avatar: https(media.coverImage?.medium), url: `https://anilist.co/anime/${media.id}`, detail: [media.format, media.seasonYear].filter(Boolean).join(' · ') }));
}

/** The platforms with no search answer with the account the text points at (a link, a name), or with nothing. */
async function searchExact(platform, query, lang) {
  try {
    const account = await PROVIDERS[platform].resolve(query, { lang });
    return [{ value: query, name: clean(account.name, 80), avatar: https(account.avatar), url: account.url ?? null, detail: '' }];
  } catch (error) {
    if (error instanceof IntegrationError && ['notFound', 'badInput'].includes(error.kind)) return [];
    throw error;
  }
}

/** The music platforms: a link (of an artist, a song, an album or a playlist) or an id of the lists is looked up as it is, anything else is a name to look for. */
const searchMusic = (platform, searcher, parser) => (query, lang) => (parser(query) || /^https?:\/\//i.test(query) || /^(?:playlist|chart|new):/i.test(query) ? searchExact(platform, query, lang) : searcher(query, lang));

const SEARCHES = {
  deezer: searchMusic('deezer', music.deezerSearch, music.parseDeezerArtist),
  applemusic: searchMusic('applemusic', music.appleSearch, music.parseAppleArtist),
  spotify: searchMusic('spotify', music.spotifySearch, music.parseSpotify),
  youtube: searchYoutube,
  twitch: searchTwitch, bluesky: searchBluesky, steam: searchSteam, github: searchGithub, modrinth: searchModrinth, npm: searchNpm, anilist: searchAnilist };

/** The accounts of a platform that match what a person typed (up to eight), kept five minutes (a day for YouTube, which has a daily budget). */
async function searchAccounts(platform, text, lang = 'en', scope = '') {
  if (!isProvider(platform) || PROVIDERS[platform].noAccount) return [];
  const query = clean(text, 100);
  if (query.length < MIN_CHARS) return [];
  const key = `${platform}:${lang}:${query.toLowerCase()}`;
  const kept = cache.get(key);
  if (kept && kept.until > Date.now()) return kept.results;
  const results = (await (SEARCHES[platform] ?? ((q, l) => searchExact(platform, q, l)))(query, lang, scope)).filter((entry) => entry.value && entry.name).slice(0, MAX_RESULTS);
  if (cache.size > 3000) cache.clear();
  cache.set(key, { until: Date.now() + (platform === 'youtube' ? YOUTUBE_KEEP_MS : KEEP_MS), results });
  return results;
}

const forgetSearches = () => { cache.clear(); youtubeDay.day = ''; youtubeDay.used = 0; youtubeDay.servers.clear(); }; // for the checks

module.exports = { searchAccounts, forgetSearches, MIN_CHARS };
