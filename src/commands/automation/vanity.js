const { SlashCommandBuilder } = require('discord.js');
const { addSubcommands, execute, PERMISSION } = require('../../utils/identity/commands');

module.exports = {
  aliases: ['vy'],
  // Works with the prefix (the subcommands are written as words) and as a slash command, which is easier for the rules with several options.
  registerSlash: true,
  data: addSubcommands(
    new SlashCommandBuilder()
      .setName('vanity')
      .setDescription('Give or remove a role from members by their Custom Status, name or nickname.')
      .setDefaultMemberPermissions(PERMISSION)
      .setDMPermission(false),
    'vanity',
  ),
  execute: (interaction) => execute(interaction, 'vanity'),
};
