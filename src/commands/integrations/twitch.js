const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config');
const { infoPayload, noticePayload } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');
const { IntegrationError, fetchJson, cached, lookup, row, plain, dateTag } = require('../../utils/integrations');
const { t, tn, formatNumber, languageOf } = require('../../i18n');

const HELIX = 'https://api.twitch.tv/helix';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const CACHE_MS = 60_000;
const COOLDOWN = { name: 'twitch', ms: 3000 };
const LOGIN = /^\w{3,25}$/;
const CLIPS_SHOWN = 5;
const TOP_SHOWN = 10;

let token = null; // { value, until }

/** The login from a name, `@name` or a twitch.tv link, or null. */
function parseChannel(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.|m\.)?twitch\.tv\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  return LOGIN.test(text) ? text.toLowerCase() : null;
}

async function requestToken() {
  const body = await fetchJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.twitchClientId, client_secret: config.twitchClientSecret, grant_type: 'client_credentials' }).toString(),
  });
  if (!body?.access_token) throw new IntegrationError('unavailable');
  token = { value: body.access_token, until: Date.now() + Math.max(60, Number(body.expires_in) - 60) * 1000 };
  return token.value;
}

let pending = null; // two calls at the same moment share one request for the token

/** The app token (it lasts weeks; it is asked again a minute before it ends). */
async function appToken(force = false) {
  if (!config.twitchClientId || !config.twitchClientSecret) throw new IntegrationError('notConfigured');
  if (!force && token && token.until > Date.now()) return token.value;
  pending ??= requestToken().finally(() => { pending = null; });
  return pending;
}

async function helix(path, retry = true) {
  const value = await appToken();
  try {
    return await fetchJson(`${HELIX}${path}`, { headers: { Authorization: `Bearer ${value}`, 'Client-Id': config.twitchClientId } });
  } catch (error) {
    // The token was refused (it was revoked or the secret changed): ask for another one once.
    if (retry && error instanceof IntegrationError && String(error.message).includes('401')) {
      await appToken(true);
      return helix(path, false);
    }
    throw error;
  }
}

/** The streams with the most viewers now (Twitch lists them by viewers when no channel is asked for). */
async function topStreams() {
  if (!config.twitchClientId || !config.twitchClientSecret) throw new IntegrationError('notConfigured');
  return cached('twitch:top', CACHE_MS, async () => (await helix(`/streams?first=${TOP_SHOWN}`))?.data ?? []);
}

/** The channel and, when it is live, its stream: { user, stream }. */
async function findChannel(login) {
  if (!config.twitchClientId || !config.twitchClientSecret) throw new IntegrationError('notConfigured');
  return cached(`twitch:${login}`, CACHE_MS, async () => {
    const [users, streams] = await Promise.all([
      helix(`/users?login=${encodeURIComponent(login)}`),
      helix(`/streams?user_login=${encodeURIComponent(login)}`),
    ]);
    const user = users?.data?.[0];
    if (!user) throw new IntegrationError('notFound');
    return { user, stream: streams?.data?.[0] ?? null };
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('twitch')
    .setDescription('Look up a Twitch channel, its clips, or what is most watched now.')
    .addSubcommand((s) => s
      .setName('channel')
      .setDescription('See if a channel is live, what it plays and how many are watching.')
      .addStringOption((o) => o.setName('channel').setDescription('The channel name or the link to the channel').setMaxLength(100).setRequired(true)))
    .addSubcommand((s) => s
      .setName('clips')
      .setDescription('The most watched clips of a channel.')
      .addStringOption((o) => o.setName('channel').setDescription('The channel name or the link to the channel').setMaxLength(100).setRequired(true)))
    .addSubcommand((s) => s.setName('top').setDescription('The streams with the most viewers right now.')),

  // `!twitch ibai` is the channel.
  prefixDefaultSubcommand: (tokens) => (tokens.length ? 'channel' : null),
  prefixSubcommandAliases: { live: 'channel', stream: 'channel', clip: 'clips', popular: 'top', trending: 'top' },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    await lookup(interaction, lang, 'Twitch', async () => {
      if (sub === 'top') {
        const top = await topStreams();
        if (!top.length) return noticePayload(t(lang, 'integrations.twitch.nobody'), COLORS.RED);
        return infoPayload({
          accent: null,
          title: t(lang, 'integrations.twitch.topTitle'),
          sections: [{ lines: top.map((stream, index) => `**${index + 1}.** [${plain(stream.user_name, 40)}](https://www.twitch.tv/${encodeURIComponent(stream.user_login)}) · ${plain(stream.game_name || '—', 50)} · ${tn(lang, 'integrations.twitch.viewerCount', Number(stream.viewer_count))}`), limit: 1500 }], // i18n-ignore: a list of links
          footer: 'Twitch', // i18n-ignore: a brand name
          buttons: [{ label: t(lang, 'integrations.twitch.browse'), url: 'https://www.twitch.tv/directory' }],
        });
      }
      const login = parseChannel(interaction.options.getString('channel', true));
      if (!login) throw new IntegrationError('badInput');
      const { user, stream } = await findChannel(login);
      if (sub === 'clips') {
        const clips = await cached(`twitch:clips:${user.id}`, 5 * 60_000, async () => (await helix(`/clips?broadcaster_id=${encodeURIComponent(user.id)}&first=${CLIPS_SHOWN}`))?.data ?? []);
        if (!clips.length) return noticePayload(t(lang, 'integrations.twitch.noClips', { name: plain(user.display_name, 40) }), COLORS.RED);
        return infoPayload({
          accent: null,
          title: t(lang, 'integrations.twitch.clipsTitle', { name: plain(user.display_name, 40) }),
          thumbnail: user.profile_image_url,
          banner: clips[0].thumbnail_url,
          sections: [{ lines: clips.map((clip, index) => `**${index + 1}.** [${plain(clip.title, 80)}](${clip.url}) · ${tn(lang, 'integrations.twitch.viewCount', Number(clip.view_count))} · ${plain(clip.creator_name, 30)} · ${dateTag(clip.created_at, 'R')}`), limit: 1500 }],
          footer: 'Twitch', // i18n-ignore: a brand name
          buttons: [{ label: t(lang, 'integrations.twitch.open'), url: `https://www.twitch.tv/${user.login}/clips` }],
        });
      }
      const kind = { partner: 'partner', affiliate: 'affiliate' }[user.broadcaster_type];
      const preview = stream?.thumbnail_url ? stream.thumbnail_url.replace('{width}', '640').replace('{height}', '360') : null;
      return infoPayload({
        accent: null,
        title: user.display_name,
        subtitle: stream ? [`**${t(lang, 'integrations.twitch.live')}** · ${plain(stream.title, 200)}`] : [t(lang, 'integrations.twitch.offline')],
        thumbnail: user.profile_image_url,
        banner: preview ? `${preview}?t=${Math.floor(Date.now() / 60_000)}` : null,
        sections: [
          stream
            ? {
              lines: [
                stream.game_name ? row(t(lang, 'integrations.twitch.playing'), plain(stream.game_name, 80)) : null,
                row(t(lang, 'integrations.twitch.viewers'), formatNumber(lang, stream.viewer_count)),
                row(t(lang, 'integrations.twitch.started'), dateTag(stream.started_at, 'R')),
                stream.language ? row(t(lang, 'integrations.twitch.language'), stream.language.toUpperCase()) : null,
              ],
            }
            : null,
          {
            lines: [
              kind ? row(t(lang, 'integrations.twitch.type'), t(lang, `integrations.twitch.${kind}`)) : null,
              row(t(lang, 'integrations.twitch.created'), dateTag(user.created_at)),
              user.description ? plain(user.description, 300) : null,
            ],
          },
        ].filter(Boolean),
        footer: 'Twitch', // i18n-ignore: a brand name
        buttons: [{ label: t(lang, 'integrations.twitch.open'), url: `https://www.twitch.tv/${user.login}` }],
      });
    }, COOLDOWN);
  },
};

module.exports.parseChannel = parseChannel;
module.exports.findChannel = findChannel;
module.exports.resetToken = () => { token = null; };
