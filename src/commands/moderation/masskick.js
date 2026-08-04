const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const kick = require('./kick');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  aliases: ['mkick'],
  data: new SlashCommandBuilder()
    .setName('masskick')
    .setDescription('Kick multiple members after confirmation.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption((option) => option.setName('users').setDescription('User mentions or IDs, separated by spaces').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the kicks').setRequired(false)),
  async execute(interaction) {
    return kick.execute(asSubcommand(interaction, 'users'));
  },
};
