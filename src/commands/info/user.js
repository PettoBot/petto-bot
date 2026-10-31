// /user: everything Petto shows about a member, as subcommands of one command. Each one runs the code of the command it wraps, with its
// options (`/user info` is `/userinfo`, `/user avatar` is `/avatar`; utils/umbrella.js). `!user avatar @someone` works with the prefix too,
// and `!user` alone (or `!user @someone`) is `!user info`.
const { SlashCommandBuilder } = require('discord.js');
const { addSubcommands, runSubcommand, ruleKeysOf } = require('../../utils/umbrella');

const load = (file) => require(`./${file}`);

const SUBCOMMANDS = [
  { name: 'info', wraps: 'userinfo' },
  { name: 'avatar', wraps: 'avatar' },
  { name: 'banner', wraps: 'banner' },
  { name: 'cosmetics', wraps: 'usercosmetics' },
  { name: 'permissions', wraps: 'permissions' },
  { name: 'id', wraps: 'snowflake' },
  { name: 'first-message', wraps: 'firstmessage' },
  { name: 'activity', wraps: 'activity', sub: 'view' },
];

module.exports = {
  // Also registered as a slash command (a tidier `/` list: the member things are found by typing `/user`); the prefix works too.
  registerSlash: true,
  // `!user` alone, or with a member, is `!user info`.
  prefixDefaultSubcommand: 'info',
  prefixSubcommandAliases: {
    userinfo: 'info', ui: 'info', whois: 'info', profile: 'info',
    av: 'avatar', pfp: 'avatar', bn: 'banner',
    usercosmetics: 'cosmetics', cosmetic: 'cosmetics', uc: 'cosmetics',
    perms: 'permissions', perm: 'permissions',
    snowflake: 'id', sf: 'id',
    firstmessage: 'first-message', firstmsg: 'first-message', first: 'first-message', fm: 'first-message',
    act: 'activity', ac: 'activity',
  },
  // The rules of a server name the command that is wrapped (`!disablecommand avatar` also turns off `/user avatar`).
  rulesBySubcommand: true,
  ruleKeys: ruleKeysOf(SUBCOMMANDS),
  data: addSubcommands(
    new SlashCommandBuilder().setName('user').setDMPermission(false).setDescription('Information about a member: details, avatar, banner, permissions, activity and more.'),
    SUBCOMMANDS,
    load,
  ),

  async execute(interaction, client) {
    return runSubcommand(SUBCOMMANDS, load, interaction, client);
  },
};
