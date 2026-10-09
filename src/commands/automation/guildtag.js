const { SlashCommandBuilder } = require('discord.js');
const { addSubcommands, execute, PERMISSION } = require('../../utils/identity/commands');

module.exports = {
  aliases: ['servertag', 'tag', 'gt'],
  // Only with the prefix: no slash command is registered for it.
  prefixOnly: true,
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
