// Kick: who is live. Kick's public API (the app of the bot, KICK_CLIENT_ID and KICK_CLIENT_SECRET) tells the channels and their stream, up to 50
// accounts in one call. A channel has no id for each stream: the moment it started is what tells one stream from the next.
const config = require('../../config');
const { fetchJsonBody } = require('../http');
const { IntegrationError } = require('../../utils/integrations');

const API = 'https://api.kick.com/public/v1';
const TOKEN_URL = 'https://id.kick.com/oauth/token';
const SLUG = /^[\w-]{1,25}$/;
const BATCH = 50;

let token = null;
let pending = null;

/** The slug (the name in the link) from a name, `@name` or a link. */
function parseSlug(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.|m\.)?kick\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  return SLUG.test(text) ? text.toLowerCase() : null;
}

async function appToken(force = false) {
  if (!config.kickClientId || !config.kickClientSecret) throw new IntegrationError('notConfigured');
  if (!force && token && token.until > Date.now()) return token.value;
  pending ??= fetchJsonBody(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.kickClientId, client_secret: config.kickClientSecret }).toString(),
  }).then((body) => {
    if (!body?.access_token) throw new IntegrationError('unavailable');
    token = { value: body.access_token, until: Date.now() + Math.max(60, (Number(body.expires_in) || 3600) - 60) * 1000 };
    return token.value;
  }).finally(() => { pending = null; });
  return pending;
}

async function api(path) {
  const ask = async () => fetchJsonBody(`${API}${path}`, { headers: { Authorization: `Bearer ${await appToken()}` } });
  try {
    return await ask();
  } catch (error) {
    if (String(error.message).includes('401')) { await appToken(true); return ask(); } // the token ran out early
    throw error;
  }
}

const query = (key, values) => values.map((value) => `${key}=${encodeURIComponent(value)}`).join('&');

/** The account a person pointed at: its id is the id of the broadcaster, its picture comes from the user of that id. */
async function resolveChannel(input) {
  const slug = parseSlug(input);
  if (!slug) throw new IntegrationError('badInput');
  const channel = (await api(`/channels?${query('slug', [slug])}`))?.data?.[0];
  if (!channel) throw new IntegrationError('notFound');
  let user = null;
  try { user = (await api(`/users?${query('id', [channel.broadcaster_user_id])}`))?.data?.[0] ?? null; } catch { /* the picture is only decoration */ }
  return { id: String(channel.broadcaster_user_id), slug: channel.slug, name: user?.name || channel.slug, avatar: user?.profile_picture ?? null, url: `https://kick.com/${channel.slug}` };
}

/** The channels that are live now among some broadcaster ids: `{ [broadcasterId]: channel }`. */
async function liveChannels(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += BATCH) {
    for (const channel of (await api(`/channels?${query('broadcaster_user_id', ids.slice(i, i + BATCH))}`))?.data ?? []) {
      if (channel.stream?.is_live) out[String(channel.broadcaster_user_id)] = channel;
    }
  }
  return out;
}

/** The id of a stream: when it started. */
const streamId = (channel) => String(channel.stream?.start_time ?? '');

/** The card item of a live stream. `account` is what `resolveChannel` gave when the feed was made. */
function toItem(channel, account = {}) {
  const viewers = Number(channel.stream?.viewer_count) || 0;
  const category = channel.category?.name;
  const thumbnail = String(channel.stream?.thumbnail ?? '');
  return {
    platform: 'kick', type: 'live', id: streamId(channel), title: channel.stream_title || account.name || channel.slug, url: `https://kick.com/${channel.slug}`,
    description: '', image: /^https:\/\//i.test(thumbnail) ? thumbnail : null, avatar: account.avatar ?? null, author: account.name || channel.slug,
    authorUrl: `https://kick.com/${channel.slug}`, publishedAt: Date.parse(channel.stream?.start_time) || null,
    extra: [category ? `🎮 ${category}` : null, viewers ? `👁 ${viewers.toLocaleString('en-US')}` : null].filter(Boolean).join(' · '),
  };
}

module.exports = { parseSlug, resolveChannel, liveChannels, streamId, toItem };
