const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const mute = require('./mute');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove a timeout and Petto mute role from a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('The member to unmute').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the unmute').setRequired(false)),
  async execute(interaction) {
    return mute.execute(asSubcommand(interaction, 'remove'));
  },
};
