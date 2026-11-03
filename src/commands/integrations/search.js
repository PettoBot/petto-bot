// /search: lookups of information from outside Discord, as groups and subcommands of one command (a tidier `/` list: they are found by typing
// `/search`). A service with several lookups is a group with all of them (`/search github repo`, `/search minecraft skin`), one with a single lookup is a
// subcommand (`/search weather`). Each one takes the same options and runs the same code as the old command (utils/umbrella.js): `/search youtube video`
// is `!youtube video`. The old commands keep working as they were with the prefix, and so do the old words as the first word of this one
// (`!search yt Rick Astley`, `!search gh octocat/hello-world`).
//
// The profile lookups of games (Minecraft, Roblox, Steam, Chess.com, Lichess, Pokédex, Modrinth) used to be in `/game`; they are lookups, so they are here.
//
// PERMISSIONS: none of what it wraps asks for a permission, so `/search` is open; the umbrella asks for the permission of the wrapped
// command anyway before running it (utils/umbrella.js), so a command that gets one later is protected here too.
const { defineUmbrella } = require('../../utils/umbrella');

const SUBCOMMANDS = [
  { group: 'anilist', wraps: 'anilist' },
  { group: 'tmdb', wraps: 'tmdb' },
  { group: 'itunes', wraps: 'itunes' },
  { group: 'deezer', wraps: 'deezer' },
  { group: 'lastfm', wraps: 'lastfm' },
  { group: 'youtube', wraps: 'youtube' },
  { group: 'twitch', wraps: 'twitch' },
  { group: 'github', wraps: 'github' },
  { group: 'package', wraps: 'package' },
  { group: 'minecraft', wraps: 'minecraft' },
  { group: 'roblox', wraps: 'roblox' },
  { group: 'steam', wraps: 'steam' },
  { group: 'chess', wraps: 'chess' },
  { name: 'pokemon', wraps: 'pokemon' },
  { name: 'modrinth', wraps: 'modrinth' },
  { name: 'wikipedia', wraps: 'wikipedia' },
  { name: 'wiki', wraps: 'wiki' },
  { name: 'weather', wraps: 'weather' },
  { name: 'time', wraps: 'time' },
  { name: 'currency', wraps: 'currency' },
  { name: 'crypto', wraps: 'crypto' },
  { name: 'compute', wraps: 'calc', legacy: ['math'] },
  { name: 'color', wraps: 'color', legacy: ['clr', 'hex'] },
];

module.exports = defineUmbrella({
  name: 'search',
  description: 'Look things up: anime, movies, music, videos, games, GitHub, weather, time, currency and more.',
  subcommands: SUBCOMMANDS,
  // Older words of `!search` for what is a group now (`!search mc Notch`): the aliases of the old commands are read by the umbrella itself.
  legacyRoutes: {
    chesscom: { command: 'chess', args: ['chesscom'] },
    lichess: { command: 'chess', args: ['lichess'] },
    'minecraft-server': { command: 'minecraft', args: ['server'] },
  },
});
