// AniList: a new episode of an anime. The public GraphQL API (no key) tells, for all the anime being followed at once, the episodes that aired lately.
const { fetchJsonBody } = require('../http');
const { IntegrationError } = require('../../utils/integrations');

const API = 'https://graphql.anilist.co';
const DAY = 86_400;

async function graphql(query, variables) {
  const body = await fetchJsonBody(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (body?.errors?.length && !body.data) throw new IntegrationError(body.errors[0]?.status === 404 ? 'notFound' : 'unavailable');
  return body?.data ?? {};
}

/** The id or a name from a number, a link to the anime or words to search. */
function parseAnime(input) {
  const text = String(input ?? '').trim();
  const link = /anilist\.co\/anime\/(\d+)/i.exec(text);
  if (link) return { id: Number(link[1]) };
  if (/^\d{1,8}$/.test(text)) return { id: Number(text) };
  return text.length >= 2 && text.length <= 100 && !/^https?:\/\//i.test(text) ? { search: text } : null;
}

async function resolveAnime(input) {
  const target = parseAnime(input);
  if (!target) throw new IntegrationError('badInput');
  const data = await graphql('query($id:Int,$search:String){Media(id:$id,search:$search,type:ANIME){id title{romaji english} coverImage{large} bannerImage siteUrl}}', target); // i18n-ignore: a GraphQL query
  const media = data.Media;
  if (!media) throw new IntegrationError('notFound');
  return { id: String(media.id), name: media.title.english || media.title.romaji, avatar: media.coverImage?.large ?? null, url: media.siteUrl, image: media.bannerImage ?? media.coverImage?.large ?? null };
}

/** The episodes that aired in the last `days` days for these anime: `{ [mediaId]: [{ id, episode, airingAt }] }` (newest first). */
async function recentEpisodes(mediaIds, now = Date.now(), days = 3) {
  const out = {};
  const ids = mediaIds.map(Number).filter(Number.isInteger);
  for (let i = 0; i < ids.length; i += 50) {
    const data = await graphql('query($ids:[Int],$from:Int,$to:Int){Page(perPage:50){airingSchedules(mediaId_in:$ids,airingAt_greater:$from,airingAt_lesser:$to,sort:TIME_DESC){id episode airingAt mediaId}}}', // i18n-ignore: a GraphQL query
      { ids: ids.slice(i, i + 50), from: Math.floor(now / 1000) - days * DAY, to: Math.floor(now / 1000) });
    for (const row of data.Page?.airingSchedules ?? []) (out[String(row.mediaId)] ??= []).push({ id: String(row.id), episode: row.episode, airingAt: row.airingAt * 1000 });
  }
  return out;
}

const toItem = (account, episode) => ({
  platform: 'anilist', type: 'episode', id: episode.id, title: `${account.name} · ${episode.episode}`, url: account.url, description: '', image: account.image ?? null, avatar: account.avatar ?? null,
  author: account.name, authorUrl: account.url, publishedAt: episode.airingAt, extra: '',
});

module.exports = { parseAnime, resolveAnime, recentEpisodes, toItem };
