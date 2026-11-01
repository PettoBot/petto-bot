const { SlashCommandBuilder } = require('discord.js');
const { infoPayload } = require('../../utils/infoCard');
const { IntegrationError, fetchJson, lookup } = require('../../utils/integrations');
const { t, languageOf } = require('../../i18n');

const COOLDOWN = { name: 'animal', ms: 3000 };

// Where the picture of each animal comes from, and how to read the link in the answer (the answer itself never names it: it is only the picture).
const SOURCES = {
  cat: { url: 'https://api.thecatapi.com/v1/images/search', pick: (body) => body?.[0]?.url, provider: 'TheCatAPI' },
  dog: { url: 'https://dog.ceo/api/breeds/image/random', pick: (body) => (body?.status === 'success' ? body.message : null), provider: 'Dog CEO' },
  fox: { url: 'https://randomfox.ca/floof/', pick: (body) => body?.image, provider: 'RandomFox' },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('animal')
    .setDescription('A random picture of a cat, a dog or a fox.')
    .addSubcommand((s) => s.setName('cat').setDescription('A random cat.'))
    .addSubcommand((s) => s.setName('dog').setDescription('A random dog.'))
    .addSubcommand((s) => s.setName('fox').setDescription('A random fox.')),

  prefixSubcommandAliases: { gato: 'cat', cats: 'cat', kitty: 'cat', perro: 'dog', dogs: 'dog', puppy: 'dog', zorro: 'fox', foxes: 'fox' },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const kind = interaction.options.getSubcommand();
    await lookup(interaction, lang, SOURCES[kind].provider, async () => {
      const link = SOURCES[kind].pick(await fetchJson(SOURCES[kind].url));
      if (!/^https:\/\//i.test(String(link ?? ''))) throw new IntegrationError('unavailable');
      // Only the picture (its title is the text for who cannot see it): no source, no link, no button.
      return infoPayload({ accent: null, title: t(lang, `integrations.animal.${kind}`), hero: link });
    }, COOLDOWN);
  },
};

module.exports.SOURCES = SOURCES;
