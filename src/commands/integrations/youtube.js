const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config');
const { infoPayload } = require('../../utils/infoCard');
const { IntegrationError, fetchJson, cached, lookup, row, short, plain, clock, dateTag } = require('../../utils/integrations');
const { t, formatNumber, languageOf } = require('../../i18n');

const API = 'https://www.googleapis.com/youtube/v3';
const CACHE_MS = 10 * 60_000;
// Search is the expensive call of the daily quota, so asking again is slower for it.
const COOLDOWN = { name: 'youtube', ms: 5000 };
const SEARCH_SHOWN = 5;
const VIDEO_ID = /^[\w-]{11}$/;
const CHANNEL_ID = /^UC[\w-]{22}$/;
const HANDLE = /^[\w.-]{3,30}$/;
const QUOTA_REASONS = new Set(['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded']);

/** `{ id }` for a video link or id, or `{ query }` for words to search, or null when empty. */
function parseVideo(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  if (VIDEO_ID.test(text)) return { id: text };
  const link = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|music\.youtube\.com\/watch\?(?:[^#]*&)?v=)([\w-]{11})/i.exec(text);
  if (link) return { id: link[1] };
  return { query: text.slice(0, 100) };
}

/** `{ id }` or `{ handle }` from a channel link, `@handle`, a handle or a channel id, or null. */
function parseChannel(input) {
  const text = String(input ?? '').trim();
  const link = /youtube\.com\/(?:channel\/(UC[\w-]{22})|@([\w.-]{3,30}))/i.exec(text);
  if (link) return link[1] ? { id: link[1] } : { handle: link[2] };
  if (CHANNEL_ID.test(text)) return { id: text };
  const handle = text.replace(/^@/, '');
  return HANDLE.test(handle) ? { handle } : null;
}

/** Seconds of an ISO 8601 duration (`PT1H2M3S`), or null. */
function durationSeconds(iso) {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso ?? ''));
  if (!match) return null;
  const [, d = 0, h = 0, m = 0, s = 0] = match;
  return Number(d) * 86400 + Number(h) * 3600 + Number(m) * 60 + Number(s);
}

async function call(path, params) {
  if (!config.youtubeApiKey) throw new IntegrationError('notConfigured');
  try {
    return await fetchJson(`${API}${path}?${new URLSearchParams({ ...params, key: config.youtubeApiKey })}`);
  } catch (error) {
    const reason = error?.body?.error?.errors?.[0]?.reason;
    if (QUOTA_REASONS.has(reason)) throw new IntegrationError('rateLimited');
    throw error;
  }
}

async function findVideo(target) {
  let id = target.id;
  if (!id) {
    const found = await cached(`yt:q:${target.query.toLowerCase()}`, CACHE_MS, () => call('/search', { part: 'snippet', type: 'video', maxResults: '1', q: target.query, safeSearch: 'moderate' }));
    id = found?.items?.[0]?.id?.videoId;
    if (!id) throw new IntegrationError('notFound');
  }
  return cached(`yt:v:${id}`, CACHE_MS, async () => {
    const body = await call('/videos', { part: 'snippet,statistics,contentDetails', id });
    const video = body?.items?.[0];
    if (!video) throw new IntegrationError('notFound');
    return video;
  });
}

async function findChannel(target) {
  const key = target.id ? `id:${target.id}` : `handle:${target.handle.toLowerCase()}`;
  return cached(`yt:c:${key}`, CACHE_MS, async () => {
    const body = await call('/channels', { part: 'snippet,statistics,contentDetails', ...(target.id ? { id: target.id } : { forHandle: `@${target.handle}` }) });
    const channel = body?.items?.[0];
    if (!channel) throw new IntegrationError('notFound');
    return channel;
  });
}


/** The card of a video: its views, likes and length, with its picture. */
function videoCard(video, lang) {
  const number = (value) => formatNumber(lang, Number(value ?? 0));
  const seconds = durationSeconds(video.contentDetails?.duration);
  const live = video.snippet?.liveBroadcastContent === 'live';
  const stats = video.statistics ?? {};
  return infoPayload({
    accent: null,
    title: plain(video.snippet.title, 200),
    subtitle: [plain(video.snippet.channelTitle, 100)],
    banner: bestPicture(video.snippet.thumbnails),
    sections: [{
      lines: [
        stats.viewCount !== undefined ? row(t(lang, 'integrations.youtube.views'), number(stats.viewCount)) : null,
        stats.likeCount !== undefined ? row(t(lang, 'integrations.youtube.likes'), number(stats.likeCount)) : null,
        stats.commentCount !== undefined ? row(t(lang, 'integrations.youtube.comments'), number(stats.commentCount)) : null,
        live ? row(t(lang, 'integrations.youtube.length'), t(lang, 'integrations.youtube.live')) : seconds ? row(t(lang, 'integrations.youtube.length'), clock(seconds)) : null,
        row(t(lang, 'integrations.youtube.published'), dateTag(video.snippet.publishedAt)),
      ],
    }],
    footer: 'YouTube',
    buttons: [
      { label: t(lang, 'integrations.youtube.watch'), url: `https://www.youtube.com/watch?v=${video.id}` },
      { label: t(lang, 'integrations.youtube.openChannel'), url: `https://www.youtube.com/channel/${video.snippet.channelId}` },
    ],
  });
}

const bestPicture = (thumbnails) => (thumbnails?.maxres ?? thumbnails?.standard ?? thumbnails?.high ?? thumbnails?.medium ?? thumbnails?.default)?.url ?? null;

module.exports = {
  aliases: ['yt'],
  data: new SlashCommandBuilder()
    .setName('youtube')
    .setDescription('Look up a YouTube video or channel.')
    .addSubcommand((s) => s
      .setName('video')
      .setDescription('A video: its views, likes and length. Give a link or words to search.')
      .addStringOption((o) => o.setName('video').setDescription('A link to the video, or words to search').setMaxLength(200).setRequired(true)))
    .addSubcommand((s) => s
      .setName('channel')
      .setDescription('A channel: subscribers, videos and views.')
      .addStringOption((o) => o.setName('channel').setDescription('The @handle, the link or the id of the channel').setMaxLength(200).setRequired(true)))
    .addSubcommand((s) => s
      .setName('latest')
      .setDescription('The latest video of a channel.')
      .addStringOption((o) => o.setName('channel').setDescription('The @handle, the link or the id of the channel').setMaxLength(200).setRequired(true)))
    .addSubcommand((s) => s
      .setName('search')
      .setDescription('The first five videos found for some words.')
      .addStringOption((o) => o.setName('query').setDescription('The words to search').setMaxLength(100).setRequired(true))),

  // The short words people type after the command.
  // A link to a video, or several words, is a video; a @handle, a channel link or a single word is a channel (`!yt urugodd`).
  prefixDefaultSubcommand: (tokens) => {
    if (!tokens.length) return null;
    if (tokens.length > 1) return 'video';
    const [word] = tokens;
    if (parseVideo(word)?.id) return 'video';
    return parseChannel(word) ? 'channel' : 'video';
  },
  prefixSubcommandAliases: { v: 'video', c: 'channel', new: 'latest', last: 'latest', newest: 'latest', find: 'search', s: 'search' },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    const number = (value) => formatNumber(lang, Number(value ?? 0));
    await lookup(interaction, lang, 'YouTube', async () => {
      if (sub === 'video') {
        const target = parseVideo(interaction.options.getString('video', true));
        if (!target) throw new IntegrationError('badInput');
        const video = await findVideo(target);
        return videoCard(video, lang);
      }

      if (sub === 'search') {
        const query = interaction.options.getString('query', true).trim().slice(0, 100);
        if (!query) throw new IntegrationError('badInput');
        const found = await cached(`yt:s5:${query.toLowerCase()}`, CACHE_MS, () => call('/search', { part: 'snippet', type: 'video', maxResults: String(SEARCH_SHOWN), q: query, safeSearch: 'moderate' }));
        const items = (found?.items ?? []).filter((item) => item.id?.videoId);
        if (!items.length) throw new IntegrationError('notFound');
        return infoPayload({
          accent: null,
          title: t(lang, 'integrations.youtube.searchTitle', { query: plain(query, 60) }),
          sections: [{ lines: items.map((item, index) => `**${index + 1}.** [${plain(item.snippet.title, 90)}](https://www.youtube.com/watch?v=${item.id.videoId}) — ${plain(item.snippet.channelTitle, 40)}`), limit: 1500 }], // i18n-ignore: a list of links
          footer: 'YouTube',
          buttons: [{ label: t(lang, 'integrations.youtube.openSearch'), url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` }],
        });
      }

      const target = parseChannel(interaction.options.getString('channel', true));
      if (!target) throw new IntegrationError('badInput');
      const channel = await findChannel(target);
      if (sub === 'latest') {
        const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
        if (!uploads) throw new IntegrationError('notFound');
        const list = await cached(`yt:latest:${channel.id}`, CACHE_MS, () => call('/playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: '1' }));
        const videoId = list?.items?.[0]?.contentDetails?.videoId;
        if (!videoId) throw new IntegrationError('notFound');
        return videoCard(await findVideo({ id: videoId }), lang);
      }
      const stats = channel.statistics ?? {};
      return infoPayload({
        accent: null,
        title: plain(channel.snippet.title, 100),
        subtitle: [channel.snippet.customUrl ? plain(channel.snippet.customUrl, 50) : null, channel.snippet.description ? short(plain(channel.snippet.description, 250), 250) : null].filter(Boolean),
        thumbnail: bestPicture(channel.snippet.thumbnails),
        sections: [{
          lines: [
            row(t(lang, 'integrations.youtube.subscribers'), stats.hiddenSubscriberCount ? t(lang, 'integrations.youtube.hidden') : number(stats.subscriberCount)),
            row(t(lang, 'integrations.youtube.videos'), number(stats.videoCount)),
            row(t(lang, 'integrations.youtube.channelViews'), number(stats.viewCount)),
            channel.snippet.country ? row(t(lang, 'integrations.youtube.country'), channel.snippet.country) : null,
            row(t(lang, 'integrations.youtube.created'), dateTag(channel.snippet.publishedAt)),
          ],
        }],
        footer: t(lang, 'info.card.id', { id: channel.id }),
        buttons: [{ label: t(lang, 'integrations.youtube.openChannel'), url: `https://www.youtube.com/channel/${channel.id}` }],
      });
    }, COOLDOWN);
  },
};

module.exports.parseVideo = parseVideo;
module.exports.parseChannel = parseChannel;
module.exports.durationSeconds = durationSeconds;
module.exports.clock = clock;
module.exports.findVideo = findVideo;
module.exports.findChannel = findChannel;
