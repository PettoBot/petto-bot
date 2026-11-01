// /game: the fun and the games as subcommands of one command (a tidier `/` list: they are found by typing `/game`). Each one runs the code of
// the command it wraps with its options (utils/umbrella.js): `/game 8ball` is `!8ball`, `/game minecraft` is `!minecraft user`. What a
// subcommand leaves out (`!minecraft skin`, `!roblox group`, `!image`...) stays in the old command, which keeps working as it was with the
// prefix. `!game` alone lists the subcommands, and the old words are accepted (`!game cf`, `!game mc Notch`).
//
// The profile lookups of games (Minecraft, Roblox, Steam, Chess.com, Lichess, Pokédex, Modrinth) are here and not in `/search` because they
// are about the games people play together; the pictures of animals are the fun of the group, not a lookup.
//
// PERMISSIONS: none of what it wraps asks for a permission, so `/game` is open; the umbrella asks for the permission of the wrapped command
// anyway before running it (utils/umbrella.js), so a command that gets one later is protected here too.
const { SlashCommandBuilder } = require('discord.js');
const { addSubcommands, ruleKeysOf, prefixOptionsOf, wrappedExecutor } = require('../../utils/umbrella');

// The folder of each wrapped command, when it is not this one.
const FOLDERS = { roll: 'utility', choose: 'utility', jumbo: 'utility' };
for (const name of ['animal', 'chess', 'minecraft', 'roblox', 'steam', 'pokemon', 'modrinth']) FOLDERS[name] = 'integrations';
const load = (name) => require(`../${FOLDERS[name] ?? 'fun'}/${name}`);

// `wraps`: the command; `sub`: the subcommand of it that this one stands for (its main action). Without `sub` the command has none.
const SUBCOMMANDS = [
  { name: '8ball', wraps: '8ball' },
  { name: 'coinflip', wraps: 'coinflip' },
  { name: 'rps', wraps: 'rps' },
  { name: 'ship', wraps: 'ship' },
  { name: 'roll', wraps: 'roll' },
  { name: 'choose', wraps: 'choose' },
  { name: 'truthordare', wraps: 'truthordare' },
  { name: 'wouldyourather', wraps: 'wouldyourather' },
  { name: 'neverhaveiever', wraps: 'neverhaveiever' },
  { name: 'uwu', wraps: 'uwu' },
  { name: 'quote', wraps: 'quote' },
  { name: 'jumbo', wraps: 'jumbo' },
  { name: 'cat', wraps: 'animal', sub: 'cat' },
  { name: 'dog', wraps: 'animal', sub: 'dog' },
  { name: 'fox', wraps: 'animal', sub: 'fox' },
  { name: 'minecraft', wraps: 'minecraft', sub: 'user' },
  { name: 'minecraft-server', wraps: 'minecraft', sub: 'server' },
  { name: 'roblox', wraps: 'roblox', sub: 'user' },
  { name: 'steam', wraps: 'steam', sub: 'profile' },
  { name: 'chesscom', wraps: 'chess', sub: 'chesscom' },
  { name: 'lichess', wraps: 'chess', sub: 'lichess' },
  { name: 'pokemon', wraps: 'pokemon' },
  { name: 'modrinth', wraps: 'modrinth' },
];

// The words of the old commands, read as the subcommand they stand for (`!game cf`, `!game mc Notch`).
const WORDS = {
  '8ball': ['eightball'], coinflip: ['cf', 'flipcoin'], rps: ['rockpaperscissors'], roll: ['dice'], choose: ['pick', 'decide'], truthordare: ['tod'],
  wouldyourather: ['wyr'], neverhaveiever: ['nhie'], uwu: ['uwuify'], quote: ['q', 'miq'], jumbo: ['bigemoji', 'enlarge'], minecraft: ['mc'],
  roblox: ['rbx'], modrinth: ['mr'], pokemon: ['pkmn', 'pokedex'],
};
const SUBCOMMAND_WORDS = Object.fromEntries(Object.entries(WORDS).flatMap(([name, words]) => words.map((word) => [word, name])));
const { greedy } = prefixOptionsOf(SUBCOMMANDS, load);
const executor = wrappedExecutor(load, SUBCOMMANDS);

module.exports = {
  // Also registered as a slash command; the prefix works too.
  registerSlash: true,
  // `!game` alone lists the subcommands instead of saying something is wrong.
  listSubcommandsWhenEmpty: true,
  prefixSubcommandAliases: SUBCOMMAND_WORDS,
  // The option that takes every word left, as it does for the old command.
  prefixGreedyStringOptions: greedy,
  // The rules of a server name the command that is wrapped (`!disablecommand 8ball` also turns off `/game 8ball`); `game` turns off all of it.
  rulesBySubcommand: true,
  ruleKeys: ruleKeysOf(SUBCOMMANDS),
  permissionForSubcommand: executor.permissionForSubcommand,
  data: addSubcommands(
    new SlashCommandBuilder().setName('game').setDMPermission(false).setDescription('Fun and games: 8ball, coinflip, rps, ship, dice, pets, game profiles and more, in one command.'),
    SUBCOMMANDS,
    load,
  ),

  // The subcommands and what each wraps (read by the tests and by scripts/i18n-commands.js for the translations).
  subcommands: SUBCOMMANDS,
  execute: executor.execute,
};
