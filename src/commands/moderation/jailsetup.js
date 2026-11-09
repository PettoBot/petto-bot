// /jailsetup: creates the jail role and channel, or repairs them. A command of its own (it was `/jail setup`). The code is the one of `!jail setup` (it asks for Manage Server).
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const jail = require('./jail');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  registerSlash: true,
  guildScoped: true,
  data: new SlashCommandBuilder()
    .setName('jailsetup')
    .setDescription('Create the jail role and channel, or repair them.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  async execute(interaction) {
    return jail.execute(asSubcommand(interaction, 'setup'));
  },
};
