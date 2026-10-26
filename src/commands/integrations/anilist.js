const { SlashCommandBuilder } = require('discord.js');
const { infoPayload, noticePayload } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');
const { IntegrationError, fetchJson, cached, lookup, row, plain, short, stripHtml } = require('../../utils/integrations');
const { t, formatNumber, languageOf } = require('../../i18n');

const API = 'https://graphql.anilist.co';
const CACHE_MS = 10 * 60_000;
const COOLDOWN = { name: 'anilist', ms: 3000 };

// i18n-ignore-next-line: a GraphQL query, never shown
const MEDIA_QUERY = `query ($search: String, $type: MediaType) {
  Media(search: $search, type: $type, sort: SEARCH_MATCH) {
    id title { romaji english } format status episodes chapters volumes averageScore popularity genres season seasonYear
    startDate { year month day } description(asHtml: false) coverImage { extraLarge color } bannerImage siteUrl isAdult
    studios(isMain: true) { nodes { name } }
  }
}`;
// i18n-ignore-next-line: a GraphQL query, never shown
const CHARACTER_QUERY = `query ($search: String) {
  Character(search: $search) {
    id name { full native } image { large } description(asHtml: false) gender age dateOfBirth { month day } favourites siteUrl
    media(perPage: 3, sort: POPULARITY_DESC) { nodes { title { romaji english } } }
  }
}`;

const ask = (key, query, variables) => cached(`ani:${key}`, CACHE_MS, async () => {
  const body = await fetchJson(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (body?.errors?.some((error) => error.status === 404)) throw new IntegrationError('notFound');
  if (body?.errors?.length || !body?.data) throw new IntegrationError('unavailable');
  return body.data;
});

/** The description of AniList as plain text: no HTML, no spoilers (they are written between `~!` and `!~`), no extra blank lines. */
function cleanDescription(text, max = 450) {
  const clean = stripHtml(String(text ?? '').replace(/~!.*?!~/gs, '')).replace(/\n{2,}/g, '\n').trim();
  return short(clean, max);
}

const dateOf = (date) => (date?.year ? [date.year, date.month, date.day].filter(Boolean).join('-') : null);
const titleOf = (title) => title?.english || title?.romaji || '';

module.exports = {
  aliases: ['ani'],
  data: new SlashCommandBuilder()
    .setName('anilist')
    .setDescription('Look up an anime, a manga or a character on AniList.')
    .addSubcommand((s) => s
      .setName('anime')
      .setDescription('An anime: score, episodes, studio and genres.')
      .addStringOption((o) => o.setName('title').setDescription('The title, for example Frieren').setMaxLength(100).setRequired(true)))
    .addSubcommand((s) => s
      .setName('manga')
      .setDescription('A manga: score, chapters and genres.')
      .addStringOption((o) => o.setName('title').setDescription('The title').setMaxLength(100).setRequired(true)))
    .addSubcommand((s) => s
      .setName('character')
      .setDescription('A character of an anime or manga.')
      .addStringOption((o) => o.setName('name').setDescription('The name of the character').setMaxLength(100).setRequired(true))),

  // `!ani frieren` is an anime.
  prefixDefaultSubcommand: (tokens) => (tokens.length ? 'anime' : null),
  prefixSubcommandAliases: { show: 'anime', series: 'anime', comic: 'manga', char: 'character', waifu: 'character' },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    const typed = (interaction.options.getString(sub === 'character' ? 'name' : 'title', true)).trim();
    await lookup(interaction, lang, 'AniList', async () => {
      if (!typed) throw new IntegrationError('badInput');

      if (sub === 'character') {
        const { Character: character } = await ask(`c:${typed.toLowerCase()}`, CHARACTER_QUERY, { search: typed });
        if (!character) throw new IntegrationError('notFound');
        const works = (character.media?.nodes ?? []).map((node) => plain(titleOf(node.title), 60)).filter(Boolean).join(', ');
        const birthday = character.dateOfBirth?.month ? `${character.dateOfBirth.day ?? '?'}/${character.dateOfBirth.month}` : null;
        return infoPayload({
          accent: null,
          title: plain(character.name?.full, 100),
          subtitle: character.name?.native ? [plain(character.name.native, 100)] : [],
          thumbnail: character.image?.large ?? null,
          sections: [
            {
              lines: [
                character.gender ? row(t(lang, 'integrations.anilist.gender'), plain(character.gender, 30)) : null,
                character.age ? row(t(lang, 'integrations.anilist.age'), plain(character.age, 30)) : null,
                birthday ? row(t(lang, 'integrations.anilist.birthday'), birthday) : null,
                works ? row(t(lang, 'integrations.anilist.appears'), works) : null,
                character.favourites ? row(t(lang, 'integrations.anilist.favourites'), formatNumber(lang, character.favourites)) : null,
              ],
            },
            cleanDescription(character.description) ? { lines: [plain(cleanDescription(character.description), 450)], limit: 600 } : null,
          ].filter(Boolean),
          footer: 'AniList',
          buttons: [{ label: t(lang, 'integrations.anilist.open'), url: character.siteUrl }],
        });
      }

      const type = sub.toUpperCase();
      const { Media: media } = await ask(`m:${type}:${typed.toLowerCase()}`, MEDIA_QUERY, { search: typed, type });
      if (!media) throw new IntegrationError('notFound');
      // Adult titles only where the channel is marked as for adults.
      if (media.isAdult && !interaction.channel?.nsfw) return noticePayload(t(lang, 'integrations.anilist.adult'), COLORS.RED);
      const isAnime = sub === 'anime';
      const studios = (media.studios?.nodes ?? []).map((node) => plain(node.name, 40)).join(', ');
      const start = dateOf(media.startDate);
      return infoPayload({
        accent: null,
        title: plain(titleOf(media.title), 150),
        subtitle: media.title?.english && media.title?.romaji && media.title.english !== media.title.romaji ? [plain(media.title.romaji, 150)] : [],
        thumbnail: media.coverImage?.extraLarge ?? null,
        banner: media.bannerImage ?? null,
        sections: [
          {
            lines: [
              media.averageScore ? row(t(lang, 'integrations.anilist.score'), `${media.averageScore}/100`) : null,
              media.format ? row(t(lang, 'integrations.anilist.format'), plain(media.format.replace(/_/g, ' '), 30)) : null,
              media.status ? row(t(lang, 'integrations.anilist.status'), t(lang, `integrations.anilist.status.${media.status}`)) : null,
              isAnime && media.episodes ? row(t(lang, 'integrations.anilist.episodes'), formatNumber(lang, media.episodes)) : null,
              !isAnime && media.chapters ? row(t(lang, 'integrations.anilist.chapters'), formatNumber(lang, media.chapters)) : null,
              !isAnime && media.volumes ? row(t(lang, 'integrations.anilist.volumes'), formatNumber(lang, media.volumes)) : null,
              start ? row(t(lang, 'integrations.anilist.started'), start) : null,
              studios ? row(t(lang, 'integrations.anilist.studio'), studios) : null,
              (media.genres ?? []).length ? row(t(lang, 'integrations.anilist.genres'), media.genres.slice(0, 6).map((genre) => `\`${plain(genre, 20)}\``).join(' ')) : null,
            ],
          },
          cleanDescription(media.description) ? { lines: [plain(cleanDescription(media.description), 450)], limit: 600 } : null,
        ].filter(Boolean),
        footer: 'AniList',
        buttons: [{ label: t(lang, 'integrations.anilist.open'), url: media.siteUrl }],
      });
    }, COOLDOWN);
  },
};

module.exports.cleanDescription = cleanDescription;
