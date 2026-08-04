const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ban = require('./ban');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
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
