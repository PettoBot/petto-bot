// /staff: the moderation tools that do not fit `/mod`, as subcommands of one command (a tidier `/` list: they are found by typing `/staff`).
// Each one runs the code of the command it wraps with its options (utils/umbrella.js): `/staff voice-mute` is `!voice mute`, `/staff massban`
// is `!massban`, `/staff nuke` is `!nuke`. What a subcommand leaves out (`!thread add`, `!voice` ... `!snipe reactions`) stays in the old command,
// which keeps working as it was with the prefix. `!staff` alone lists the subcommands, and the old words are accepted (`!staff mban`).
//
// PERMISSIONS: Discord checks `default_member_permissions` for a whole command, never for one subcommand, and the commands wrapped here work
// only with the prefix, so nobody else asks for their permission when they come from a slash command. `/staff` itself is open (null:
// everybody sees it, and a server can limit it in Settings > Integrations) and each subcommand asks, when it runs, for what the wrapped command
// asks: its `default_member_permissions` (Administrator for the mass commands, Manage Channels for `nuke`...), the one of its own action when it
// has it (`voice-mute` asks for Mute Members, not for all three voice permissions), or the role chosen with `!moderation` for that command
// (`voice`, `nuke`). It is checked for the slash command and for the prefix alike, before the wrapped command runs (utils/umbrella.js); what
// the wrapped command checks by itself (the permission of the bot, the role hierarchy, the confirmation) still runs after, untouched.
const { SlashCommandBuilder } = require('discord.js');
const { addSubcommands, ruleKeysOf, prefixOptionsOf, wrappedExecutor } = require('../../utils/umbrella');

const FOLDERS = { snipe: 'utility' };
const load = (name) => require(`../${FOLDERS[name] ?? 'moderation'}/${name}`);

const SUBCOMMANDS = [
  { name: 'imute', wraps: 'imute', sub: 'user' },
  { name: 'iunmute', wraps: 'imute', sub: 'remove' },
  { name: 'rmute', wraps: 'rmute', sub: 'user' },
  { name: 'runmute', wraps: 'rmute', sub: 'remove' },
  { name: 'voice-mute', wraps: 'voice', sub: 'mute' },
  { name: 'voice-unmute', wraps: 'voice', sub: 'unmute' },
  { name: 'voice-deafen', wraps: 'voice', sub: 'deafen' },
  { name: 'voice-undeafen', wraps: 'voice', sub: 'undeafen' },
  { name: 'voice-disconnect', wraps: 'voice', sub: 'disconnect' },
  { name: 'voice-move', wraps: 'voice', sub: 'move' },
  { name: 'voice-drag', wraps: 'voice', sub: 'drag' },
  { name: 'thread-rename', wraps: 'thread', sub: 'rename' },
  { name: 'thread-lock', wraps: 'thread', sub: 'lock' },
  { name: 'thread-unlock', wraps: 'thread', sub: 'unlock' },
  { name: 'nuke', wraps: 'nuke' },
  { name: 'raid', wraps: 'raid', sub: 'clean' },
  { name: 'raid-list', wraps: 'raid', sub: 'list' },
  { name: 'massban', wraps: 'massban' },
  { name: 'masskick', wraps: 'masskick' },
  { name: 'massmute', wraps: 'massmute' },
  { name: 'massunban', wraps: 'massunban' },
  { name: 'massunmute', wraps: 'massunmute' },
  { name: 'masswarn', wraps: 'masswarn' },
  { name: 'snipe', wraps: 'snipe', sub: 'deleted' },
];

// The words of the old commands, read as the subcommand they stand for (`!staff mban @x @y spam`, `!staff picmute @x`).
const WORDS = {
  imute: ['imagemute', 'picmute'], rmute: ['reactionmute'], raid: ['recentban', 'chunkban', 'raidban'], nuke: ['nuk'], massban: ['mban'], masskick: ['mkick'],
  massmute: ['mmute'], massunban: ['munban', 'unbanall'], massunmute: ['munmute'], masswarn: ['mwarn'], snipe: ['sniped'],
};
const SUBCOMMAND_WORDS = Object.fromEntries(Object.entries(WORDS).flatMap(([name, words]) => words.map((word) => [word, name])));
const { greedy } = prefixOptionsOf(SUBCOMMANDS, load);
const executor = wrappedExecutor(load, SUBCOMMANDS);

module.exports = {
  // Also registered as a slash command; the prefix works too.
  registerSlash: true,
  // `!staff` alone lists the subcommands instead of saying something is wrong.
  listSubcommandsWhenEmpty: true,
  prefixSubcommandAliases: SUBCOMMAND_WORDS,
  // `!staff thread-rename <new name>` takes every word left as the name, as `!thread rename` does.
  prefixGreedyStringOptions: greedy,
  // The rules of a server name the command that is wrapped (`!disablecommand voice` also turns off `/staff voice-mute`); `staff` turns off all of it.
  rulesBySubcommand: true,
  ruleKeys: ruleKeysOf(SUBCOMMANDS),
  // What `!help staff voice-mute` says is needed.
  permissionForSubcommand: executor.permissionForSubcommand,
  data: addSubcommands(
    new SlashCommandBuilder().setName('staff').setDMPermission(false).setDescription('Staff tools: image and reaction mutes, voice, threads, nuke, raid and mass actions.'),
    SUBCOMMANDS,
    load,
  ),

  // The subcommands and what each wraps (read by the tests and by scripts/i18n-commands.js for the translations).
  subcommands: SUBCOMMANDS,
  execute: executor.execute,
};
