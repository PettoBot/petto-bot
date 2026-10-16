const { SlashCommandBuilder } = require('discord.js');
const { addSubcommands, autocomplete, execute, PERMISSION } = require('../../utils/identity/commands');

module.exports = {
  aliases: ['servertag', 'tag', 'gt'],
  // Works with the prefix (the subcommands are written as words) and as a slash command, which is easier for the rules with several options.
  registerSlash: true,
  data: addSubcommands(
    new SlashCommandBuilder()
      .setName('guildtag')
      .setDescription('Give or remove a role from members by the Server Tag they wear.')
      .setDefaultMemberPermissions(PERMISSION)
      .setDMPermission(false),
    'guildtag',
  ),
  execute: (interaction) => execute(interaction, 'guildtag'),
  // The `embed` option of notify lists the saved embeds of the server as it is typed.
  autocomplete,
};
