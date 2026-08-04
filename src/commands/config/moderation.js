const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { textCard } = require('../../utils/caseCard');
const { COLORS } = require('../../utils/colors');
const {
  ACTIONS,
  ACTION_COMMANDS,
  allowRole,
  denyRole,
  resetAction,
  listActionRoles,
} = require('../../utils/moderationPermissions');

function actionOption(option) {
  return option
    .setName('action')
    .setDescription('Moderation action to configure.')
    .setRequired(true)
    .addChoices(...ACTIONS.map((action) => ({ name: action, value: action })));
}

module.exports = {
  aliases: ['modconfig', 'modroles'],
  prefixDefaultSubcommand: 'allow',
  data: new SlashCommandBuilder()
    .setName('moderation')
    .setDescription('Choose which roles may use individual moderation actions.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('allow').setDescription('Allow a role to use an action.').addStringOption(actionOption).addRoleOption((o) => o.setName('role').setDescription('Role to authorize').setRequired(true)))
    .addSubcommand((sub) => sub.setName('deny').setDescription('Remove a role from an action.').addStringOption(actionOption).addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true)))
    .addSubcommand((sub) => sub.setName('reset').setDescription('Remove every configured role from an action.').addStringOption(actionOption))
    .addSubcommand((sub) => sub.setName('list').setDescription('Show configured moderation roles.')),

  async execute(interaction) {
    await ensureGuild(interaction.guild.id);
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') return list(interaction);

    const action = interaction.options.getString('action', true);
    if (!ACTION_COMMANDS[action]) {
      return respond(interaction, `Unknown moderation action **${action}**.`, COLORS.RED);
    }

    if (sub === 'reset') {
      const removed = await resetAction(interaction.guild.id, action);
      return respond(interaction, removed ? `Reset moderation roles for **${action}**.` : `No roles were configured for **${action}**.`, removed ? COLORS.GREEN : COLORS.DEFAULT);
    }

    const role = interaction.options.getRole('role', true);
    if (role.managed) return respond(interaction, 'Managed integration roles cannot be used for moderation access.', COLORS.RED);

    if (sub === 'allow') {
      await allowRole(interaction.guild.id, action, role.id);
      return respond(interaction, `Allowed ${role} to use **${action}**.`, COLORS.GREEN);
    }

    const removed = await denyRole(interaction.guild.id, action, role.id);
    return respond(interaction, removed ? `Removed ${role} from **${action}**.` : `${role} was not configured for **${action}**.`, removed ? COLORS.GREEN : COLORS.DEFAULT);
  },
};

async function list(interaction) {
  const configs = await listActionRoles(interaction.guild.id);
  if (!configs.length) return respond(interaction, 'No moderation roles configured. Discord permissions still apply.');

  const lines = configs.map(({ action, roles }) => `**${action}** · ${roles.map((id) => `<@&${id}>`).join(' ')}`);
  return respond(interaction, `**Configured moderation roles**\n\n${lines.join('\n')}`);
}

function respond(interaction, message, color = COLORS.DEFAULT) {
  return interaction.reply({
    components: [textCard(message, color)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
  });
}
