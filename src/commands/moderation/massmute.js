const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const mute = require('./mute');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  aliases: ['mmute'],
  data: new SlashCommandBuilder()
    .setName('massmute')
    .setDescription('Mute multiple members after confirmation.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addStringOption((option) => option.setName('users').setDescription('User mentions or IDs, separated by spaces').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the mutes').setRequired(false)),
  async execute(interaction) {
    return mute.execute(asSubcommand(interaction, 'users'));
  },
};
