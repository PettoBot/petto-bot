const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const mute = require('./mute');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  // Not a slash command any more: `/mute` takes an optional `duration` (without it the mute is permanent). `!tempmute` (and its aliases) keep working with the prefix, and `/mod tempmute` too.
  registerSlash: false,
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
