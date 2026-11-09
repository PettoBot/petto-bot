// /jaillist: shows who is in jail right now. A command of its own (it was `/jail list`). The code is the one of `!jail list`.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const jail = require('./jail');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  registerSlash: true,
  guildScoped: true,
  data: new SlashCommandBuilder()
    .setName('jaillist')
    .setDescription('Show who is in jail right now.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),
  async execute(interaction) {
    return jail.execute(asSubcommand(interaction, 'list'));
  },
};
