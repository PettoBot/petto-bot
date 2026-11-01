// /mod: the everyday moderation commands as subcommands of one command (a tidier `/` list: they are found by typing `/mod`). Each one runs
// the code of the command it wraps with its options (utils/umbrella.js): `/mod ban` is `/ban user`, `/mod tempmute` is `/tempmute`,
// `/mod lock` is `/channel lock`. What a subcommand leaves out (`/ban users`, `/mute remove`, `/case edit`...) stays in the old command,
// which keeps working as it was, with the prefix and, for `/ban`, `/kick`, `/warn` and `/channel`, as a slash command (`/unban`, `/purge` and `/timeout` are only here and with the prefix).
//
// PERMISSIONS: Discord checks `default_member_permissions` for a whole command, never for one subcommand, so `/mod` itself is open
// (null: everybody sees it, and a server can limit it in Settings > Integrations) and each subcommand asks, when it runs, for what the
// wrapped command asks: its `default_member_permissions` (the same bit field `/ban` is registered with), or the role chosen with
// `!moderation` for that command. It is checked here for the slash command and for the prefix alike, before the wrapped command runs; what
// the wrapped command checks by itself (the permission of the bot, the role hierarchy, who may be a target, who is an administrator) is
// still its own and runs after, untouched. A member without the permission gets the private refusal the old commands give.
//
// `!mod ban @x spam` works with the prefix, `!mod` alone lists the subcommands, and the old words are accepted (`!mod k @x`).
const { SlashCommandBuilder } = require('discord.js');
const { addSubcommands, ruleKeysOf, prefixOptionsOf, wrappedExecutor } = require('../../utils/umbrella');

const load = (file) => require(`./${file}`);

// `wraps`: the file of the command in this folder; `sub`: the subcommand of that command that this one stands for (the main action,
// `/mod ban` is `/ban user`). Without `sub` the command has no subcommands (or reads its own, like `/tempban`).
const SUBCOMMANDS = [
  { name: 'ban', wraps: 'ban', sub: 'user' },
  { name: 'kick', wraps: 'kick', sub: 'user' },
  { name: 'mute', wraps: 'mute', sub: 'user' },
  { name: 'tempmute', wraps: 'tempmute' },
  { name: 'unmute', wraps: 'unmute' },
  { name: 'warn', wraps: 'warn', sub: 'user' },
  { name: 'softban', wraps: 'softban' },
  { name: 'tempban', wraps: 'tempban' },
  { name: 'unban', wraps: 'unban' },
  { name: 'hardban', wraps: 'hardban' },
  { name: 'note', wraps: 'note', sub: 'add' },
  { name: 'case', wraps: 'case', sub: 'view' },
  { name: 'history', wraps: 'history' },
  { name: 'jail', wraps: 'jail', sub: 'user' },
  { name: 'unjail', wraps: 'unjail' },
  { name: 'nickname', wraps: 'nickname', sub: 'set' },
  { name: 'stripstaff', wraps: 'stripstaff' },
  { name: 'purge', wraps: 'purge' },
  { name: 'lockdown', wraps: 'lockdown', sub: 'start' },
  { name: 'unlockdown', wraps: 'lockdown', sub: 'end' },
  { name: 'clearinvites', wraps: 'clearinvites' },
  { name: 'pauseinvites', wraps: 'pauseinvites' },
  { name: 'lock', wraps: 'channel', sub: 'lock' },
  { name: 'unlock', wraps: 'channel', sub: 'unlock' },
  { name: 'slowmode', wraps: 'channel', sub: 'slowmode' },
];

const { greedy, argsReaders } = prefixOptionsOf(SUBCOMMANDS, load);
const executor = wrappedExecutor(load, SUBCOMMANDS);

// The words of the old commands, read as the subcommand they stand for (`!mod k @x`, `!mod to @x 10m`). Only the ones that mean the
// same thing: `!notes` lists and `!ch` is the whole channel command, so they are not here.
const WORDS = {
  ban: ['b', 'banish'], kick: ['k'], mute: ['m'], tempmute: ['tmute', 'timeout', 'to'], unmute: ['um', 'untimeout'], warn: ['w'],
  softban: ['sb', 'sban', 'sofban'], tempban: ['tban'], unban: ['ub'], hardban: ['hban', 'hb'], case: ['cs'], history: ['hist', 'modhistory'],
  unjail: ['uj'], nickname: ['nick', 'rename', 'setnick'], stripstaff: ['strip', 'destaff'], purge: ['prune'], lockdown: ['raidmode', 'raidstate', 'ld'],
  unlockdown: ['endlockdown'], clearinvites: ['deleteinvites', 'purgeinvites'], pauseinvites: ['pi', 'pause'], slowmode: ['slow'],
};
const SUBCOMMAND_WORDS = Object.fromEntries(Object.entries(WORDS).flatMap(([name, words]) => words.map((word) => [word, name])));

module.exports = {
  // Also registered as a slash command; the prefix works too.
  registerSlash: true,
  // `!mod` alone lists the subcommands instead of saying something is wrong.
  listSubcommandsWhenEmpty: true,
  prefixSubcommandAliases: SUBCOMMAND_WORDS,
  // The option that takes every word left (`!mod purge ... text`), and the shorter ways of writing a purge, as they are for the old command.
  prefixGreedyStringOptions: greedy,
  prefixArgs(argText) {
    const match = /^(\s*)(\S+)(?:\s+([\s\S]*))?$/.exec(argText ?? '');
    if (!match) return argText;
    const word = match[2].toLowerCase();
    const reader = argsReaders[SUBCOMMAND_WORDS[word] ?? word];
    return reader ? `${match[2]} ${reader(match[3] ?? '')}` : argText;
  },
  // `!mod unban <name>` also looks for the name among the people who are banned, as `!unban` does.
  prefixIncludeBans: ['unban'],
  // The rules of a server name the command that is wrapped (`!disablecommand ban` also turns off `/mod ban`, `!restrictcommand channel` `/mod lock`).
  rulesBySubcommand: true,
  ruleKeys: ruleKeysOf(SUBCOMMANDS),
  // `/timeout` is not a slash command any more (`/mod tempmute` is the same thing): a rule saved for `timeout` also reaches `/mod tempmute`.
  alsoRuleKeys: { tempmute: ['timeout'] },
  // What `!help mod ban` says is needed.
  permissionForSubcommand: executor.permissionForSubcommand,
  data: addSubcommands(
    new SlashCommandBuilder().setName('mod').setDMPermission(false).setDescription('Moderation: ban, kick, mute, warn, purge, lock and more, in one command.'),
    SUBCOMMANDS,
    load,
  ),

  // Asks for the permission of the wrapped command first (utils/umbrella.js), then runs it.
  execute: executor.execute,
};
