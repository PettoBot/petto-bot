const { SlashCommandBuilder } = require('discord.js');
const { infoPayload, noticePayload } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');
const { IntegrationError, fetchJson, cached, lookup, plain, short, dateTag } = require('../../utils/integrations');
const { t, languageOf } = require('../../i18n');

const CACHE_MS = 10 * 60_000;
const COOLDOWN = { name: 'wikipedia', ms: 3000 };
// The language of the encyclopedia is the one of the server.
const WIKI_LANGUAGES = { en: 'en', es: 'es', 'pt-BR': 'pt' };

/** The article that best matches some words, as its summary: { title, description, extract, thumbnail, url, disambiguation }. */
async function findArticle(query, lang) {
  const host = `${WIKI_LANGUAGES[lang] ?? 'en'}.wikipedia.org`;
  return cached(`wp:${host}:${query.toLowerCase()}`, CACHE_MS, async () => {
    const found = await fetchJson(`https://${host}/w/rest.php/v1/search/title?q=${encodeURIComponent(query)}&limit=1`);
    const key = found?.pages?.[0]?.key;
    if (!key) throw new IntegrationError('notFound');
    const summary = await fetchJson(`https://${host}/api/rest_v1/page/summary/${encodeURIComponent(key)}`);
    if (!summary?.title) throw new IntegrationError('notFound');
    return {
      title: summary.title,
      description: summary.description ?? null,
      extract: summary.extract ?? '',
      thumbnail: summary.thumbnail?.source ?? null,
      url: summary.content_urls?.desktop?.page ?? `https://${host}/wiki/${encodeURIComponent(key)}`,
      disambiguation: summary.type === 'disambiguation',
      updated: summary.timestamp ?? null,
    };
  });
}

module.exports = {
  aliases: ['wp'],
  data: new SlashCommandBuilder()
    .setName('wikipedia')
    .setDescription('Read the summary of a Wikipedia article, in the language of the server.')
    .addStringOption((o) => o.setName('query').setDescription('What to look up, for example Minecraft').setMaxLength(100).setRequired(true)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const query = interaction.options.getString('query', true).trim();
    await lookup(interaction, lang, 'Wikipedia', async () => {
      if (!query) throw new IntegrationError('badInput');
      const article = await findArticle(query, lang);
      if (!article.extract) return noticePayload(t(lang, 'integrations.wikipedia.empty', { title: plain(article.title, 80) }), COLORS.RED);
      return infoPayload({
        accent: null,
        title: plain(article.title, 120),
        subtitle: article.description ? [plain(article.description, 150)] : [],
        thumbnail: article.thumbnail,
        sections: [{ lines: [plain(short(article.extract, 900), 900), article.disambiguation ? `-# ${t(lang, 'integrations.wikipedia.disambiguation')}` : null], limit: 1200 }],
        footer: article.updated ? t(lang, 'integrations.wikipedia.updated', { when: dateTag(article.updated, 'D') }) : 'Wikipedia', // i18n-ignore: a brand name
        buttons: [{ label: t(lang, 'integrations.wikipedia.open'), url: article.url }],
      });
    }, COOLDOWN);
  },
};

module.exports.findArticle = findArticle;
