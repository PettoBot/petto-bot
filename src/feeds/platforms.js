// The platforms a feed can follow: how each one is called, its color (the side bar of the card), the picture shown when an account has none,
// and what each can notify (`types`). The order of `PLATFORM_IDS` is the order of the dashboard menu.
const PLATFORMS = {
  youtube: { name: 'YouTube', color: 0xff0000, site: 'https://www.youtube.com', types: ['video', 'short', 'live'], defaultTypes: ['video', 'short', 'live'] },
  twitch: { name: 'Twitch', color: 0x9146ff, site: 'https://www.twitch.tv', types: ['live', 'clip'], defaultTypes: ['live'] },
  kick: { name: 'Kick', color: 0x53fc18, site: 'https://kick.com', types: ['live'], defaultTypes: ['live'] },
  bluesky: { name: 'Bluesky', color: 0x1185fe, site: 'https://bsky.app', types: ['post'], defaultTypes: ['post'] },
  pinterest: { name: 'Pinterest', color: 0xe60023, site: 'https://www.pinterest.com', types: ['pin'], defaultTypes: ['pin'] },
  modrinth: { name: 'Modrinth', color: 0x1bd96a, site: 'https://modrinth.com', types: ['update'], defaultTypes: ['update'] },
  pokemon: { name: 'Pokémon', color: 0xffcb05, site: 'https://pokeapi.co', types: ['daily'], defaultTypes: ['daily'] },
  rss: { name: 'RSS', color: 0xf26522, site: null, types: ['post'], defaultTypes: ['post'] },
};

const PLATFORM_IDS = Object.keys(PLATFORMS);

/** Every kind of notice a card can be: the same word in the labels, the emoji and the dashboard. */
const TYPES = ['video', 'short', 'live', 'clip', 'post', 'pin', 'update', 'daily', 'ended'];

const isPlatform = (id) => Object.hasOwn(PLATFORMS, id);

/** The picture of a platform on this site, for an account that has none (the dashboard uploads them with the rest of its assets). */
const fallbackPicture = (id) => `${process.env.PETTO_FEED_ASSETS_URL || 'https://petto.sbs/assets/feeds'}/${id}.png`;

module.exports = { PLATFORMS, PLATFORM_IDS, TYPES, isPlatform, fallbackPicture };
