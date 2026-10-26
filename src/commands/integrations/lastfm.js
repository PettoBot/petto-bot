const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config');
const lastfmLinks = require('../../db/lastfmLinks');
const { infoPayload, noticePayload } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');
const { IntegrationError, fetchJson, cached, lookup, row, plain, dateTag } = require('../../utils/integrations');
const { t, tn, formatNumber, languageOf } = require('../../i18n');

const API = 'https://ws.audioscrobbler.com/2.0/';
const CACHE_MS = 30_000;
const COOLDOWN = { name: 'lastfm', ms: 3000 };
const USERNAME = /^[a-z][\w-]{1,14}$/i;
const PERIODS = ['7day', '1month', '3month', '6month', '12month', 'overall'];
const TOP_SHOWN = 10;
const RECENT_SHOWN = 10;
// The picture Last.fm gives to what has none.
const NO_PICTURE = /2a96cbd8b46e442fc41c2b86b821562f/;

const PERIOD_WORDS = {
  '7day': '7day', '7d': '7day', week: '7day',
  '1month': '1month', month: '1month', '1m': '1month', '30d': '1month',
  '3month': '3month', '3m': '3month', quarter: '3month',
  '6month': '6month', '6m': '6month', halfyear: '6month',
  '12month': '12month', '12m': '12month', year: '12month', '1y': '12month',
  overall: 'overall', all: 'overall', alltime: 'overall', forever: 'overall',
};

/** The period Last.fm understands from what was typed (`7day`, `week`, `3 months`, `all time`...); a month when it is not one. */
function normalizePeriod(text) {
  const key = String(text ?? '').toLowerCase().replace(/[\s_-]+/g, '').replace(/s$/, '');
  return PERIOD_WORDS[key] ?? '1month';
}

/** The Last.fm name from what was typed (a name or a last.fm/user/ link), or null. */
function parseUsername(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.)?last\.fm\/(?:[a-z-]+\/)?user\//i, '').split(/[/?#]/)[0];
  return USERNAME.test(text) ? text : null;
}

/** Calls the Last.fm API and turns its errors into the kinds of the lookups. */
async function fm(method, params) {
  if (!config.lastfmApiKey) throw new IntegrationError('notConfigured');
  let body;
  try {
    body = await fetchJson(`${API}?${new URLSearchParams({ method, ...params, api_key: config.lastfmApiKey, format: 'json' })}`);
  } catch (error) {
    if (error instanceof IntegrationError && error.body?.error) throw errorOf(error.body.error);
    throw error;
  }
  if (body?.error) throw errorOf(body.error);
  return body;
}

function errorOf(code) {
  if (code === 6) return new IntegrationError('notFound');
  if (code === 17) return new IntegrationError('private');
  if (code === 29) return new IntegrationError('rateLimited');
  if (code === 10 || code === 26) return new IntegrationError('notConfigured');
  return new IntegrationError('unavailable', `lastfm ${code}`);
}

const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const pictureOf = (images) => {
  const url = [...asList(images)].reverse().map((image) => image?.['#text']).find((text) => text && !NO_PICTURE.test(text));
  return url ?? null;
};

const getProfile = (username) => cached(`fm:info:${username.toLowerCase()}`, CACHE_MS, async () => (await fm('user.getinfo', { user: username })).user);

/** Who to look up: the member that was given, or the one who asked; null when they have not linked a name. */
async function targetOf(interaction) {
  const member = interaction.options.getUser('user') ?? interaction.user;
  return { member, username: await lastfmLinks.getLink(member.id) };
}

module.exports = {
  aliases: ['lfm'],
  data: new SlashCommandBuilder()
    .setName('lastfm')
    .setDescription('Show what you listen to on Last.fm: now playing, recent tracks and your tops.')
    .addSubcommand((s) => s
      .setName('link')
      .setDescription('Link your Last.fm name to your Discord account.')
      .addStringOption((o) => o.setName('username').setDescription('Your Last.fm username or the link to your profile').setMaxLength(100).setRequired(true)))
    .addSubcommand((s) => s.setName('unlink').setDescription('Forget your linked Last.fm name.'))
    .addSubcommand((s) => s
      .setName('now')
      .setDescription('What someone is listening to now, or the last song they played.')
      .addUserOption((o) => o.setName('user').setDescription('The member (default: you)').setRequired(false)))
    .addSubcommand((s) => s
      .setName('recent')
      .setDescription('The last songs someone played.')
      .addUserOption((o) => o.setName('user').setDescription('The member (default: you)').setRequired(false)))
    .addSubcommand((s) => s
      .setName('profile')
      .setDescription('The Last.fm profile of someone: songs played and since when.')
      .addUserOption((o) => o.setName('user').setDescription('The member (default: you)').setRequired(false)))
    .addSubcommand((s) => s
      .setName('topartists')
      .setDescription('The artists someone listens to most.')
      .addUserOption((o) => o.setName('user').setDescription('The member (default: you)').setRequired(false))
      .addStringOption((o) => o.setName('period').setDescription('How far back: week, month, 3 months, 6 months, year or all (default: a month)').setMaxLength(20).setRequired(false)))
    .addSubcommand((s) => s
      .setName('toptracks')
      .setDescription('The songs someone listens to most.')
      .addUserOption((o) => o.setName('user').setDescription('The member (default: you)').setRequired(false))
      .addStringOption((o) => o.setName('period').setDescription('How far back: week, month, 3 months, 6 months, year or all (default: a month)').setMaxLength(20).setRequired(false))),

  // `!lfm` alone, or with a member (`!lfm @liam`), is `now`.
  prefixDefaultSubcommand: (tokens) => (!tokens.length || /^<@!?\d+>$|^\d{15,25}$/.test(tokens[0]) ? 'now' : null),

  // The short words people type after the command: `!lastfm songs`, `!lastfm me`...
  prefixSubcommandAliases: { np: 'now', playing: 'now', last: 'recent', me: 'profile', artists: 'topartists', top: 'topartists', tracks: 'toptracks', songs: 'toptracks' },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    const number = (value) => formatNumber(lang, Number(value ?? 0));

    if (sub === 'unlink') {
      const removed = await lastfmLinks.removeLink(interaction.user.id);
      await interaction.reply(noticePayload(t(lang, removed ? 'integrations.lastfm.unlinked' : 'integrations.lastfm.notLinkedSelf'), removed ? COLORS.GREEN : COLORS.RED));
      return;
    }

    await lookup(interaction, lang, 'Last.fm', async () => {
      if (sub === 'link') {
        const username = parseUsername(interaction.options.getString('username', true));
        if (!username) throw new IntegrationError('badInput');
        const user = await getProfile(username);
        await lastfmLinks.setLink(interaction.user.id, user.name);
        return noticePayload(t(lang, 'integrations.lastfm.linked', { name: plain(user.name, 40) }), COLORS.GREEN);
      }

      const { member, username } = await targetOf(interaction);
      if (!username) {
        return noticePayload(t(lang, member.id === interaction.user.id ? 'integrations.lastfm.notLinkedSelf' : 'integrations.lastfm.notLinkedOther', { name: member.displayName ?? member.username }), COLORS.RED);
      }
      const profileUrl = `https://www.last.fm/user/${encodeURIComponent(username)}`;
      const open = [{ label: t(lang, 'integrations.lastfm.open'), url: profileUrl }];

      if (sub === 'profile') {
        const user = await getProfile(username);
        return infoPayload({
          accent: null,
          title: plain(user.realname || user.name, 80),
          subtitle: [`@${plain(user.name, 40)}`],
          thumbnail: pictureOf(user.image),
          sections: [{
            lines: [
              row(t(lang, 'integrations.lastfm.scrobbles'), number(user.playcount)),
              row(t(lang, 'integrations.lastfm.artists'), number(user.artist_count)),
              row(t(lang, 'integrations.lastfm.tracks'), number(user.track_count)),
              user.registered?.unixtime ? row(t(lang, 'integrations.lastfm.since'), dateTag(Number(user.registered.unixtime) * 1000)) : null,
              user.country && user.country !== 'None' ? row(t(lang, 'integrations.lastfm.country'), plain(user.country, 40)) : null,
            ],
          }],
          footer: 'Last.fm',
          buttons: open,
        });
      }

      if (sub === 'now' || sub === 'recent') {
        const limit = sub === 'now' ? 1 : RECENT_SHOWN;
        const body = await cached(`fm:recent:${username.toLowerCase()}:${limit}`, 15_000, () => fm('user.getrecenttracks', { user: username, limit: String(limit) }));
        const tracks = asList(body?.recenttracks?.track);
        if (!tracks.length) return noticePayload(t(lang, 'integrations.lastfm.nothing', { name: plain(username, 40) }), COLORS.RED);
        const describe = (track) => `**${plain(track.name, 100)}** — ${plain(track.artist?.['#text'] ?? track.artist?.name, 80)}`;
        const playing = (track) => track?.['@attr']?.nowplaying === 'true';

        if (sub === 'now') {
          const [track] = tracks;
          const album = track.album?.['#text'];
          return infoPayload({
            accent: null,
            title: describe(track),
            subtitle: [playing(track) ? `**${t(lang, 'integrations.lastfm.playingNow')}**` : t(lang, 'integrations.lastfm.lastPlayed', { when: dateTag(Number(track.date?.uts) * 1000, 'R') ?? '' })],
            thumbnail: pictureOf(track.image),
            sections: [{ lines: [album ? row(t(lang, 'integrations.lastfm.album'), plain(album, 100)) : null, row(t(lang, 'integrations.lastfm.listener'), `@${plain(username, 40)}`)] }],
            footer: 'Last.fm',
            buttons: [...(track.url ? [{ label: t(lang, 'integrations.lastfm.openTrack'), url: track.url }] : []), ...open],
          });
        }

        return infoPayload({
          accent: null,
          title: t(lang, 'integrations.lastfm.recentTitle', { name: plain(username, 40) }),
          thumbnail: pictureOf(tracks[0].image),
          sections: [{ lines: tracks.map((track) => `${playing(track) ? '▶ ' : ''}${describe(track)}${playing(track) || !track.date?.uts ? '' : ` · ${dateTag(Number(track.date.uts) * 1000, 'R')}`}`) }],
          footer: 'Last.fm',
          buttons: open,
        });
      }

      const period = normalizePeriod(interaction.options.getString('period'));
      const artists = sub === 'topartists';
      const body = await cached(`fm:${sub}:${username.toLowerCase()}:${period}`, 5 * 60_000, () => fm(artists ? 'user.gettopartists' : 'user.gettoptracks', { user: username, period, limit: String(TOP_SHOWN) }));
      const list = asList(artists ? body?.topartists?.artist : body?.toptracks?.track);
      if (!list.length) return noticePayload(t(lang, 'integrations.lastfm.nothing', { name: plain(username, 40) }), COLORS.RED);
      const lines = list.map((entry, index) => {
        const plays = tn(lang, 'integrations.lastfm.plays', Number(entry.playcount));
        return artists ? `**${index + 1}.** ${plain(entry.name, 80)} · ${plays}` : `**${index + 1}.** **${plain(entry.name, 100)}** — ${plain(entry.artist?.name, 80)} · ${plays}`;
      });
      return infoPayload({
        accent: null,
        title: t(lang, artists ? 'integrations.lastfm.topArtistsTitle' : 'integrations.lastfm.topTracksTitle', { name: plain(username, 40) }),
        subtitle: [t(lang, `integrations.lastfm.period.${period}`)],
        sections: [{ lines }],
        footer: 'Last.fm',
        buttons: open,
      });
    }, COOLDOWN);
  },
};

module.exports.parseUsername = parseUsername;
module.exports.errorOf = errorOf;
module.exports.PERIODS = PERIODS;
module.exports.normalizePeriod = normalizePeriod;
