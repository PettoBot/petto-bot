// YouTube: the public feed of each channel (no key) gives the newest videos and Shorts (a Short has `/shorts/` in its link), and, with the key
// the bot already has for `!youtube`, one cheap call (1 unit for up to 50 videos) says which of them are live or about to be.
const config = require('../../config');
const { fetchText, fetchJsonBody } = require('../http');
const { IntegrationError } = require('../../utils/integrations');

const FEED = 'https://www.youtube.com/feeds/videos.xml';
const API = 'https://www.googleapis.com/youtube/v3';
const CHANNEL_ID = /^UC[\w-]{22}$/;
const HANDLE = /^@?[\w.\-]{3,60}$/;

const decode = (text) => String(text ?? '').replace(/&(amp|lt|gt|quot|#39|apos);/g, (m, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" })[name]);
const tag = (xml, name) => { const found = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml); return found ? decode(found[1].trim()) : ''; };
const attr = (xml, name, key) => { const found = new RegExp(`<${name}\\b[^>]*\\b${key}="([^"]*)"`).exec(xml); return found ? decode(found[1]) : ''; };

/** What a person wrote (a link, `@handle`, a channel id) as `{ id }` or `{ handle }`, or null. */
function parseChannel(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.|m\.)?youtube\.com\//i, '').replace(/^https?:\/\/youtu\.be\/.*/i, '');
  if (!text) return null;
  const byId = /^channel\/(UC[\w-]{22})/.exec(text);
  if (byId) return { id: byId[1] };
  if (CHANNEL_ID.test(text)) return { id: text };
  const handle = /^@([\w.\-]{3,60})/.exec(text)?.[1] ?? (HANDLE.test(text.split(/[/?#]/)[0]) && !text.includes('/') ? text.replace(/^@/, '') : null);
  return handle ? { handle } : null;
}

/** The newest entries of the feed of a channel (up to 15), newest first. */
function parseFeed(xml) {
  const channelName = tag(xml.split('<entry>')[0], 'title');
  return xml.split('<entry>').slice(1).map((entry) => {
    const videoId = tag(entry, 'yt:videoId');
    const link = attr(entry, 'link', 'href');
    return {
      videoId,
      title: tag(entry, 'title'),
      url: link || `https://www.youtube.com/watch?v=${videoId}`,
      short: /\/shorts\//.test(link),
      published: Date.parse(tag(entry, 'published')) || null,
      description: tag(entry, 'media:description'),
      image: attr(entry, 'media:thumbnail', 'url') || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      author: tag(entry.slice(entry.indexOf('<author>')), 'name') || channelName,
      channelId: tag(entry, 'yt:channelId'),
      views: Number(attr(entry, 'media:statistics', 'views')) || null,
    };
  }).filter((entry) => entry.videoId);
}

async function api(path, params) {
  if (!config.youtubeApiKey) throw new IntegrationError('notConfigured');
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries({ ...params, key: config.youtubeApiKey })) url.searchParams.set(key, String(value));
  return fetchJsonBody(url.toString());
}

/** The channel a person pointed at: `{ id, name, avatar, url, handle }`. With the key it reads the real name and picture; without it, only ids work. */
async function resolveChannel(input) {
  const target = parseChannel(input);
  if (!target) throw new IntegrationError('badInput');
  // Without the key a live stream cannot be told from a video (the feed of the channel lists both the same way), so a YouTube feed is not made
  // at all rather than posting a stream as a video.
  if (!config.youtubeApiKey) throw new IntegrationError('notConfigured');
  if (config.youtubeApiKey) {
    const body = await api('/channels', { part: 'snippet', ...(target.id ? { id: target.id } : { forHandle: `@${target.handle}` }) });
    const found = body?.items?.[0];
    if (!found) throw new IntegrationError('notFound');
    return { id: found.id, name: found.snippet.title, avatar: (found.snippet.thumbnails?.medium ?? found.snippet.thumbnails?.default)?.url ?? null, url: `https://www.youtube.com/channel/${found.id}`, handle: found.snippet.customUrl ?? null };
  }
  if (!target.id) throw new IntegrationError('notConfigured'); // a handle needs the key to become an id
  const entries = await fetchChannel(target.id);
  return { id: target.id, name: entries.name, avatar: null, url: `https://www.youtube.com/channel/${target.id}`, handle: null };
}

/** The feed of a channel: `{ name, entries }`. A channel that does not exist is `notFound`. */
async function fetchChannel(channelId) {
  const xml = await fetchText(`${FEED}?channel_id=${encodeURIComponent(channelId)}`);
  return { name: tag(xml.split('<entry>')[0], 'title'), entries: parseFeed(xml) };
}

/** For some video ids: `{ [id]: { state: 'live' | 'upcoming' | 'none', startedAt, scheduledAt, viewers } }` (needs the key; one unit for up to 50). */
async function liveStates(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const body = await api('/videos', { part: 'snippet,liveStreamingDetails', id: ids.slice(i, i + 50).join(',') });
    for (const video of body?.items ?? []) {
      const details = video.liveStreamingDetails ?? {};
      out[video.id] = {
        state: video.snippet?.liveBroadcastContent ?? 'none',
        startedAt: Date.parse(details.actualStartTime) || null,
        scheduledAt: Date.parse(details.scheduledStartTime) || null,
        viewers: Number(details.concurrentViewers) || null,
        avatarless: true,
      };
    }
  }
  return out;
}

/** The first line of a description that says something (the rest is usually links, sponsors and hashtags). */
const firstLine = (text) => String(text ?? '').split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 3 && !/^(https?:\/\/|#)/.test(line)) ?? '';

/** The card item of an entry of the feed. `kind` is 'video', 'short' or 'live'. */
function toItem(entry, kind, channel = {}) {
  return {
    platform: 'youtube', type: kind, id: entry.videoId, title: entry.title, url: entry.url, description: firstLine(entry.description),
    image: entry.image, avatar: channel.avatar ?? null, author: entry.author, authorUrl: `https://www.youtube.com/channel/${entry.channelId}`, publishedAt: entry.published,
  };
}

module.exports = { parseChannel, parseFeed, fetchChannel, resolveChannel, liveStates, toItem, CHANNEL_ID };
