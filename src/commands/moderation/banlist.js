// /banlist: lists the banned users, or only the hard bans. A command of its own (it was `/ban list`: `/ban` takes the options of banning directly now). The code is the one of
// `!ban list`; the prefix word is `!banlist` too.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ban = require('./ban');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  registerSlash: true,
  guildScoped: true,
  data: new SlashCommandBuilder()
    .setName('banlist')
    .setDescription('List the banned users, or only the hard bans.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addBooleanOption((option) => option.setName('hard').setDescription('Only the hard bans').setRequired(false)),
  async execute(interaction) {
    return ban.execute(asSubcommand(interaction, 'list'));
  },
};
