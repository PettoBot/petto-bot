const { SlashCommandBuilder } = require('discord.js');
const { addSubcommands, execute, PERMISSION } = require('../../utils/identity/commands');

module.exports = {
  aliases: ['vy'],
  // Only with the prefix: no slash command is registered for it.
  prefixOnly: true,
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
