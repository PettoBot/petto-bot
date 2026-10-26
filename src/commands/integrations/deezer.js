const { SlashCommandBuilder } = require('discord.js');
const { infoPayload } = require('../../utils/infoCard');
const { IntegrationError, fetchJson, cached, lookup, row, plain, clock, dateTag } = require('../../utils/integrations');
const { t, formatNumber, languageOf } = require('../../i18n');

const API = 'https://api.deezer.com';
const CACHE_MS = 10 * 60_000;
const COOLDOWN = { name: 'deezer', ms: 3000 };
const SEARCH_RESULTS = 5;
const TRACKS_SHOWN = 10;

const search = (kind, query) => cached(`dz:${kind}:${query.toLowerCase()}`, CACHE_MS, async () => {
  const body = await fetchJson(`${API}/search/${kind}?q=${encodeURIComponent(query)}&limit=${SEARCH_RESULTS}`);
  if (body?.error) throw new IntegrationError('unavailable');
  const found = body?.data ?? [];
  if (!found.length) throw new IntegrationError('notFound');
  return found;
});

const get = (path) => cached(`dz:get:${path}`, CACHE_MS, async () => {
  const body = await fetchJson(`${API}${path}`);
  if (body?.error) throw new IntegrationError(body.error.code === 800 ? 'notFound' : 'unavailable');
  return body;
});

module.exports = {
  aliases: ['dz'],
  data: new SlashCommandBuilder()
    .setName('deezer')
    .setDescription('Look up a song, an artist or an album on Deezer.')
    .addSubcommand((s) => s
      .setName('track')
      .setDescription('A song, with a 30 second preview and other results.')
      .addStringOption((o) => o.setName('query').setDescription('Song and artist, for example creep radiohead').setMaxLength(100).setRequired(true)))
    .addSubcommand((s) => s
      .setName('artist')
      .setDescription('An artist: fans, albums and their most played songs.')
      .addStringOption((o) => o.setName('query').setDescription('The name of the artist').setMaxLength(100).setRequired(true)))
    .addSubcommand((s) => s
      .setName('album')
      .setDescription('An album: release date, genre and track list.')
      .addStringOption((o) => o.setName('query').setDescription('Album and artist, for example ok computer radiohead').setMaxLength(100).setRequired(true))),

  // `!deezer creep radiohead` is a song.
  prefixDefaultSubcommand: (tokens) => (tokens.length ? 'track' : null),
  prefixSubcommandAliases: { song: 'track', songs: 'track', s: 'track', band: 'artist', singer: 'artist', a: 'artist', disc: 'album', record: 'album' },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    const query = interaction.options.getString('query', true).trim();
    const number = (value) => formatNumber(lang, Number(value ?? 0));
    await lookup(interaction, lang, 'Deezer', async () => {
      if (!query) throw new IntegrationError('badInput');

      if (sub === 'track') {
        const [top, ...others] = await search('track', query);
        const buttons = [{ label: t(lang, 'integrations.deezer.open'), url: top.link }];
        if (top.preview) buttons.unshift({ label: t(lang, 'integrations.deezer.preview'), url: top.preview });
        return infoPayload({
          accent: null,
          title: plain(top.title, 120),
          subtitle: [`${plain(top.artist?.name, 80)} · ${plain(top.album?.title, 80)}`],
          banner: top.album?.cover_xl ?? top.album?.cover_big ?? null,
          sections: [
            {
              lines: [
                row(t(lang, 'integrations.deezer.length'), clock(top.duration)),
                top.rank ? row(t(lang, 'integrations.deezer.popularity'), number(top.rank)) : null,
                top.explicit_lyrics ? `-# ${t(lang, 'integrations.deezer.explicit')}` : null,
              ],
            },
            others.length ? { title: t(lang, 'integrations.deezer.more'), lines: others.map((other) => `[${plain(other.title, 70)}](${other.link}) — ${plain(other.artist?.name, 50)}`), limit: 1200 } : null,
          ].filter(Boolean),
          footer: 'Deezer', // i18n-ignore: a brand name
          buttons,
        });
      }

      if (sub === 'artist') {
        const [found] = await search('artist', query);
        const [artist, top] = await Promise.all([get(`/artist/${found.id}`), get(`/artist/${found.id}/top?limit=5`).catch(() => null)]);
        const songs = (top?.data ?? []).map((track, index) => `**${index + 1}.** [${plain(track.title, 70)}](${track.link}) · ${clock(track.duration)}`);
        return infoPayload({
          accent: null,
          title: plain(artist.name, 100),
          thumbnail: artist.picture_xl ?? artist.picture_big ?? null,
          sections: [
            { lines: [row(t(lang, 'integrations.deezer.fans'), number(artist.nb_fan)), artist.nb_album !== undefined ? row(t(lang, 'integrations.deezer.albums'), number(artist.nb_album)) : null] },
            songs.length ? { title: t(lang, 'integrations.deezer.topSongs'), lines: songs, limit: 1200 } : null,
          ].filter(Boolean),
          footer: 'Deezer', // i18n-ignore: a brand name
          buttons: [{ label: t(lang, 'integrations.deezer.open'), url: artist.link }],
        });
      }

      const [found] = await search('album', query);
      const album = await get(`/album/${found.id}`);
      const tracks = (album.tracks?.data ?? []).slice(0, TRACKS_SHOWN).map((track, index) => `**${index + 1}.** ${plain(track.title, 70)} · ${clock(track.duration)}`);
      const more = Math.max(0, Number(album.nb_tracks ?? 0) - tracks.length);
      const genres = (album.genres?.data ?? []).map((genre) => plain(genre.name, 30)).join(', ');
      return infoPayload({
        accent: null,
        title: plain(album.title, 120),
        subtitle: [plain(album.artist?.name, 80)],
        banner: album.cover_xl ?? album.cover_big ?? null,
        sections: [
          {
            lines: [
              album.release_date ? row(t(lang, 'integrations.deezer.released'), dateTag(album.release_date)) : null,
              genres ? row(t(lang, 'integrations.deezer.genre'), genres) : null,
              album.label ? row(t(lang, 'integrations.deezer.label'), plain(album.label, 60)) : null,
              album.duration ? row(t(lang, 'integrations.deezer.length'), clock(album.duration)) : null,
              album.fans !== undefined ? row(t(lang, 'integrations.deezer.fans'), number(album.fans)) : null,
            ],
          },
          tracks.length ? { title: t(lang, 'integrations.deezer.tracklist', { count: album.nb_tracks ?? tracks.length }), lines: [...tracks, ...(more ? [`-# ${t(lang, 'integrations.deezer.andMore', { count: more })}`] : [])], limit: 1500 } : null,
        ].filter(Boolean),
        footer: 'Deezer', // i18n-ignore: a brand name
        buttons: [{ label: t(lang, 'integrations.deezer.open'), url: album.link }],
      });
    }, COOLDOWN);
  },
};
