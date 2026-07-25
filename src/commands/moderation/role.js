const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { resolveRoles, filterAssignableRoles } = require('../../utils/roleResolve');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');

module.exports = {
  aliases: ['r'],
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Give or remove roles from a user.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Give one or more roles to a user.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to give roles to').setRequired(true))
        .addStringOption((opt) => opt.setName('roles').setDescription('Role mentions/IDs/names, space or comma separated').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason (shown in the audit log)').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove one or more roles from a user.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to remove roles from').setRequired(true))
        .addStringOption((opt) => opt.setName('roles').setDescription('Role mentions/IDs/names, space or comma separated').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason (shown in the audit log)').setRequired(false)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addRoles(interaction);
    return removeRoles(interaction);
  },
};

async function addRoles(interaction) {
  const targetUser = interaction.options.getUser('user', true);
  const rolesInput = interaction.options.getString('roles', true);
  const reason = interaction.options.getString('reason');

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: 'That user is not a member of this server.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: 'I need the **Manage Roles** permission.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const { resolved, unresolved } = resolveRoles(interaction.guild, rolesInput);
  const { assignable, blocked } = filterAssignableRoles(interaction, resolved);

  if (!assignable.length) {
    await interaction.editReply({
      components: [textCard('No roles could be added. ' + [...unresolved.map((t) => `Not found: \`${t}\``), ...blocked].join(', '), 0xfe6465)],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  await targetMember.roles.add(assignable, reason ?? undefined).catch((err) => logger.error('Failed to add roles:', err));

  const lines = [`${EMOJI.APPROVE}  Gave ${targetUser} ${assignable.length} role(s): ${assignable.join(' ')}`];
  if (unresolved.length) lines.push(`Not found: ${unresolved.map((t) => `\`${t}\``).join(', ')}`);
  if (blocked.length) lines.push(`Skipped: ${blocked.join(', ')}`);

  await interaction.editReply({ components: [textCard(lines.join('\n'), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function removeRoles(interaction) {
  const targetUser = interaction.options.getUser('user', true);
  const rolesInput = interaction.options.getString('roles', true);
  const reason = interaction.options.getString('reason');

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: 'That user is not a member of this server.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: 'I need the **Manage Roles** permission.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const { resolved, unresolved } = resolveRoles(interaction.guild, rolesInput);
  const { assignable, blocked } = filterAssignableRoles(interaction, resolved);

  if (!assignable.length) {
    await interaction.editReply({
      components: [textCard('No roles could be removed. ' + [...unresolved.map((t) => `Not found: \`${t}\``), ...blocked].join(', '), 0xfe6465)],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  await targetMember.roles.remove(assignable, reason ?? undefined).catch((err) => logger.error('Failed to remove roles:', err));

  const lines = [`${EMOJI.APPROVE}  Removed ${assignable.length} role(s) from ${targetUser}: ${assignable.join(' ')}`];
  if (unresolved.length) lines.push(`Not found: ${unresolved.map((t) => `\`${t}\``).join(', ')}`);
  if (blocked.length) lines.push(`Skipped: ${blocked.join(', ')}`);

  await interaction.editReply({ components: [textCard(lines.join('\n'), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}
