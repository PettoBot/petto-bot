// The platforms a feed can follow: how each one is called, its color (the side bar of the card), the picture shown when an account has none,
// and what each can notify (`types`). The order of `PLATFORM_IDS` is the order of the dashboard menu.
const PLATFORMS = {
  youtube: { name: 'YouTube', color: 0xff0000, site: 'https://www.youtube.com', types: ['video', 'short', 'live'], defaultTypes: ['video', 'short', 'live'] }, // i18n-ignore: the name of a brand
  twitch: { name: 'Twitch', color: 0x9146ff, site: 'https://www.twitch.tv', types: ['live', 'clip'], defaultTypes: ['live'] }, // i18n-ignore: the name of a brand
  kick: { name: 'Kick', color: 0x53fc18, site: 'https://kick.com', types: ['live'], defaultTypes: ['live'] }, // i18n-ignore: the name of a brand
  bluesky: { name: 'Bluesky', color: 0x1185fe, site: 'https://bsky.app', types: ['post'], defaultTypes: ['post'] }, // i18n-ignore: the name of a brand
  pinterest: { name: 'Pinterest', color: 0xe60023, site: 'https://www.pinterest.com', types: ['pin'], defaultTypes: ['pin'] }, // i18n-ignore: the name of a brand
  modrinth: { name: 'Modrinth', color: 0x1bd96a, site: 'https://modrinth.com', types: ['update'], defaultTypes: ['update'] }, // i18n-ignore: the name of a brand
  pokemon: { name: 'Pokémon', color: 0xffcb05, site: 'https://pokeapi.co', types: ['daily'], defaultTypes: ['daily'] }, // i18n-ignore: the name of a brand
  reddit: { name: 'Reddit', color: 0xff4500, site: 'https://www.reddit.com', types: ['post'], defaultTypes: ['post'] }, // i18n-ignore: the name of a brand
  github: { name: 'GitHub', color: 0x8b949e, site: 'https://github.com', types: ['update'], defaultTypes: ['update'] }, // i18n-ignore: the name of a brand
  npm: { name: 'npm', color: 0xcb3837, site: 'https://www.npmjs.com', types: ['update'], defaultTypes: ['update'] }, // i18n-ignore: the name of a brand
  pypi: { name: 'PyPI', color: 0x3775a9, site: 'https://pypi.org', types: ['update'], defaultTypes: ['update'] }, // i18n-ignore: the name of a brand
  steam: { name: 'Steam', color: 0x66c0f4, site: 'https://store.steampowered.com', types: ['post'], defaultTypes: ['post'] }, // i18n-ignore: the name of a brand
  anilist: { name: 'AniList', color: 0x02a9ff, site: 'https://anilist.co', types: ['episode'], defaultTypes: ['episode'] }, // i18n-ignore: the name of a brand
  wikipedia: { name: 'Wikipedia', color: 0x636466, site: 'https://www.wikipedia.org', types: ['daily'], defaultTypes: ['daily'] }, // i18n-ignore: the name of a brand
  chess: { name: 'Chess.com', color: 0x81b64c, site: 'https://www.chess.com', types: ['daily'], defaultTypes: ['daily'] }, // i18n-ignore: the name of a brand
  spotify: { name: 'Spotify', color: 0x1db954, site: 'https://open.spotify.com', types: ['release', 'episode'], defaultTypes: ['release', 'episode'] }, // i18n-ignore: the name of a brand
  deezer: { name: 'Deezer', color: 0xa238ff, site: 'https://www.deezer.com', types: ['release'], defaultTypes: ['release'] }, // i18n-ignore: the name of a brand
  applemusic: { name: 'Apple Music', color: 0xfa243c, site: 'https://music.apple.com', types: ['release'], defaultTypes: ['release'] }, // i18n-ignore: the name of a brand
  mastodon: { name: 'Mastodon', color: 0x6364ff, site: 'https://joinmastodon.org', types: ['post'], defaultTypes: ['post'] }, // i18n-ignore: the name of a brand
  tumblr: { name: 'Tumblr', color: 0x36465d, site: 'https://www.tumblr.com', types: ['post'], defaultTypes: ['post'] }, // i18n-ignore: the name of a brand
  letterboxd: { name: 'Letterboxd', color: 0x00e054, site: 'https://letterboxd.com', types: ['post'], defaultTypes: ['post'] }, // i18n-ignore: the name of a brand
  epic: { name: 'Epic Games', color: 0xffffff, site: 'https://store.epicgames.com', types: ['game'], defaultTypes: ['game'] }, // i18n-ignore: the name of a brand
  cat: { name: 'Cats', color: 0xf5a524, site: null, types: ['photo'], defaultTypes: ['photo'] }, // i18n-ignore: the name of what is posted
  dog: { name: 'Dogs', color: 0xb7791f, site: null, types: ['photo'], defaultTypes: ['photo'] }, // i18n-ignore: the name of what is posted
  fox: { name: 'Foxes', color: 0xff7a1a, site: null, types: ['photo'], defaultTypes: ['photo'] }, // i18n-ignore: the name of what is posted
  animals: { name: 'Animals', color: 0x9b7bff, site: null, types: ['photo'], defaultTypes: ['photo'] }, // i18n-ignore: the name of what is posted
  rss: { name: 'RSS', color: 0xf26522, site: null, types: ['post'], defaultTypes: ['post'] }, // i18n-ignore: the name of a brand
};

const PLATFORM_IDS = Object.keys(PLATFORMS);

/** Every kind of notice a card can be: the same word in the labels, the emoji and the dashboard. */
const TYPES = ['video', 'short', 'live', 'clip', 'post', 'pin', 'update', 'episode', 'release', 'game', 'photo', 'daily', 'ended'];

const isPlatform = (id) => Object.hasOwn(PLATFORMS, id);

/** The picture of a platform on this site, for an account that has none (the dashboard uploads them with the rest of its assets). */
const fallbackPicture = (id) => `${process.env.PETTO_FEED_ASSETS_URL || 'https://petto.sbs/assets/feeds'}/${id}.png`;

module.exports = { PLATFORMS, PLATFORM_IDS, TYPES, isPlatform, fallbackPicture };
