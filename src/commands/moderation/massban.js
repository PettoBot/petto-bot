const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ban = require('./ban');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  aliases: ['mban'],
  data: new SlashCommandBuilder()
    .setName('massban')
    .setDescription('Ban multiple members after confirmation.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption((option) => option.setName('users').setDescription('Mentions, IDs, or exact usernames, separated by spaces').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the bans').setRequired(false)),
  async execute(interaction) {
    return ban.execute(asSubcommand(interaction, 'users'));
  },
};
