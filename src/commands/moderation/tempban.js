const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ban = require('./ban');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  aliases: ['tban'],
  data: new SlashCommandBuilder()
    .setName('tempban')
    .setDescription('Temporarily ban a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('The member to ban').setRequired(true))
    .addStringOption((option) => option.setName('duration').setDescription('For example 1d, 12h or 2w').setRequired(true))
    .addIntegerOption((option) => option.setName('delete_message_days').setDescription('Delete recent messages from 0 to 7 days').setMinValue(0).setMaxValue(7).setRequired(false))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the temporary ban').setRequired(false)),
  async execute(interaction) {
    return ban.execute(asSubcommand(interaction, 'temp'));
  },
};
