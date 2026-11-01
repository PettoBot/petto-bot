const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ban = require('./ban');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  // Not registered as a slash command any more: `/mod unban` replaces it (same options, same code). It keeps working with the prefix.
  registerSlash: false,
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Remove a ban from a user.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('The user to unban').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the unban').setRequired(false)),
  async execute(interaction) {
    return ban.execute(asSubcommand(interaction, 'remove'));
  },
};
