const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLORS } = require('../../utils/colors');

function clip(value, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function googleUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

async function queryGoogle(query) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_CX;
  if (!apiKey || !searchEngineId) return null;

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.search = new URLSearchParams({
    key: apiKey,
    cx: searchEngineId,
    q: query,
    safe: 'active',
    num: '5',
  });

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Google returned ${response.status}`);
  const data = await response.json();
  return Array.isArray(data.items) ? data.items : [];
}

module.exports = {
  aliases: ['g', 'google'],
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search Google safely from Discord.')
    .addStringOption((option) => option.setName('query').setDescription('What do you want to search for?').setRequired(true)),

  async execute(interaction) {
    const query = interaction.options.getString('query', true).trim();
    if (!query || query.length > 200) {
      await interaction.reply({ content: 'Keep the search under 200 characters.' });
      return;
    }

    const link = googleUrl(query);
    try {
      const items = await queryGoogle(query);
      const embed = new EmbedBuilder()
        .setColor(COLORS.DEFAULT)
        .setTitle(`Google: ${clip(query, 240)}`)
        .setURL(link);

      if (items === null) {
        embed.setDescription(`Google preview is not configured yet. [Open this search in Google](${link}).`);
        embed.setFooter({ text: 'Google link mode · add search credentials for previews' });
      } else if (!items.length) {
        embed.setDescription(`No results found. [Open this search in Google](${link}).`);
        embed.setFooter({ text: 'Google Custom Search' });
      } else {
        embed.setDescription(items.map((item) => `**[${clip(item.title, 256)}](${item.link})**\n${clip(item.snippet, 300)}`).join('\n\n'));
        embed.setFooter({ text: 'Google Custom Search · safe search enabled' });
      }

      await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch {
      const embed = new EmbedBuilder()
        .setColor(COLORS.YELLOW)
        .setTitle('Google search unavailable')
        .setDescription(`[Open this search in Google](${link}).`)
        .setFooter({ text: 'The Google preview service did not respond.' });
      await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    }
  },
};
