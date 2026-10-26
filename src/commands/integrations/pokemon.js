const { SlashCommandBuilder } = require('discord.js');
const { infoPayload } = require('../../utils/infoCard');
const { IntegrationError, fetchJson, cached, lookup, row, plain, short } = require('../../utils/integrations');
const { t, formatDecimal, languageOf } = require('../../i18n');

const API = 'https://pokeapi.co/api/v2';
const CACHE_MS = 60 * 60_000;
const COOLDOWN = { name: 'pokemon', ms: 3000 };
const NAME = /^[a-z0-9.'\-: ]{1,40}$/i;
const STAT_NAMES = { hp: 'HP', attack: 'ATK', defense: 'DEF', 'special-attack': 'SP.ATK', 'special-defense': 'SP.DEF', speed: 'SPD' };
// The languages of the flavor text that PokeAPI has; the rest read the English one.
const FLAVOR_LANGUAGES = { en: 'en', es: 'es', 'pt-BR': 'en' };

/** `pikachu`, `25` or `Mr. Mime` as the name PokeAPI uses (`mr-mime`), or null. */
function parsePokemon(input) {
  const text = String(input ?? '').trim().toLowerCase().replace(/^#/, '');
  if (!NAME.test(text)) return null;
  return text.replace(/[.']/g, '').replace(/[\s:]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || null;
}

const titleCase = (name) => String(name).split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
const bar = (value) => { const filled = Math.max(0, Math.min(10, Math.round(Number(value) / 25.5))); return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)}`; };

async function findPokemon(name) {
  return cached(`poke:${name}`, CACHE_MS, async () => {
    const pokemon = await fetchJson(`${API}/pokemon/${encodeURIComponent(name)}`);
    if (!pokemon?.id) throw new IntegrationError('notFound');
    const species = await fetchJson(pokemon.species?.url ?? `${API}/pokemon-species/${pokemon.id}`).catch(() => null);
    return { pokemon, species };
  });
}

module.exports = {
  aliases: ['pkmn', 'pokedex'],
  data: new SlashCommandBuilder()
    .setName('pokemon')
    .setDescription('Look up a Pokémon: types, stats, abilities and its Pokédex entry.')
    .addStringOption((o) => o.setName('pokemon').setDescription('The name or the Pokédex number, for example pikachu or 25').setMaxLength(40).setRequired(true)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const typed = interaction.options.getString('pokemon', true);
    await lookup(interaction, lang, 'PokéAPI', async () => {
      const name = parsePokemon(typed);
      if (!name) throw new IntegrationError('badInput');
      const { pokemon, species } = await findPokemon(name);
      const language = FLAVOR_LANGUAGES[lang] ?? 'en';
      const flavors = (species?.flavor_text_entries ?? []).filter((entry) => entry.language?.name === language);
      const flavor = (flavors.at(-1) ?? (species?.flavor_text_entries ?? []).find((entry) => entry.language?.name === 'en'))?.flavor_text;
      const genus = (species?.genera ?? []).find((entry) => entry.language?.name === language)?.genus ?? (species?.genera ?? []).find((entry) => entry.language?.name === 'en')?.genus;
      const types = (pokemon.types ?? []).map((entry) => `\`${titleCase(entry.type.name)}\``).join(' ');
      const abilities = (pokemon.abilities ?? []).map((entry) => `${titleCase(entry.ability.name)}${entry.is_hidden ? ` (${t(lang, 'integrations.pokemon.hidden')})` : ''}`).join(', ');
      const stats = (pokemon.stats ?? []).map((entry) => `\`${(STAT_NAMES[entry.stat.name] ?? entry.stat.name).padEnd(6)}\` ${bar(entry.base_stat)} ${entry.base_stat}`);
      const total = (pokemon.stats ?? []).reduce((sum, entry) => sum + entry.base_stat, 0);
      const art = pokemon.sprites?.other?.['official-artwork']?.front_default ?? pokemon.sprites?.front_default ?? null;
      return infoPayload({
        accent: null,
        title: `#${pokemon.id} ${titleCase(pokemon.name)}`,
        subtitle: [genus ? plain(genus, 60) : null, flavor ? plain(short(String(flavor).replace(/[\n\f]+/g, ' '), 300), 300) : null].filter(Boolean),
        banner: art,
        sections: [
          {
            lines: [
              types ? row(t(lang, 'integrations.pokemon.types'), types) : null,
              row(t(lang, 'integrations.pokemon.height'), `${formatDecimal(lang, pokemon.height / 10, 1)} m`),
              row(t(lang, 'integrations.pokemon.weight'), `${formatDecimal(lang, pokemon.weight / 10, 1)} kg`),
              abilities ? row(t(lang, 'integrations.pokemon.abilities'), abilities) : null,
              species?.is_legendary ? `-# ${t(lang, 'integrations.pokemon.legendary')}` : species?.is_mythical ? `-# ${t(lang, 'integrations.pokemon.mythical')}` : null,
            ],
          },
          stats.length ? { title: t(lang, 'integrations.pokemon.stats', { total }), lines: stats } : null,
        ].filter(Boolean),
        footer: 'PokéAPI', // i18n-ignore: a brand name
        buttons: [{ label: t(lang, 'integrations.pokemon.open'), url: `https://bulbapedia.bulbagarden.net/wiki/${encodeURIComponent(titleCase(pokemon.species?.name ?? pokemon.name).replace(/ /g, '_'))}_(Pok%C3%A9mon)` }],
      });
    }, COOLDOWN);
  },
};

module.exports.parsePokemon = parsePokemon;
module.exports.findPokemon = findPokemon;
