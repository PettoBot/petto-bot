const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { resolveRoles, filterAssignableRoles } = require('../../utils/roleResolve');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');

const HEX_RE = /^#?[0-9a-f]{6}$/i;

module.exports = {
  aliases: ['r'],
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Give, remove, and manage roles.')
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
    )
    .addSubcommand((sub) => sub.setName('create').setDescription('Create a new role.').addStringOption((opt) => opt.setName('name').setDescription('Role name').setRequired(true)).addStringOption((opt) => opt.setName('color').setDescription('Hex color, e.g. #ff91c2').setRequired(false)))
    .addSubcommand((sub) => sub.setName('delete').setDescription('Delete a role from the server.').addRoleOption((opt) => opt.setName('role').setDescription('Role to delete').setRequired(true)))
    .addSubcommand((sub) => sub.setName('edit').setDescription('Rename a role.').addRoleOption((opt) => opt.setName('role').setDescription('Role to rename').setRequired(true)).addStringOption((opt) => opt.setName('name').setDescription('New name').setRequired(true)))
    .addSubcommand((sub) => sub.setName('color').setDescription('Set a solid color for a role.').addRoleOption((opt) => opt.setName('role').setDescription('Role').setRequired(true)).addStringOption((opt) => opt.setName('color').setDescription('Hex color, e.g. #ff91c2').setRequired(true)))
    .addSubcommand((sub) => sub.setName('icon').setDescription('Set a role icon from a URL (requires boost level 2+).').addRoleOption((opt) => opt.setName('role').setDescription('Role').setRequired(true)).addStringOption((opt) => opt.setName('url').setDescription('Image URL').setRequired(true)))
    .addSubcommand((sub) => sub.setName('mentionable').setDescription('Toggle whether a role can be mentioned.').addRoleOption((opt) => opt.setName('role').setDescription('Role').setRequired(true)).addBooleanOption((opt) => opt.setName('value').setDescription('Mentionable?').setRequired(true)))
    .addSubcommand((sub) => sub.setName('hoist').setDescription('Toggle whether a role shows separately in the member list.').addRoleOption((opt) => opt.setName('role').setDescription('Role').setRequired(true)).addBooleanOption((opt) => opt.setName('value').setDescription('Hoisted?').setRequired(true)))
    .addSubcommand((sub) => sub.setName('bots').setDescription('Add a role to every bot in the server.').addRoleOption((opt) => opt.setName('role').setDescription('Role to give').setRequired(true)))
    .addSubcommand((sub) => sub.setName('bots-remove').setDescription('Remove a role from every bot in the server.').addRoleOption((opt) => opt.setName('role').setDescription('Role to remove').setRequired(true)))
    .addSubcommand((sub) => sub.setName('topcolor').setDescription("Copy a member's top role color onto another role.").addRoleOption((opt) => opt.setName('role').setDescription('Role to recolor').setRequired(true)).addUserOption((opt) => opt.setName('member').setDescription('Copy color from this member\'s top role').setRequired(true)))
    .addSubcommand((sub) => sub.setName('list').setDescription('Browse all roles in the server.'))
    .addSubcommand((sub) => sub.setName('in').setDescription('List members who have a specific role.').addRoleOption((opt) => opt.setName('role').setDescription('Role').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addRoles(interaction);
    if (sub === 'remove') return removeRoles(interaction);
    if (sub === 'create') return createRole(interaction);
    if (sub === 'delete') return deleteRole(interaction);
    if (sub === 'edit') return editRole(interaction);
    if (sub === 'color') return colorRole(interaction);
    if (sub === 'icon') return iconRole(interaction);
    if (sub === 'mentionable') return mentionableRole(interaction);
    if (sub === 'hoist') return hoistRole(interaction);
    if (sub === 'bots') return botsRole(interaction, true);
    if (sub === 'bots-remove') return botsRole(interaction, false);
    if (sub === 'topcolor') return topcolorRole(interaction);
    if (sub === 'list') return listRoles(interaction);
    return inRole(interaction);
  },
};

/** Shared hierarchy/managed guard for the single-role management subcommands (delete/edit/color/icon/etc). */
function guardRole(interaction, role) {
  const { assignable, blocked } = filterAssignableRoles(interaction, [role]);
  if (assignable.length) return { ok: true };
  return { ok: false, message: blocked[0] ?? "I can't manage that role." };
}

function parseHex(input) {
  if (!HEX_RE.test(input)) return null;
  return parseInt(input.replace('#', ''), 16);
}

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

async function createRole(interaction) {
  const name = interaction.options.getString('name', true).slice(0, 100);
  const colorInput = interaction.options.getString('color');
  const color = colorInput ? parseHex(colorInput) : undefined;

  if (colorInput && color == null) {
    await interaction.reply({ content: 'Invalid hex color. Use something like `#ff91c2`.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: 'I need the **Manage Roles** permission.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    const role = await interaction.guild.roles.create({ name, color, reason: `Created by ${interaction.user.tag}` });
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Created role ${role}.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to create role:', err);
    await interaction.editReply({ components: [textCard('I was unable to create that role.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function deleteRole(interaction) {
  const role = interaction.options.getRole('role', true);
  const guard = guardRole(interaction, role);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    const name = role.name;
    await role.delete(`Deleted by ${interaction.user.tag}`);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Deleted role **${name}**.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to delete role:', err);
    await interaction.editReply({ components: [textCard('I was unable to delete that role.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function editRole(interaction) {
  const role = interaction.options.getRole('role', true);
  const name = interaction.options.getString('name', true).slice(0, 100);
  const guard = guardRole(interaction, role);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await role.setName(name, `Renamed by ${interaction.user.tag}`);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Renamed role to **${name}**.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to rename role:', err);
    await interaction.editReply({ components: [textCard('I was unable to rename that role.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function colorRole(interaction) {
  const role = interaction.options.getRole('role', true);
  const colorInput = interaction.options.getString('color', true);
  const color = parseHex(colorInput);

  if (color == null) {
    await interaction.reply({ content: 'Invalid hex color. Use something like `#ff91c2`.', flags: MessageFlags.Ephemeral });
    return;
  }
  const guard = guardRole(interaction, role);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await role.setColor(color, `Recolored by ${interaction.user.tag}`);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${role}'s color is now \`#${color.toString(16).padStart(6, '0')}\`.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to recolor role:', err);
    await interaction.editReply({ components: [textCard('I was unable to recolor that role.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function iconRole(interaction) {
  const role = interaction.options.getRole('role', true);
  const url = interaction.options.getString('url', true);
  const guard = guardRole(interaction, role);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await role.setIcon(url, `Icon set by ${interaction.user.tag}`);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Set an icon on ${role}.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to set role icon:', err);
    await interaction.editReply({ components: [textCard("I was unable to set that icon. Role icons need the server to be boost level 2+, and the image must be a valid PNG/JPG under 256KB.", 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function mentionableRole(interaction) {
  const role = interaction.options.getRole('role', true);
  const value = interaction.options.getBoolean('value', true);
  const guard = guardRole(interaction, role);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await role.setMentionable(value, `Set by ${interaction.user.tag}`);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${role} is now ${value ? '' : 'not '}mentionable.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to update mentionable:', err);
    await interaction.editReply({ components: [textCard('I was unable to update that role.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function hoistRole(interaction) {
  const role = interaction.options.getRole('role', true);
  const value = interaction.options.getBoolean('value', true);
  const guard = guardRole(interaction, role);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await role.setHoist(value, `Set by ${interaction.user.tag}`);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${role} is now ${value ? '' : 'not '}shown separately in the member list.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to update hoist:', err);
    await interaction.editReply({ components: [textCard('I was unable to update that role.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function botsRole(interaction, add) {
  const role = interaction.options.getRole('role', true);
  const guard = guardRole(interaction, role);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const members = await interaction.guild.members.fetch();
  const bots = members.filter((m) => m.user.bot);

  let count = 0;
  for (const bot of bots.values()) {
    try {
      if (add) {
        if (!bot.roles.cache.has(role.id)) {
          await bot.roles.add(role, `Bulk bot role by ${interaction.user.tag}`);
          count += 1;
        }
      } else if (bot.roles.cache.has(role.id)) {
        await bot.roles.remove(role, `Bulk bot role removal by ${interaction.user.tag}`);
        count += 1;
      }
    } catch (err) {
      logger.warn(`role bots${add ? '' : '-remove'}: failed on ${bot.id}:`, err.message);
    }
  }

  const verb = add ? 'Gave' : 'Removed';
  const prep = add ? 'to' : 'from';
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${verb} ${role} ${prep} **${count}** bot(s).`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function topcolorRole(interaction) {
  const role = interaction.options.getRole('role', true);
  const targetUser = interaction.options.getUser('member', true);
  const guard = guardRole(interaction, role);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: 'That user is not a member of this server.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const color = targetMember.roles.highest.color;
  try {
    await role.setColor(color, `Color copied from ${targetUser.tag} by ${interaction.user.tag}`);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${role}'s color now matches ${targetUser}'s top role (\`#${color.toString(16).padStart(6, '0')}\`).`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to copy top color:', err);
    await interaction.editReply({ components: [textCard('I was unable to recolor that role.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function listRoles(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const roles = [...interaction.guild.roles.cache.filter((r) => r.id !== interaction.guild.id).values()].sort((a, b) => b.position - a.position);
  if (!roles.length) {
    await interaction.editReply({ components: [textCard('This server has no roles besides @everyone.', 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const shown = roles.slice(0, 40);
  const lines = shown.map((r) => `${r} — ${r.members.size} member${r.members.size === 1 ? '' : 's'}`);
  const extra = roles.length - shown.length;
  const header = `**Roles (${roles.length}):**\n`;
  const text = header + lines.join('\n') + (extra > 0 ? `\n-# +${extra} more` : '');

  await interaction.editReply({ components: [textCard(text.slice(0, 3900), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function inRole(interaction) {
  const role = interaction.options.getRole('role', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const members = [...role.members.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  if (!members.length) {
    await interaction.editReply({ components: [textCard(`No members have ${role}.`, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const shown = members.slice(0, 40);
  const lines = shown.map((m) => `${m}`);
  const extra = members.length - shown.length;
  const header = `**Members with ${role} (${members.length}):**\n`;
  const text = header + lines.join('\n') + (extra > 0 ? `\n-# +${extra} more` : '');

  await interaction.editReply({ components: [textCard(text.slice(0, 3900), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}
