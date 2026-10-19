const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const mute = require('./mute');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  // Also registered as a slash command (one of the everyday ones people look for with `/`); the prefix keeps working.
  registerSlash: true,
  aliases: ['to'],
  // `!timeout list`: who is timed out or muted.
  prefixWords: { list: { command: 'mute', args: ['list'] } },
  data: new SlashCommandBuilder()
    .setName('timeout')
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
