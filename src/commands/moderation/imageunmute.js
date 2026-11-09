// /imageunmute: gives a member their files and embeds back. A command of its own (it was `/imagemute remove`: `/imagemute` takes the options of muting directly now). The code is
// the one of `imute`; a rule of a server for `imute` applies to it as well.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const base = require('./imute');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  registerSlash: true,
  guildScoped: true,
  hiddenFromHelp: true,
  legacyRuleNames: ['imute'],
  data: new SlashCommandBuilder()
    .setName('imageunmute')
    .setDescription('Give a member their files and embeds back.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('The member').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason').setRequired(false)),
  async execute(interaction, client) {
    return base.execute(asSubcommand(interaction, 'remove'), client);
  },
};
