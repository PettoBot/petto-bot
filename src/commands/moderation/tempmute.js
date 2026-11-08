const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const mute = require('./mute');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  // A slash command of its own (`/tempban user duration`): a ban or a mute that ends is named that way, not `/ban temp`.
  registerSlash: true,
  aliases: ['tmute'],
  data: new SlashCommandBuilder()
    .setName('tempmute')
    .setDescription('Apply a Discord timeout for up to 28 days.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('The member to timeout').setRequired(true))
    .addStringOption((option) => option.setName('duration').setDescription('For example 10m, 2h or 7d').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the timeout').setRequired(false)),
  async execute(interaction) {
    return mute.execute(asSubcommand(interaction, 'temp'));
  },
};
