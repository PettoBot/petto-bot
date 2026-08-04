const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { resolveRoles, filterAssignableRoles } = require('../../utils/roleResolve');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const roleGroupsDb = require('../../db/roleGroups');
const { requireAdministrator } = require('../../utils/moderationCommand');
const logger = require('../../utils/logger');

const HEX_RE = /^#?[0-9a-f]{6}$/i;
const MASS_OP_DELAY_MS = 500; // spaced out so a big member list doesn't slam Discord's rate limit

// One mass role operation (has/humans/bots) at a time per guild, so /role cancel has something
// concrete to grab — same trade-off as bli: in-memory only, lost on restart, acceptable since
// these are short-lived (minutes at most) foreground tasks, not persisted jobs.
const activeMassOps = new Map(); // guildId -> { abort: boolean }

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
    .addSubcommand((sub) => sub.setName('in').setDescription('List members who have a specific role.').addRoleOption((opt) => opt.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand((sub) =>
      sub
        .setName('has')
        .setDescription('Bulk add/remove a role for every member who has another role.')
        .addRoleOption((opt) => opt.setName('filter_role').setDescription('Members must have this role').setRequired(true))
        .addRoleOption((opt) => opt.setName('target_role').setDescription('Role to add or remove').setRequired(true))
        .addBooleanOption((opt) => opt.setName('remove').setDescription('Remove instead of add (default: add)').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('humans')
        .setDescription('Bulk add/remove a role for every non-bot member.')
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to add or remove').setRequired(true))
        .addBooleanOption((opt) => opt.setName('remove').setDescription('Remove instead of add (default: add)').setRequired(false)),
    )
    .addSubcommand((sub) => sub.setName('cancel').setDescription('Cancel the mass role operation currently running in this server.'))

    .addSubcommandGroup((g) =>
      g
        .setName('group')
        .setDescription('Named sets of roles, for bulk give/take in one shot.')
        .addSubcommand((s) => s.setName('create').setDescription('Create/update a role group.').addStringOption((o) => o.setName('name').setDescription('Group name').setRequired(true)).addStringOption((o) => o.setName('roles').setDescription('Role mentions/IDs/names, space or comma separated').setRequired(true)))
        .addSubcommand((s) => s.setName('delete').setDescription('Delete a role group.').addStringOption((o) => o.setName('name').setDescription('Group name').setRequired(true)))
        .addSubcommand((s) => s.setName('view').setDescription('Show the roles in a group.').addStringOption((o) => o.setName('name').setDescription('Group name').setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('List all role groups.'))
        .addSubcommand((s) => s.setName('give').setDescription("Give a group's roles to a member.").addStringOption((o) => o.setName('name').setDescription('Group name').setRequired(true)).addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)))
        .addSubcommand((s) => s.setName('take').setDescription("Remove a group's roles from a member.").addStringOption((o) => o.setName('name').setDescription('Group name').setRequired(true)).addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))),
    ),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    if (group === 'group') return groupCmd(interaction);

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
    if (sub === 'in') return inRole(interaction);
    if (sub === 'has') return hasRole(interaction);
    if (sub === 'humans') return humansRole(interaction);
    return cancelMassOp(interaction);
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
  if (!(await requireAdministrator(interaction))) return;
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
    await interaction.editReply({ components: [textCard('This server has no roles besides @everyone.', 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const shown = roles.slice(0, 40);
  const lines = shown.map((r) => `${r} — ${r.members.size} member${r.members.size === 1 ? '' : 's'}`);
  const extra = roles.length - shown.length;
  const header = `**Roles (${roles.length}):**\n`;
  const text = header + lines.join('\n') + (extra > 0 ? `\n-# +${extra} more` : '');

  await interaction.editReply({ components: [textCard(text.slice(0, 3900), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function inRole(interaction) {
  const role = interaction.options.getRole('role', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const members = [...role.members.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  if (!members.length) {
    await interaction.editReply({ components: [textCard(`No members have ${role}.`, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const shown = members.slice(0, 40);
  const lines = shown.map((m) => `${m}`);
  const extra = members.length - shown.length;
  const header = `**Members with ${role} (${members.length}):**\n`;
  const text = header + lines.join('\n') + (extra > 0 ? `\n-# +${extra} more` : '');

  await interaction.editReply({ components: [textCard(text.slice(0, 3900), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Adds/removes `role` for every member in `members`, one at a time with a delay, abortable via /role cancel. */
async function runMassOp(interaction, role, members, adding) {
  const guildId = interaction.guild.id;
  const task = { abort: false };
  activeMassOps.set(guildId, task);

  const verb = adding ? 'Adding' : 'Removing';
  await interaction.editReply({ components: [textCard(`${EMOJI.WARNING}  ${verb} ${role} for **${members.length}** member(s)... use \`!role cancel\` to stop.`, 0xfed53c)], flags: MessageFlags.IsComponentsV2 });

  let done = 0;
  for (const member of members) {
    if (task.abort) break;
    try {
      if (adding) await member.roles.add(role, `Mass role by ${interaction.user.tag}`);
      else await member.roles.remove(role, `Mass role by ${interaction.user.tag}`);
      done++;
    } catch (err) {
      logger.warn(`role mass op: failed on ${member.id}:`, err.message);
    }
    await delay(MASS_OP_DELAY_MS);
  }

  if (activeMassOps.get(guildId) === task) activeMassOps.delete(guildId);

  const suffix = task.abort ? ' (cancelled)' : '';
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${adding ? 'Added' : 'Removed'} ${role} for **${done}** member(s)${suffix}.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function hasRole(interaction) {
  if (!(await requireAdministrator(interaction))) return;
  const filterRole = interaction.options.getRole('filter_role', true);
  const targetRole = interaction.options.getRole('target_role', true);
  const removing = interaction.options.getBoolean('remove') ?? false;

  const guard = guardRole(interaction, targetRole);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }
  if (activeMassOps.has(interaction.guild.id)) {
    await interaction.reply({ content: 'A mass role operation is already running in this server. Use `!role cancel` first.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const members = [...interaction.guild.members.cache.filter((m) => m.roles.cache.has(filterRole.id) && (removing ? m.roles.cache.has(targetRole.id) : !m.roles.cache.has(targetRole.id))).values()];
  if (!members.length) {
    await interaction.editReply({ components: [textCard(`No members with ${filterRole} need ${targetRole} ${removing ? 'removed' : 'added'}.`, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await runMassOp(interaction, targetRole, members, !removing);
}

async function humansRole(interaction) {
  if (!(await requireAdministrator(interaction))) return;
  const role = interaction.options.getRole('role', true);
  const removing = interaction.options.getBoolean('remove') ?? false;

  const guard = guardRole(interaction, role);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }
  if (activeMassOps.has(interaction.guild.id)) {
    await interaction.reply({ content: 'A mass role operation is already running in this server. Use `!role cancel` first.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const members = [...interaction.guild.members.cache.filter((m) => !m.user.bot && (removing ? m.roles.cache.has(role.id) : !m.roles.cache.has(role.id))).values()];
  if (!members.length) {
    await interaction.editReply({ components: [textCard(`No humans need ${role} ${removing ? 'removed' : 'added'}.`, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await runMassOp(interaction, role, members, !removing);
}

async function cancelMassOp(interaction) {
  if (!(await requireAdministrator(interaction))) return;
  const task = activeMassOps.get(interaction.guild.id);
  if (!task) {
    await interaction.reply({ content: 'No mass role operation is running.', flags: MessageFlags.Ephemeral });
    return;
  }
  task.abort = true;
  await interaction.reply({ content: `${EMOJI.APPROVE}  Cancelling — in-flight member will finish, then it stops.`, flags: MessageFlags.Ephemeral });
}

// ── Role groups ──────────────────────────────────────────────────────────────

async function groupCmd(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'create') return groupCreate(interaction);
  if (sub === 'delete') return groupDelete(interaction);
  if (sub === 'view') return groupView(interaction);
  if (sub === 'list') return groupList(interaction);
  if (sub === 'give') return groupGive(interaction);
  return groupTake(interaction);
}

async function groupCreate(interaction) {
  const name = interaction.options.getString('name', true).toLowerCase().slice(0, 60);
  const rolesInput = interaction.options.getString('roles', true);

  const { resolved, unresolved } = resolveRoles(interaction.guild, rolesInput);
  if (!resolved.length) {
    await interaction.reply({ content: 'No valid roles found in that input.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await roleGroupsDb.upsertGroup(interaction.guild.id, name, resolved.map((r) => r.id));

  const lines = [`${EMOJI.APPROVE}  Group **${name}** saved with **${resolved.length}** role(s): ${resolved.join(' ')}`];
  if (unresolved.length) lines.push(`Not found: ${unresolved.map((t) => `\`${t}\``).join(', ')}`);
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function groupDelete(interaction) {
  const name = interaction.options.getString('name', true).toLowerCase();
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const deleted = await roleGroupsDb.deleteGroup(interaction.guild.id, name);
  await interaction.editReply({ components: [textCard(deleted ? `${EMOJI.APPROVE}  Group **${name}** deleted.` : `Group **${name}** not found.`, deleted ? 0xa5ea7a : 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
}

async function groupView(interaction) {
  const name = interaction.options.getString('name', true).toLowerCase();
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const group = await roleGroupsDb.getGroup(interaction.guild.id, name);
  if (!group) {
    await interaction.editReply({ components: [textCard(`Group **${name}** not found.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const text = group.role_ids.length ? group.role_ids.map((id, i) => `${i + 1}. <@&${id}>`).join('\n') : '*No roles in this group.*';
  await interaction.editReply({ components: [textCard(`**Group: ${group.name}**\n${text}`, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function groupList(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const groups = await roleGroupsDb.listGroups(interaction.guild.id);
  if (!groups.length) {
    await interaction.editReply({ components: [textCard('No role groups configured. Create one with `!role group create`.', 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = groups.map((g) => `**${g.name}** (${g.role_ids.length}) — ${g.role_ids.length ? g.role_ids.map((id) => `<@&${id}>`).join(', ') : '*none*'}`);
  await interaction.editReply({ components: [textCard(lines.join('\n').slice(0, 3900), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function groupGive(interaction) {
  const name = interaction.options.getString('name', true).toLowerCase();
  const targetUser = interaction.options.getUser('user', true);

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const group = await roleGroupsDb.getGroup(interaction.guild.id, name);
  if (!group) {
    await interaction.editReply({ components: [textCard(`Group **${name}** not found.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.editReply({ components: [textCard('That user is not a member of this server.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const roles = group.role_ids.map((id) => interaction.guild.roles.cache.get(id)).filter(Boolean);
  const { assignable, blocked } = filterAssignableRoles(interaction, roles);
  if (!assignable.length) {
    await interaction.editReply({ components: [textCard(`No valid roles to assign from group **${name}**. ${blocked.join(', ')}`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await targetMember.roles.add(assignable, `Role group '${name}' given by ${interaction.user.tag}`).catch((err) => logger.warn('role group give failed:', err.message));
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Gave **${assignable.length}** role(s) from group **${name}** to ${targetUser}.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function groupTake(interaction) {
  const name = interaction.options.getString('name', true).toLowerCase();
  const targetUser = interaction.options.getUser('user', true);

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const group = await roleGroupsDb.getGroup(interaction.guild.id, name);
  if (!group) {
    await interaction.editReply({ components: [textCard(`Group **${name}** not found.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.editReply({ components: [textCard('That user is not a member of this server.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const roles = group.role_ids.map((id) => interaction.guild.roles.cache.get(id)).filter(Boolean).filter((r) => targetMember.roles.cache.has(r.id));
  if (!roles.length) {
    await interaction.editReply({ components: [textCard(`${targetUser} doesn't have any roles from group **${name}**.`, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await targetMember.roles.remove(roles, `Role group '${name}' taken by ${interaction.user.tag}`).catch((err) => logger.warn('role group take failed:', err.message));
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Removed **${roles.length}** role(s) from group **${name}** from ${targetUser}.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}
