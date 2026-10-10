const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ban = require('./ban');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  aliases: ['hban'],
  data: new SlashCommandBuilder()
    .setName('hardban')
    .setDescription('Ban a user so only the server owner and antinuke admins can unban them.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('The user to ban (works by ID if they are not in the server)').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the ban').setRequired(false)),
  async execute(interaction) {
    return ban.hardBanUser(asSubcommand(interaction, 'user'));
  },
};
