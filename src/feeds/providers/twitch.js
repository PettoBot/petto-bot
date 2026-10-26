// Twitch: who is live. The app of the bot (the same keys as `!twitch`) asks Twitch for the streams of the accounts being followed, all in one call.
const config = require('../../config');
const { fetchJsonBody } = require('../http');
const { IntegrationError } = require('../../utils/integrations');

const HELIX = 'https://api.twitch.tv/helix';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const LOGIN = /^\w{3,25}$/;

let token = null;
let pending = null;

/** The login from a name, `@name` or a link. */
function parseLogin(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.|m\.)?twitch\.tv\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  return LOGIN.test(text) ? text.toLowerCase() : null;
}

async function appToken(force = false) {
  if (!config.twitchClientId || !config.twitchClientSecret) throw new IntegrationError('notConfigured');
  if (!force && token && token.until > Date.now()) return token.value;
  pending ??= fetchJsonBody(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.twitchClientId, client_secret: config.twitchClientSecret, grant_type: 'client_credentials' }).toString(),
  }).then((body) => {
    if (!body?.access_token) throw new IntegrationError('unavailable');
    token = { value: body.access_token, until: Date.now() + Math.max(60, Number(body.expires_in) - 60) * 1000 };
    return token.value;
  }).finally(() => { pending = null; });
  return pending;
}

async function helix(path) {
  try {
    return await fetchJsonBody(`${HELIX}${path}`, { headers: { Authorization: `Bearer ${await appToken()}`, 'Client-Id': config.twitchClientId } });
  } catch (error) {
    if (String(error.message).includes('401')) {
      await appToken(true);
      return fetchJsonBody(`${HELIX}${path}`, { headers: { Authorization: `Bearer ${await appToken()}`, 'Client-Id': config.twitchClientId } });
    }
    throw error;
  }
}

async function resolveUser(input) {
  const login = parseLogin(input);
  if (!login) throw new IntegrationError('badInput');
  const user = (await helix(`/users?login=${encodeURIComponent(login)}`))?.data?.[0];
  if (!user) throw new IntegrationError('notFound');
  return { id: user.id, login: user.login, name: user.display_name, avatar: user.profile_image_url ?? null, url: `https://www.twitch.tv/${user.login}`, description: user.description ?? '' };
}

/** The streams that are live now among some user ids (up to 100 at a time): `{ [userId]: stream }`. */
async function liveStreams(userIds) {
  const out = {};
  for (let i = 0; i < userIds.length; i += 100) {
    const query = userIds.slice(i, i + 100).map((id) => `user_id=${encodeURIComponent(id)}`).join('&');
    for (const stream of (await helix(`/streams?first=100&${query}`))?.data ?? []) if (stream.type === 'live') out[stream.user_id] = stream;
  }
  return out;
}

/** The card item of a live stream. `account` is what `resolveUser` gave when the feed was made. */
function toItem(stream, account = {}) {
  const viewers = Number(stream.viewer_count) || 0;
  return {
    platform: 'twitch', type: 'live', id: stream.id, title: stream.title || stream.user_name, url: `https://www.twitch.tv/${stream.user_login}`,
    description: '', image: String(stream.thumbnail_url ?? '').replace('{width}', '1280').replace('{height}', '720') + `?t=${Math.floor(Date.now() / 600000)}` || null,
    avatar: account.avatar ?? null, author: stream.user_name, authorUrl: `https://www.twitch.tv/${stream.user_login}`, publishedAt: Date.parse(stream.started_at) || null,
    extra: [stream.game_name ? `🎮 ${stream.game_name}` : null, viewers ? `👁 ${viewers.toLocaleString('en-US')}` : null].filter(Boolean).join(' · '),
  };
}

module.exports = { parseLogin, resolveUser, liveStreams, toItem };
