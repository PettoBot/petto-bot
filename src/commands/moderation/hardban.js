const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ban = require('./ban');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  aliases: ['hban'],
  data: new SlashCommandBuilder()
    .setName('hardban')
    .setDescription('Permanently ban a member and delete up to seven days of messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('The member to ban').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the ban').setRequired(false)),
  async execute(interaction) {
    const proxy = asSubcommand(interaction, 'user');
    const originalGetInteger = proxy.options.getInteger?.bind(proxy.options);
    proxy.options.getInteger = (name, required) => name === 'delete_message_days' ? 7 : originalGetInteger?.(name, required);
    return ban.execute(proxy);
  },
};
