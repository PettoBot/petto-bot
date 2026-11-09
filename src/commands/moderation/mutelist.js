// /mutelist: lists the members who are timed out or have the mute role. A command of its own (it was `/mute list`). The code is the one of `!mute list`.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const mute = require('./mute');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  registerSlash: true,
  guildScoped: true,
  data: new SlashCommandBuilder()
    .setName('mutelist')
    .setDescription('List the members who are timed out or have the mute role.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),
  async execute(interaction) {
    return mute.execute(asSubcommand(interaction, 'list'));
  },
};
