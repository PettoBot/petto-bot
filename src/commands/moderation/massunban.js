const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ban = require('./ban');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  aliases: ['munban', 'unbanall'],
  // `!unbanall cancel` stops the one that is running.
  prefixWords: { cancel: { command: 'ban', args: ['cancel'] }, kill: { command: 'ban', args: ['cancel'] } },
  data: new SlashCommandBuilder()
    .setName('massunban')
    .setDescription('Unban every banned user after administrator confirmation.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the mass unban').setRequired(false)),
  async execute(interaction) {
    return ban.execute(asSubcommand(interaction, 'remove-all'));
  },
};
