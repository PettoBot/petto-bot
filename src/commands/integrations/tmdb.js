const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config');
const { infoPayload } = require('../../utils/infoCard');
const { IntegrationError, fetchJson, cached, lookup, row, plain, short, dateTag } = require('../../utils/integrations');
const { t, formatNumber, formatDecimal, languageOf } = require('../../i18n');

const API = 'https://api.themoviedb.org/3';
const IMAGES = 'https://image.tmdb.org/t/p';
const CACHE_MS = 30 * 60_000;
const COOLDOWN = { name: 'tmdb', ms: 3000 };
// The language the texts of TMDB are asked in.
const TMDB_LANGUAGES = { en: 'en-US', es: 'es-MX', 'pt-BR': 'pt-BR' };

/** A call to TMDB. The key can be the v3 key (it goes in the address) or the v4 token (it goes in a header), whichever was set. */
function call(path, params) {
  if (!config.tmdbApiKey) throw new IntegrationError('notConfigured');
  const token = config.tmdbApiKey.length > 40;
  const query = new URLSearchParams({ ...params, ...(token ? {} : { api_key: config.tmdbApiKey }) });
  return fetchJson(`${API}${path}?${query}`, token ? { headers: { Authorization: `Bearer ${config.tmdbApiKey}` } } : {});
}

async function find(kind, query, language) {
  if (!config.tmdbApiKey) throw new IntegrationError('notConfigured');
  return cached(`tmdb:${kind}:${language}:${query.toLowerCase()}`, CACHE_MS, async () => {
    const found = await call(`/search/${kind}`, { query, language, include_adult: 'false' });
    const id = found?.results?.[0]?.id;
    if (!id) throw new IntegrationError('notFound');
    const details = await call(`/${kind}/${id}`, { language });
    if (!details?.id) throw new IntegrationError('notFound');
    return details;
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tmdb')
    .setDescription('Look up a movie or a TV series: score, genres, release and synopsis.')
    .addSubcommand((s) => s
      .setName('movie')
      .setDescription('A movie.')
      .addStringOption((o) => o.setName('title').setDescription('The title, for example Interstellar').setMaxLength(100).setRequired(true)))
    .addSubcommand((s) => s
      .setName('tv')
      .setDescription('A TV series.')
      .addStringOption((o) => o.setName('title').setDescription('The title, for example Dark').setMaxLength(100).setRequired(true))),

  // `!tmdb interstellar` is a movie.
  prefixDefaultSubcommand: (tokens) => (tokens.length ? 'movie' : null),
  prefixSubcommandAliases: { film: 'movie', series: 'tv', show: 'tv' },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    const typed = interaction.options.getString('title', true).trim();
    await lookup(interaction, lang, 'TMDB', async () => {
      if (!typed) throw new IntegrationError('badInput');
      const item = await find(sub, typed, TMDB_LANGUAGES[lang] ?? 'en-US');
      const movie = sub === 'movie';
      const name = movie ? item.title : item.name;
      const original = movie ? item.original_title : item.original_name;
      const date = movie ? item.release_date : item.first_air_date;
      const genres = (item.genres ?? []).map((genre) => `\`${plain(genre.name, 25)}\``).join(' ');
      const minutes = movie ? item.runtime : item.episode_run_time?.[0];
      return infoPayload({
        accent: null,
        title: plain(name, 150),
        subtitle: [original && original !== name ? plain(original, 150) : null, item.tagline ? `*${plain(item.tagline, 150)}*` : null].filter(Boolean),
        thumbnail: item.poster_path ? `${IMAGES}/w342${item.poster_path}` : null,
        banner: item.backdrop_path ? `${IMAGES}/w780${item.backdrop_path}` : null,
        sections: [
          {
            lines: [
              item.vote_count ? row(t(lang, 'integrations.tmdb.score'), `${formatDecimal(lang, item.vote_average, 1)}/10 (${formatNumber(lang, item.vote_count)})`) : null,
              date ? row(t(lang, movie ? 'integrations.tmdb.released' : 'integrations.tmdb.firstAired'), dateTag(date)) : null,
              minutes ? row(t(lang, 'integrations.tmdb.runtime'), t(lang, 'integrations.tmdb.minutes', { minutes })) : null,
              !movie && item.number_of_seasons ? row(t(lang, 'integrations.tmdb.seasons'), `${formatNumber(lang, item.number_of_seasons)} · ${formatNumber(lang, item.number_of_episodes ?? 0)} ${t(lang, 'integrations.tmdb.episodes')}`) : null,
              !movie && item.status ? row(t(lang, 'integrations.tmdb.status'), plain(item.status, 40)) : null,
              !movie && (item.networks ?? []).length ? row(t(lang, 'integrations.tmdb.network'), item.networks.slice(0, 3).map((network) => plain(network.name, 30)).join(', ')) : null,
              genres ? row(t(lang, 'integrations.tmdb.genres'), genres) : null,
            ],
          },
          item.overview ? { lines: [plain(short(item.overview, 600), 600)], limit: 800 } : null,
        ].filter(Boolean),
        footer: 'TMDB',
        buttons: [{ label: t(lang, 'integrations.tmdb.open'), url: `https://www.themoviedb.org/${sub}/${item.id}` }],
      });
    }, COOLDOWN);
  },
};

module.exports.find = find;
