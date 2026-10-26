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
const WHOKNOWS_MAX = 30;
const WHOKNOWS_BATCH = 5;
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

/** About an artist, with how many times `username` played them when a name is given (Last.fm corrects the spelling of the artist). */
const artistInfo = (name, username) => cached(`fm:artist:${name.toLowerCase()}:${(username ?? '').toLowerCase()}`, 5 * 60_000, async () => {
  const body = await fm('artist.getinfo', { artist: name, autocorrect: '1', ...(username ? { username } : {}) });
  if (!body?.artist?.name) throw new IntegrationError('notFound');
  return body.artist;
});

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
      .addStringOption((o) => o.setName('period').setDescription('How far back: week, month, 3 months, 6 months, year or all (default: a month)').setMaxLength(20).setRequired(false)))
    .addSubcommand((s) => s
      .setName('topalbums')
      .setDescription('The albums someone listens to most.')
      .addUserOption((o) => o.setName('user').setDescription('The member (default: you)').setRequired(false))
      .addStringOption((o) => o.setName('period').setDescription('How far back: week, month, 3 months, 6 months, year or all (default: a month)').setMaxLength(20).setRequired(false)))
    .addSubcommand((s) => s
      .setName('artist')
      .setDescription('About an artist: listeners, plays, tags and similar artists, and how many times you played them.')
      .addStringOption((o) => o.setName('name').setDescription('The name of the artist').setMaxLength(100).setRequired(true)))
    .addSubcommand((s) => s
      .setName('compare')
      .setDescription('How alike your music is with another member who linked Last.fm.')
      .addUserOption((o) => o.setName('user').setDescription('The member to compare with').setRequired(true)))
    .addSubcommand((s) => s
      .setName('whoknows')
      .setDescription('Who in this server listens to an artist the most (default: the one you are playing).')
      .addStringOption((o) => o.setName('artist').setDescription('The name of the artist').setMaxLength(100).setRequired(false))),

  // `!lfm` alone, or with a member (`!lfm @liam`), is `now`.
  prefixDefaultSubcommand: (tokens) => (!tokens.length || /^<@!?\d+>$|^\d{15,25}$/.test(tokens[0]) ? 'now' : null),

  // The short words people type after the command: `!lastfm songs`, `!lastfm me`...
  prefixSubcommandAliases: { np: 'now', playing: 'now', last: 'recent', me: 'profile', artists: 'topartists', top: 'topartists', tracks: 'toptracks', songs: 'toptracks', albums: 'topalbums', info: 'artist', match: 'compare', taste: 'compare', wk: 'whoknows', who: 'whoknows' },

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

      if (sub === 'artist') {
        const asked = interaction.options.getString('name', true).trim();
        if (!asked) throw new IntegrationError('badInput');
        const mine = await lastfmLinks.getLink(interaction.user.id);
        const info = await artistInfo(asked, mine);
        const tags = asList(info.tags?.tag).slice(0, 5).map((tag) => `\`${plain(tag.name, 30)}\``).join(' ');
        const similar = asList(info.similar?.artist).slice(0, 5).map((artist) => plain(artist.name, 40)).join(', ');
        const bio = String(info.bio?.summary ?? '').replace(/<a [^>]*>.*?<\/a>/gis, '').replace(/<[^>]+>/g, '').trim();
        return infoPayload({
          accent: null,
          title: plain(info.name, 100),
          subtitle: bio ? [plain(bio, 400)] : [],
          thumbnail: pictureOf(info.image),
          sections: [{
            lines: [
              row(t(lang, 'integrations.lastfm.listeners'), number(info.stats?.listeners)),
              row(t(lang, 'integrations.lastfm.scrobbles'), number(info.stats?.playcount)),
              mine && info.stats?.userplaycount !== undefined ? row(t(lang, 'integrations.lastfm.yourPlays'), number(info.stats.userplaycount)) : null,
              tags ? row(t(lang, 'integrations.lastfm.tags'), tags) : null,
              similar ? row(t(lang, 'integrations.lastfm.similar'), similar) : null,
            ],
          }],
          footer: 'Last.fm',
          buttons: [{ label: t(lang, 'integrations.lastfm.openArtist'), url: info.url ?? `https://www.last.fm/music/${encodeURIComponent(info.name)}` }],
        });
      }

      if (sub === 'compare') {
        const other = interaction.options.getUser('user', true);
        const links = await lastfmLinks.getLinks([interaction.user.id, other.id]);
        const mine = links.get(interaction.user.id);
        const theirs = links.get(other.id);
        if (!mine) return noticePayload(t(lang, 'integrations.lastfm.notLinkedSelf'), COLORS.RED);
        if (!theirs) return noticePayload(t(lang, 'integrations.lastfm.notLinkedOther', { name: other.displayName ?? other.username }), COLORS.RED);
        if (mine.toLowerCase() === theirs.toLowerCase()) return noticePayload(t(lang, 'integrations.lastfm.compareSelf'), COLORS.RED);
        const body = await cached(`fm:taste:${mine.toLowerCase()}:${theirs.toLowerCase()}`, 5 * 60_000, () => fm('tasteometer.compare', { type1: 'user', type2: 'user', value1: mine, value2: theirs, limit: '5' }));
        const result = body?.comparison?.result;
        const score = Math.round(Number(result?.score ?? 0) * 100);
        const filled = Math.round(score / 10);
        const common = asList(result?.artists?.artist).map((artist) => plain(artist.name, 40));
        return infoPayload({
          accent: null,
          title: t(lang, 'integrations.lastfm.compareTitle', { a: plain(mine, 30), b: plain(theirs, 30) }),
          subtitle: [`**${score}%** ${t(lang, 'integrations.lastfm.compatible')}`],
          sections: [{ lines: [`${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)}`, common.length ? row(t(lang, 'integrations.lastfm.inCommon'), common.join(', ')) : `-# ${t(lang, 'integrations.lastfm.noCommon')}`] }],
          footer: 'Last.fm',
        });
      }

      if (sub === 'whoknows') {
        if (!interaction.guild) return noticePayload(t(lang, 'integrations.lastfm.serverOnly'), COLORS.RED);
        let asked = interaction.options.getString('artist')?.trim();
        if (!asked) {
          const mine = await lastfmLinks.getLink(interaction.user.id);
          if (!mine) return noticePayload(t(lang, 'integrations.lastfm.notLinkedSelf'), COLORS.RED);
          const recent = await fm('user.getrecenttracks', { user: mine, limit: '1' });
          const [track] = asList(recent?.recenttracks?.track);
          asked = track?.artist?.['#text'] ?? track?.artist?.name;
          if (!asked) return noticePayload(t(lang, 'integrations.lastfm.nothing', { name: plain(mine, 40) }), COLORS.RED);
        }
        const links = await lastfmLinks.getLinks([...interaction.guild.members.cache.keys()]);
        if (!links.size) return noticePayload(t(lang, 'integrations.lastfm.nobodyLinked'), COLORS.RED);
        const entries = [...links.entries()].slice(0, WHOKNOWS_MAX);
        const info = await artistInfo(asked, null);
        const counts = [];
        for (let i = 0; i < entries.length; i += WHOKNOWS_BATCH) {
          const batch = await Promise.all(entries.slice(i, i + WHOKNOWS_BATCH).map(async ([id, name]) => {
            const own = await artistInfo(info.name, name).catch(() => null);
            return { id, plays: Number(own?.stats?.userplaycount ?? 0) };
          }));
          counts.push(...batch);
        }
        const ranked = counts.filter((entry) => entry.plays > 0).sort((a, b) => b.plays - a.plays).slice(0, 10);
        if (!ranked.length) return noticePayload(t(lang, 'integrations.lastfm.nobodyKnows', { artist: plain(info.name, 60) }), COLORS.RED);
        return infoPayload({
          accent: null,
          title: t(lang, 'integrations.lastfm.whoKnowsTitle', { artist: plain(info.name, 60) }),
          thumbnail: pictureOf(info.image),
          sections: [{ lines: ranked.map((entry, index) => `**${index + 1}.** <@${entry.id}> · ${tn(lang, 'integrations.lastfm.plays', entry.plays)}`), limit: 1500 }],
          footer: 'Last.fm',
          buttons: [{ label: t(lang, 'integrations.lastfm.openArtist'), url: info.url ?? `https://www.last.fm/music/${encodeURIComponent(info.name)}` }],
        });
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
      const kind = { topartists: 'artist', toptracks: 'track', topalbums: 'album' }[sub];
      const method = { artist: 'user.gettopartists', track: 'user.gettoptracks', album: 'user.gettopalbums' }[kind];
      const body = await cached(`fm:${sub}:${username.toLowerCase()}:${period}`, 5 * 60_000, () => fm(method, { user: username, period, limit: String(TOP_SHOWN) }));
      const list = asList(body?.[`top${kind}s`]?.[kind]);
      if (!list.length) return noticePayload(t(lang, 'integrations.lastfm.nothing', { name: plain(username, 40) }), COLORS.RED);
      const lines = list.map((entry, index) => {
        const plays = tn(lang, 'integrations.lastfm.plays', Number(entry.playcount));
        return kind === 'artist' ? `**${index + 1}.** ${plain(entry.name, 80)} · ${plays}` : `**${index + 1}.** **${plain(entry.name, 100)}** — ${plain(entry.artist?.name, 80)} · ${plays}`;
      });
      return infoPayload({
        accent: null,
        title: t(lang, { artist: 'integrations.lastfm.topArtistsTitle', track: 'integrations.lastfm.topTracksTitle', album: 'integrations.lastfm.topAlbumsTitle' }[kind], { name: plain(username, 40) }),
        subtitle: [t(lang, `integrations.lastfm.period.${period}`)],
        thumbnail: kind === 'album' ? pictureOf(list[0]?.image) : null,
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
