// /reactionunmute: gives a member their reactions and external emojis back. A command of its own (it was `/reactionmute remove`). The code is the one of `rmute`; a rule of a
// server for `rmute` applies to it as well.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const base = require('./rmute');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  registerSlash: true,
  guildScoped: true,
  hiddenFromHelp: true,
  legacyRuleNames: ['rmute'],
  data: new SlashCommandBuilder()
    .setName('reactionunmute')
    .setDescription('Give a member their reactions and external emojis back.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('The member').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason').setRequired(false)),
  async execute(interaction, client) {
    return base.execute(asSubcommand(interaction, 'remove'), client);
  },
};
