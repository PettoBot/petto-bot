// Pokémon: the one of the day. There are no "news" to wait for, so the feed picks one Pokémon a day, the same for every server, from PokéAPI.
const { fetchJsonBody } = require('../http');

const API = 'https://pokeapi.co/api/v2';
const TOTAL = 1025; // the national dex

const DAY_MS = 86_400_000;
const dayNumber = (now = Date.now()) => Math.floor(now / DAY_MS);

/** The dex number of a day: it walks the whole dex without repeating before it ends (a step that shares no divisor with the total). */
const pokemonOfDay = (day = dayNumber()) => ((day * 311) % TOTAL) + 1;

const POKEAPI_LANG = { en: 'en', es: 'es', 'pt-BR': 'pt-BR' };

const title = (name) => name.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');

/** The Pokémon of a day: `{ number, name, types, height, weight, description, image, sprite }`, with its entry in `lang` when PokéAPI has it. */
async function fetchPokemon(number, lang = 'en') {
  const [pokemon, species] = await Promise.all([fetchJsonBody(`${API}/pokemon/${number}`), fetchJsonBody(`${API}/pokemon-species/${number}`)]);
  const wanted = POKEAPI_LANG[lang] ?? 'en';
  const entry = species.flavor_text_entries.find((e) => e.language.name === wanted) ?? species.flavor_text_entries.find((e) => e.language.name === 'en');
  const names = species.names ?? [];
  const localName = names.find((n) => n.language.name === wanted)?.name ?? names.find((n) => n.language.name === 'en')?.name ?? title(pokemon.name);
  return {
    number: pokemon.id, name: localName, types: pokemon.types.map((entryType) => title(entryType.type.name)), height: pokemon.height / 10, weight: pokemon.weight / 10,
    description: String(entry?.flavor_text ?? '').replace(/[\n\f]+/g, ' '),
    image: pokemon.sprites?.other?.['official-artwork']?.front_default ?? pokemon.sprites?.front_default ?? null, sprite: pokemon.sprites?.front_default ?? null,
  };
}

function toItem(pokemon, now = Date.now()) {
  return {
    platform: 'pokemon', type: 'daily', id: `${dayNumber(now)}:${pokemon.number}`, title: `#${String(pokemon.number).padStart(4, '0')} ${pokemon.name}`, url: `https://www.pokemon.com/us/pokedex/${pokemon.name.toLowerCase().replace(/\s+/g, '-')}`,
    description: pokemon.description, image: pokemon.image, avatar: pokemon.sprite, author: 'Pokédex', publishedAt: now, extra: `${pokemon.types.join(' · ')} · ${pokemon.height} m · ${pokemon.weight} kg`,
  };
}

module.exports = { pokemonOfDay, fetchPokemon, toItem, dayNumber, TOTAL };
