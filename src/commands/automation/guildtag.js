const { SlashCommandBuilder } = require('discord.js');
const { addSubcommands, execute, PERMISSION } = require('../../utils/identity/commands');

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
};
