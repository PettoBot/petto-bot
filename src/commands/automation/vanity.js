const { SlashCommandBuilder } = require('discord.js');
const { addSubcommands, autocomplete, execute, requireManageGuild } = require('../../utils/identity/commands');

module.exports = {
  aliases: ['vy'],
  // Works with the prefix (the subcommands are written as words) and as a slash command, which is easier for the rules with several options.
  registerSlash: true,
  // Shown in the menu to everybody; the permission (Manage Server) is checked when it runs, with the slash and with the prefix.
  data: addSubcommands(
    new SlashCommandBuilder()
      .setName('vanity')
      .setDescription('Give or remove a role from members by their Custom Status, name or nickname.')
      .setDMPermission(false),
    'vanity',
  ),
  execute: async (interaction) => {
    if (await requireManageGuild(interaction)) await execute(interaction, 'vanity');
  },
  // The `embed` option of notify lists the saved embeds of the server as it is typed.
  autocomplete,
};
