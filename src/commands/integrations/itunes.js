const { SlashCommandBuilder } = require('discord.js');
const { infoPayload } = require('../../utils/infoCard');
const { songPayload } = require('../../utils/songPayload');
const { IntegrationError, fetchJson, cached, lookup, row, plain, clock, dateTag } = require('../../utils/integrations');
const { t, formatNumber, formatDecimal, languageOf } = require('../../i18n');

const API = 'https://itunes.apple.com/search';
const CACHE_MS = 10 * 60_000;
const COOLDOWN = { name: 'itunes', ms: 3000 };
const RESULTS = 5;

// What each subcommand asks Apple for.
const KINDS = {
  song: { media: 'music', entity: 'song' },
  album: { media: 'music', entity: 'album' },
  artist: { media: 'music', entity: 'musicArtist' },
  app: { media: 'software', entity: 'software' },
  podcast: { media: 'podcast', entity: 'podcast' },
};

const search = (kind, query) => cached(`it:${kind}:${query.toLowerCase()}`, CACHE_MS, async () => {
  const params = new URLSearchParams({ term: query, ...KINDS[kind], limit: String(RESULTS), country: 'US' });
  const body = await fetchJson(`${API}?${params}`);
  const found = body?.results ?? [];
  if (!found.length) throw new IntegrationError('notFound');
  return found;
});

/** Apple gives a 100 pixel picture; the same file exists bigger when the size in its name is changed. */
const bigger = (url, size = 600) => (url ? String(url).replace(/\/\d+x\d+(bb|-\d+)?\.(jpg|png)$/i, `/${size}x${size}bb.$2`) : null);
const stripHtml = (text) => String(text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

module.exports = {
  aliases: ['apple'],
  data: new SlashCommandBuilder()
    .setName('itunes')
    .setDescription('Look up a song, album, artist, app or podcast on Apple.')
    .addSubcommand((s) => s
      .setName('song')
      .setDescription('A song, with a 30 second preview and other results.')
      .addStringOption((o) => o.setName('query').setDescription('Song and artist, for example creep radiohead').setMaxLength(100).setRequired(true)))
    .addSubcommand((s) => s
      .setName('album')
      .setDescription('An album: release date, genre and number of songs.')
      .addStringOption((o) => o.setName('query').setDescription('Album and artist').setMaxLength(100).setRequired(true)))
    .addSubcommand((s) => s
      .setName('artist')
      .setDescription('An artist and their main genre.')
      .addStringOption((o) => o.setName('query').setDescription('The name of the artist').setMaxLength(100).setRequired(true)))
    .addSubcommand((s) => s
      .setName('app')
      .setDescription('An app of the App Store: rating, price and description.')
      .addStringOption((o) => o.setName('query').setDescription('The name of the app').setMaxLength(100).setRequired(true)))
    .addSubcommand((s) => s
      .setName('podcast')
      .setDescription('A podcast: genre, episodes and the latest one.')
      .addStringOption((o) => o.setName('query').setDescription('The name of the podcast').setMaxLength(100).setRequired(true))),

  // `!itunes creep radiohead` is a song.
  prefixDefaultSubcommand: (tokens) => (tokens.length ? 'song' : null),
  prefixSubcommandAliases: { track: 'song', music: 'song', disc: 'album', band: 'artist', application: 'app', apps: 'app', game: 'app', pod: 'podcast', podcasts: 'podcast' },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    const query = interaction.options.getString('query', true).trim();
    await lookup(interaction, lang, 'Apple', async () => {
      if (!query) throw new IntegrationError('badInput');
      const [top, ...others] = await search(sub, query);
      const open = (url) => [{ label: t(lang, 'integrations.itunes.open'), url }];

      if (sub === 'song') {
        const buttons = open(top.trackViewUrl);
        if (top.previewUrl) buttons.unshift({ label: t(lang, 'integrations.deezer.preview'), url: top.previewUrl });
        return songPayload({
          title: top.trackName,
          artist: top.artistName,
          detail: top.collectionName,
          cover: bigger(top.artworkUrl100),
          sections: [
            {
              lines: [
                top.trackTimeMillis ? row(t(lang, 'integrations.deezer.length'), clock(top.trackTimeMillis / 1000)) : null,
                top.primaryGenreName ? row(t(lang, 'integrations.deezer.genre'), plain(top.primaryGenreName, 40)) : null,
                top.releaseDate ? row(t(lang, 'integrations.deezer.released'), dateTag(top.releaseDate)) : null,
                top.trackExplicitness === 'explicit' ? `-# ${t(lang, 'integrations.deezer.explicit')}` : null,
              ],
            },
            others.length ? { title: t(lang, 'integrations.deezer.more'), lines: others.map((other) => `[${plain(other.trackName, 70)}](${other.trackViewUrl}) — ${plain(other.artistName, 50)}`), limit: 1200 } : null,
          ].filter(Boolean),
          footer: 'Apple Music', // i18n-ignore: a brand name
          buttons,
        });
      }

      if (sub === 'album') {
        return songPayload({
          title: top.collectionName,
          artist: top.artistName,
          detail: top.releaseDate ? String(top.releaseDate).slice(0, 4) : '',
          cover: bigger(top.artworkUrl100),
          sections: [
            {
              lines: [
                top.releaseDate ? row(t(lang, 'integrations.deezer.released'), dateTag(top.releaseDate)) : null,
                top.primaryGenreName ? row(t(lang, 'integrations.deezer.genre'), plain(top.primaryGenreName, 40)) : null,
                top.trackCount ? row(t(lang, 'integrations.itunes.songs'), formatNumber(lang, top.trackCount)) : null,
                top.collectionExplicitness === 'explicit' ? `-# ${t(lang, 'integrations.deezer.explicit')}` : null,
              ],
            },
            others.length ? { title: t(lang, 'integrations.deezer.more'), lines: others.map((other) => `[${plain(other.collectionName, 70)}](${other.collectionViewUrl}) — ${plain(other.artistName, 50)}`), limit: 1200 } : null,
          ].filter(Boolean),
          footer: 'Apple Music', // i18n-ignore: a brand name
          buttons: open(top.collectionViewUrl),
        });
      }

      if (sub === 'artist') {
        return infoPayload({
          accent: null,
          title: plain(top.artistName, 100),
          sections: [{ lines: [top.primaryGenreName ? row(t(lang, 'integrations.deezer.genre'), plain(top.primaryGenreName, 40)) : null, others.length ? row(t(lang, 'integrations.itunes.alsoFound'), others.map((other) => plain(other.artistName, 40)).join(', ')) : null] }],
          footer: 'Apple Music', // i18n-ignore: a brand name
          buttons: open(top.artistLinkUrl ?? top.artistViewUrl),
        });
      }

      if (sub === 'app') {
        const price = top.formattedPrice ?? (top.price === 0 ? t(lang, 'integrations.itunes.free') : `${top.price} ${top.currency ?? ''}`);
        return infoPayload({
          accent: null,
          title: plain(top.trackName, 100),
          subtitle: [plain(top.sellerName ?? top.artistName, 80), plain(stripHtml(top.description), 350)].filter(Boolean),
          thumbnail: top.artworkUrl512 ?? top.artworkUrl100,
          sections: [{
            lines: [
              top.averageUserRating ? row(t(lang, 'integrations.itunes.rating'), `${formatDecimal(lang, top.averageUserRating, 1)} ★ (${formatNumber(lang, top.userRatingCount ?? 0)})`) : null,
              row(t(lang, 'integrations.itunes.price'), plain(price, 30)),
              top.primaryGenreName ? row(t(lang, 'integrations.deezer.genre'), plain(top.primaryGenreName, 40)) : null,
              top.version ? row(t(lang, 'integrations.itunes.version'), plain(top.version, 20)) : null,
              top.contentAdvisoryRating ? row(t(lang, 'integrations.itunes.age'), plain(top.contentAdvisoryRating, 10)) : null,
              top.currentVersionReleaseDate ? row(t(lang, 'integrations.itunes.updated'), dateTag(top.currentVersionReleaseDate)) : null,
            ],
          }],
          footer: 'App Store', // i18n-ignore: a brand name
          buttons: open(top.trackViewUrl),
        });
      }

      return infoPayload({
        accent: null,
        title: plain(top.collectionName ?? top.trackName, 120),
        subtitle: [plain(top.artistName, 80)],
        thumbnail: bigger(top.artworkUrl600 ?? top.artworkUrl100),
        sections: [{
          lines: [
            top.primaryGenreName ? row(t(lang, 'integrations.deezer.genre'), plain(top.primaryGenreName, 40)) : null,
            top.trackCount ? row(t(lang, 'integrations.itunes.episodes'), formatNumber(lang, top.trackCount)) : null,
            top.releaseDate ? row(t(lang, 'integrations.itunes.latest'), dateTag(top.releaseDate)) : null,
          ],
        }],
        footer: 'Apple Podcasts', // i18n-ignore: a brand name
        buttons: open(top.collectionViewUrl ?? top.trackViewUrl),
      });
    }, COOLDOWN);
  },
};

module.exports.bigger = bigger;
