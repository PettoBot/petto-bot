const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const warn = require('./warn');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  aliases: ['mwarn'],
  data: new SlashCommandBuilder()
    .setName('masswarn')
    .setDescription('Warn multiple members after confirmation.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addStringOption((option) => option.setName('users').setDescription('User mentions or IDs, separated by spaces').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the warnings').setRequired(true)),
  async execute(interaction) {
    return warn.execute(asSubcommand(interaction, 'users'));
  },
};
