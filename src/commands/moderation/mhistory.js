const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const caseCommand = require('./case');

// The cases a moderator has given: the same answer as `/case search moderator:<them>`, as a command of its own (`/mhistory`, `!mhistory <moderator>`).
module.exports = {
  registerSlash: true,
  // The 9 free global slots are kept: it is registered in each server, in the second set.
  guildScoped: true,
  aliases: ['moderationhistory'],
  data: new SlashCommandBuilder()
    .setName('mhistory')
    .setDescription('Show the cases a moderator has given.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('moderator').setDescription('The moderator').setRequired(true)),
  execute: (interaction) => caseCommand.searchByModerator(interaction),
};
