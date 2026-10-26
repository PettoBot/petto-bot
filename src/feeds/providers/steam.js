// Steam: the news of a game (its announcements). Public API, no key.
const { fetchJsonBody } = require('../http');
const { IntegrationError } = require('../../utils/integrations');
const { clip } = require('../text');

/** The app id from a number or a link to the store page (`store.steampowered.com/app/730/...`). */
function parseApp(input) {
  const text = String(input ?? '').trim();
  const found = /(?:steampowered\.com\/app\/|steamcommunity\.com\/app\/|^)(\d{1,9})(?:[/?#].*)?$/.exec(text);
  return found ? found[1] : null;
}

async function resolveApp(input) {
  const id = parseApp(input);
  if (!id) throw new IntegrationError('badInput');
  const body = await fetchJsonBody(`https://store.steampowered.com/api/appdetails?appids=${id}&filters=basic`);
  const app = body?.[id];
  if (!app?.success || !app.data?.name) throw new IntegrationError('notFound');
  return { id, name: app.data.name, avatar: app.data.header_image ?? null, url: `https://store.steampowered.com/app/${id}`, image: app.data.header_image ?? null };
}

/** BBCode and Steam's own markup out: plain text. */
const plain = (text) => String(text ?? '').replace(/\[\/?[a-z0-9*]+(?:=[^\]]*)?\]/gi, ' ').replace(/\{STEAM_CLIENT_IMAGE\}\S*/g, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
const firstImage = (text) => /\[img\]\s*(https:\/\/[^\s[\]]+)\s*\[\/img\]/i.exec(String(text ?? ''))?.[1] ?? null;

/** The newest announcements of a game, newest first. */
async function fetchNews(appId, count = 5) {
  const body = await fetchJsonBody(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${encodeURIComponent(appId)}&count=${count}&maxlength=0&format=json`);
  return (body?.appnews?.newsitems ?? []).map((item) => ({
    id: String(item.gid), title: String(item.title ?? ''), url: String(item.url ?? ''), summary: clip(plain(item.contents), 300), image: firstImage(item.contents),
    published: Number(item.date) * 1000 || null, author: String(item.author ?? ''), feed: String(item.feedlabel ?? ''),
  }));
}

const toItem = (account, entry) => ({
  platform: 'steam', type: 'post', id: entry.id, title: entry.title, url: entry.url, description: entry.summary, image: entry.image ?? null, avatar: account.avatar ?? null,
  author: account.name, authorUrl: account.url, publishedAt: entry.published, extra: entry.feed && entry.feed !== 'Community Announcements' ? entry.feed : '',
});

module.exports = { parseApp, resolveApp, fetchNews, toItem };
