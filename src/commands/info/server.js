// /server: everything Petto shows about a server, as subcommands of one command. Each one that has an old command (`/server info` is
// `/serverinfo`, `/server roles` is `!roles`) runs that command's own code with its options (utils/umbrella.js); only the icon, banner and
// invite splash are new (utils/serverImages.js). `!server info`, `!server roles`... work with the prefix too, and `!server` alone is
// `!server info`, as it has always been (`server` was a word of `!serverinfo`).
const { SlashCommandBuilder } = require('discord.js');
const { addSubcommands, runSubcommand, ruleKeysOf } = require('../../utils/umbrella');
const { serverImagePayload } = require('../../utils/serverImages');
const { languageOf } = require('../../i18n');

const load = (file) => require(`./${file}`);
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
];

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
  },
  // The rules of a server name the command that is wrapped (`!disablecommand serverinfo` also turns off `/server info`), or `servericon`...
  rulesBySubcommand: true,
  ruleKeys: ruleKeysOf(SUBCOMMANDS),
  data: addSubcommands(
    new SlashCommandBuilder().setName('server').setDMPermission(false).setDescription('Information about this server: details, icon, banner, roles, channels and more.'),
    SUBCOMMANDS,
    load,
  ),

  async execute(interaction, client) {
    return runSubcommand(SUBCOMMANDS, load, interaction, client);
  },
};
