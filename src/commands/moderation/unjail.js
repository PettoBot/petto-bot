const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const jail = require('./jail');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unjail')
    .setDescription('Release a member from jail and give their roles back.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('The member to release').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the release').setRequired(false)),
  async execute(interaction) {
    return jail.execute(asSubcommand(interaction, 'remove'));
  },
};
