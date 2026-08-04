const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ban = require('./ban');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  aliases: ['mban'],
  data: new SlashCommandBuilder()
    .setName('massban')
    .setDescription('Ban multiple members after confirmation.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addStringOption((option) => option.setName('users').setDescription('User mentions or IDs, separated by spaces').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the bans').setRequired(false)),
  async execute(interaction) {
    return ban.execute(asSubcommand(interaction, 'users'));
  },
};
