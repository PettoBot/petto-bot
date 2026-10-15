const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLORS } = require('../../utils/colors');
const { t, languageOf } = require('../../i18n');

const WIKI_URL = 'https://wiki.petto.sbs';
const INDEX_URL = `${WIKI_URL}/llms.txt`;
const CACHE_TTL_MS = 15 * 60 * 1000;
let cachedPages = null;
let cachedAt = 0;

function clip(value, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

async function getWikiPages() {
  if (cachedPages && Date.now() - cachedAt < CACHE_TTL_MS) return cachedPages;

  const response = await fetch(INDEX_URL, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Petto wiki returned ${response.status}`); // i18n-ignore: internal error, caught in execute
  const text = await response.text();
  cachedPages = [...text.matchAll(/^- \[([^\]]+)\]\(([^)]+)\):\s*(.+)$/gm)].map((match) => ({
    title: match[1],
    url: match[2].replace(/\.md$/, ''),
    description: match[3],
  }));
  cachedAt = Date.now();
  return cachedPages;
}

function findPages(pages, query) {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return pages
    .map((page) => ({
      page,
      score: terms.reduce((score, term) => score + (page.title.toLocaleLowerCase().includes(term) ? 3 : 0) + (page.description.toLocaleLowerCase().includes(term) ? 1 : 0), 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ page }) => page);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wiki')
    .setDescription('Find something in the Petto wiki.')
    .addStringOption((option) => option.setName('query').setDescription('Feature, command, or topic to find').setRequired(false)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const query = interaction.options.getString('query')?.trim() ?? '';
    try {
      const pages = await getWikiPages();
      const matches = query ? findPages(pages, query) : pages.slice(0, 5);
      const embed = new EmbedBuilder()
        .setColor(COLORS.DEFAULT)
        .setTitle(query ? t(lang, 'utility.wiki.titleQuery', { query: clip(query, 180) }) : t(lang, 'utility.wiki.title'))
        .setURL(WIKI_URL)
        .setFooter({ text: t(lang, 'utility.wiki.footer') });

      if (!matches.length) {
        embed.setDescription(t(lang, 'utility.wiki.notFound', { query: clip(query, 150), url: WIKI_URL }));
      } else {
        embed.setDescription(matches.map((page) => `**[${clip(page.title, 180)}](${page.url})**\n${clip(page.description, 260)}`).join('\n\n'));
      }

      await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(COLORS.YELLOW).setTitle(t(lang, 'utility.wiki.title')).setDescription(t(lang, 'utility.wiki.open', { url: WIKI_URL }))],
        allowedMentions: { parse: [] },
      });
    }
  },
};
