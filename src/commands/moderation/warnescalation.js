// /warnescalation: the automatic consequences once a member reaches a number of warnings (`add`, `remove`, `list`). A command of its own (it was `/warn escalation ...`: `/warn`
// takes the options of warning directly now). The code is the one of `!warn escalation ...`.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const warn = require('./warn');
const { asSubcommand } = require('../../utils/moderationCommand');

module.exports = {
  registerSlash: true,
  guildScoped: true,
  data: new SlashCommandBuilder()
    .setName('warnescalation')
    .setDescription('Automatic consequences once a user reaches a certain number of warnings.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('add')
      .setDescription('Set what happens at a warning threshold.')
      .addIntegerOption((opt) => opt.setName('threshold').setDescription('Warning count that triggers this').setRequired(true).setMinValue(1))
      .addStringOption((opt) => opt.setName('action').setDescription('What to do').setRequired(true)
        .addChoices({ name: 'mute (indefinite)', value: 'mute' }, { name: 'tempmute', value: 'tempmute' }, { name: 'jail', value: 'jail' }, { name: 'kick', value: 'kick' }, { name: 'ban', value: 'ban' }))
      .addStringOption((opt) => opt.setName('duration').setDescription('Duration for tempmute (required) or jail (optional), e.g. 1h, 12h, 1d').setRequired(false)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a threshold rule.').addIntegerOption((opt) => opt.setName('threshold').setDescription('Warning count').setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub.setName('list').setDescription('List escalation rules.')),
  async execute(interaction, client) {
    // `/warnescalation add` is `/warn escalation add` for the code of `warn`: the same subcommand inside the group.
    const inGroup = asSubcommand(interaction, interaction.options.getSubcommand());
    inGroup.options.getSubcommandGroup = () => 'escalation';
    return warn.execute(inGroup, client);
  },
};
