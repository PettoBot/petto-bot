// /server: everything Petto shows about a server, as subcommands of one command. Each one that has an old command (`/server info` is
// `/serverinfo`, `/server roles` is `!roles`) runs that command's own code with its options (utils/umbrella.js); only the icon, banner and
// invite splash are new (utils/serverImages.js). `!server info`, `!server roles`... work with the prefix too, and `!server` alone is
// `!server info`, as it has always been (`server` was a word of `!serverinfo`). `/serverinfo` is not a slash command any more: `/server info`
// is the same command.
//
// PERMISSIONS: `/server` is open (everybody sees it); the subcommand that wraps a command with a permission (`steal`: Manage Guild
// Expressions) asks for it when it runs, for the slash command and the prefix alike (utils/umbrella.js `wrappedExecutor`), so the rest stays open.
const { SlashCommandBuilder } = require('discord.js');
const { addSubcommands, ruleKeysOf, wrappedExecutor } = require('../../utils/umbrella');
const { serverImagePayload } = require('../../utils/serverImages');
const { languageOf } = require('../../i18n');

const FOLDERS = { steal: 'utility' };
const load = (file) => require(`../${FOLDERS[file] ?? 'info'}/${file}`);
const imageCommand = (kind) => async (interaction) => {
  const lang = await languageOf(interaction);
  await interaction.reply(serverImagePayload(interaction.guild, kind, lang));
};

const SUBCOMMANDS = [
  { name: 'info', wraps: 'serverinfo' },
  { name: 'icon', description: "Shows this server's icon, with links in every size.", rule: 'servericon', run: imageCommand('icon') },
  { name: 'banner', description: "Shows this server's banner, with links in every size.", rule: 'serverbanner', run: imageCommand('banner') },
  { name: 'splash', description: "Shows this server's invite splash, with links in every size.", rule: 'serversplash', run: imageCommand('splash') },
  { name: 'roles', wraps: 'roles' },
  { name: 'channels', wraps: 'channels' },
  { name: 'emojis', wraps: 'emojis' },
  { name: 'boosters', wraps: 'boosters' },
  { name: 'channel', wraps: 'channelinfo' },
  { name: 'role', wraps: 'roleinfo' },
  { name: 'emoji', wraps: 'emojiinfo' },
  { name: 'invite', wraps: 'inviteinfo' },
  { name: 'inrole', wraps: 'inrole' },
  { name: 'summary', wraps: 'summary' },
  { name: 'steal', wraps: 'steal' },
];

// The subcommands that wrap a command go through the gate that asks for its permission; the ones of its own (the pictures) are open.
const executor = wrappedExecutor(load, SUBCOMMANDS.filter((entry) => entry.wraps));

module.exports = {
  // Also registered as a slash command (a tidier `/` list: the server things are found by typing `/server`); the prefix works too.
  registerSlash: true,
  // `!server` alone, or with an ID, is what it always was: `!server info`.
  prefixDefaultSubcommand: 'info',
  prefixSubcommandAliases: {
    serverinfo: 'info', si: 'info', about: 'info',
    logo: 'icon', pic: 'icon',
    chs: 'channels', rl: 'roles', rolelist: 'roles', emotes: 'emojis', emojilist: 'emojis', boosts: 'boosters', boost: 'boosters',
    channelinfo: 'channel', ci: 'channel', roleinfo: 'role', ri: 'role', emojiinfo: 'emoji', ei: 'emoji', inviteinfo: 'invite', ii: 'invite',
    ir: 'inrole', members: 'inrole', digest: 'summary', weekly: 'summary', stl: 'steal',
  },
  // The rules of a server name the command that is wrapped (`!disablecommand serverinfo` also turns off `/server info`), or `servericon`...
  rulesBySubcommand: true,
  ruleKeys: ruleKeysOf(SUBCOMMANDS),
  // What `!help server steal` says is needed.
  permissionForSubcommand: executor.permissionForSubcommand,
  data: addSubcommands(
    new SlashCommandBuilder().setName('server').setDMPermission(false).setDescription('Information about this server: details, icon, banner, roles, channels and more.'),
    SUBCOMMANDS,
    load,
  ),

  // The subcommands and what each wraps (read by the tests and by scripts/i18n-commands.js).
  subcommands: SUBCOMMANDS,

  async execute(interaction, client) {
    const own = SUBCOMMANDS.find((entry) => entry.run && entry.name === interaction.options.getSubcommand());
    return own ? own.run(interaction, client) : executor.execute(interaction, client);
  },
};
