// YouTube: the public feed of each channel (no key) gives the newest videos and Shorts (a Short has `/shorts/` in its link), and, with the key
// the bot already has for `!youtube`, one cheap call (1 unit for up to 50 videos) says which of them are live or about to be.
const config = require('../../config');
const { fetchText, fetchJsonBody } = require('../http');
const { IntegrationError } = require('../../utils/integrations');
const logger = require('../../utils/logger');
const redis = require('../../utils/redis');

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

// The key can spend a budget of units a day (10,000 by default, renewed at midnight of the Pacific time). The live check of the videos (one unit for 50 of them) is what makes
// every notice possible, so it must never run dry: the things that can wait (the search of the dashboard, the way out when the feed of a channel fails) only use a share of it.
const quota = { day: '', used: 0, warned: 0 };
function rollQuota() {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  if (quota.day !== day) { quota.day = day; quota.used = 0; quota.warned = 0; }
}
/** Writes down units spent, and says it in the log when the day passes 80% and 95% of the budget. */
function spend(units) {
  rollQuota();
  quota.used += units;
  if (units > 0) redis.incr(`feeds:youtube:quota:${quota.day}`, 2 * 86_400_000).catch(() => {}); // the day's count survives a restart (Redis, when there is one)
  const share = quota.used / config.youtubeDailyQuota;
  const level = share >= 0.95 ? 95 : share >= 0.8 ? 80 : 0;
  if (level > quota.warned) { quota.warned = level; logger.warn(`The YouTube key has used ${Math.round(share * 100)}% of its daily units (${quota.used} of ${config.youtubeDailyQuota}).`); }
}
/** Whether `units` more can be spent and still stay under `share` (0 to 1) of the daily budget. */
function canSpend(units, share = 1) {
  rollQuota();
  return quota.used + units <= config.youtubeDailyQuota * share;
}
const quotaUsed = () => { rollQuota(); return quota.used; };

/** After a restart: the units already spent today are read back from Redis (the bot would count from zero while Google counts from the start of the day). */
async function restoreQuota() {
  rollQuota();
  const saved = await redis.getJson(`feeds:youtube:quota:${quota.day}`);
  if (saved.hit && Number(saved.value) > quota.used) quota.used = Number(saved.value);
  return quota.used;
}
const UNITS = { '/search': 100 }; // everything else the feeds ask for costs one

async function api(path, params) {
  if (!config.youtubeApiKey) throw new IntegrationError('notConfigured');
  spend(UNITS[path] ?? 1);
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

/** The ISO 8601 length of a video (`PT1M5S`) in seconds. */
const seconds = (iso) => { const found = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso ?? '')); return found ? Number(found[1] ?? 0) * 3600 + Number(found[2] ?? 0) * 60 + Number(found[3] ?? 0) : null; };

/**
 * The newest videos of a channel from the API (the "uploads" list of the channel, two units): the same entries as its feed. YouTube's feed
 * sometimes answers 404 or 500 for a channel that exists, so this is the way out. A video of a minute or less is taken for a Short (the feed
 * says it by the link; the API does not).
 */
const lengths = new Map(); // videoId -> seconds
const exportLengths = () => [...lengths].slice(-20_000);
const importLengths = (pairs) => { for (const [id, length] of pairs ?? []) if (typeof id === 'string' && (length === null || Number.isFinite(length))) lengths.set(id, length); };

async function fetchChannelFromApi(channelId) {
  if (!CHANNEL_ID.test(channelId)) throw new IntegrationError('notFound');
  const list = await api('/playlistItems', { part: 'snippet', playlistId: `UU${channelId.slice(2)}`, maxResults: 15 });
  const items = (list?.items ?? []).filter((item) => item.snippet?.resourceId?.videoId);
  if (!items.length) return { name: '', entries: [] };
  // The length of a video never changes: it is asked once, so the usual pass over a channel costs one unit (the list) and not two.
  const unknown = items.map((item) => item.snippet.resourceId.videoId).filter((id) => !lengths.has(id));
  if (unknown.length) {
    const details = await api('/videos', { part: 'contentDetails', id: unknown.join(',') });
    for (const video of details?.items ?? []) { if (lengths.size >= 50_000) lengths.delete(lengths.keys().next().value); lengths.set(video.id, seconds(video.contentDetails?.duration)); }
  }
  const length = lengths;
  return {
    name: items[0].snippet.channelTitle ?? '',
    entries: items.map((item) => {
      const videoId = item.snippet.resourceId.videoId;
      const long = length.get(videoId);
      const thumbs = item.snippet.thumbnails ?? {};
      return {
        videoId, title: item.snippet.title ?? '', short: long !== null && long !== undefined && long <= 60, published: Date.parse(item.snippet.publishedAt) || null,
        url: `https://www.youtube.com/${long !== null && long !== undefined && long <= 60 ? `shorts/${videoId}` : `watch?v=${videoId}`}`, description: item.snippet.description ?? '',
        image: (thumbs.maxres ?? thumbs.high ?? thumbs.medium ?? thumbs.default)?.url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, author: item.snippet.channelTitle ?? '', channelId, views: null,
      };
    }),
  };
}

/** The feed of a channel: `{ name, entries }`. When YouTube's feed fails for a channel that exists, the API gives the same list. */
async function fetchChannel(channelId) {
  try {
    const xml = await fetchText(`${FEED}?channel_id=${encodeURIComponent(channelId)}`);
    return { name: tag(xml.split('<entry>')[0], 'title'), entries: parseFeed(xml) };
  } catch (error) {
    if (!(error instanceof IntegrationError) || !config.youtubeApiKey || !['notFound', 'unavailable', 'rateLimited'].includes(error.kind)) throw error;
    if (!canSpend(2, 0.7)) throw error; // the way out costs a unit or two a channel: it stops at 70% of the day so the live check keeps its room
    try {
      return await fetchChannelFromApi(channelId);
    } catch (second) {
      // The channel was found when the feed was made (by its id or by the API): a failure of both is a failure of YouTube, not a channel that is gone.
      throw second instanceof IntegrationError && second.kind === 'rateLimited' ? second : new IntegrationError('unavailable');
    }
  }
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
        description: video.snippet?.description ?? '', // a video that came with a push has none from the feed: the call that says whether it is live brings it, at no extra cost
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

module.exports = { spend, canSpend, quotaUsed, restoreQuota, exportLengths, importLengths, parseChannel, parseFeed, fetchChannel, fetchChannelFromApi, resolveChannel, liveStates, toItem, CHANNEL_ID };
