// Role management commands, including guarded bulk operations.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { resolveRoles, filterAssignableRoles } = require('../../utils/roleResolve');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const roleGroupsDb = require('../../db/roleGroups');
const { requireAdministrator } = require('../../utils/moderationCommand');
const tempRolesDb = require('../../db/tempRoles');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { handleStaffAction } = require('../../logging/moreLog');
const logger = require('../../utils/logger');
const { t, tn, languageOf } = require('../../i18n');

const HEX_RE = /^#?[0-9a-f]{6}$/i;
const MASS_OP_DELAY_MS = 500; // spaced out so a big member list doesn't slam Discord's rate limit
const MASS_PROGRESS_EVERY = 25; // the progress card is updated every this many members
const MAX_TEMP_ROLE_MS = 365 * 24 * 60 * 60 * 1000;

// One mass role operation (has/humans/bots) at a time per guild, so /role cancel has something
// concrete to grab — same trade-off as bli: in-memory only, lost on restart, acceptable since
// these are short-lived (minutes at most) foreground tasks, not persisted jobs.
const activeMassOps = new Map(); // guildId -> { abort: boolean }

module.exports = {
  // Also registered as a slash command (it already has subcommands, so it needs no umbrella); the prefix keeps working.
  registerSlash: true,
  aliases: ['r'],
  // `!role @user Role` gives it; the words other bots use for each subcommand work too.
  prefixDefaultSubcommand: 'add',
  prefixSubcommandAliases: { give: 'add', set: 'add', take: 'remove', rmv: 'remove', make: 'create', del: 'delete', rename: 'edit', editname: 'edit', colour: 'color', mention: 'mentionable', kill: 'cancel', templist: 'temp-list', temprole: 'temp' },
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
    .addSubcommand((sub) => sub.setName('edit').setDescription('Change the name of a role.').addRoleOption((opt) => opt.setName('role').setDescription('Role to rename').setRequired(true)).addStringOption((opt) => opt.setName('name').setDescription('New name').setRequired(true)))
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
    .addSubcommand((sub) =>
      sub
        .setName('all')
        .setDescription('Bulk add/remove a role for every member, bots included.')
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to add or remove').setRequired(true))
        .addBooleanOption((opt) => opt.setName('remove').setDescription('Remove instead of add (default: add)').setRequired(false)),
    )
    .addSubcommand((sub) => sub.setName('cancel').setDescription('Cancel the mass role operation currently running in this server.'))
    .addSubcommand((sub) =>
      sub
        .setName('temp')
        .setDescription('Give a role for a while; Petto takes it away when the time is up.')
        .addUserOption((opt) => opt.setName('user').setDescription('The member').setRequired(true))
        .addRoleOption((opt) => opt.setName('role').setDescription('The role').setRequired(true))
        .addStringOption((opt) => opt.setName('duration').setDescription('For example 1h, 3d or 2w (max 1 year)').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('temp-list').setDescription('List the temporary roles and when they end.'))

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
    if (sub === 'all') return allRole(interaction);
    if (sub === 'temp') return tempRole(interaction);
    if (sub === 'temp-list') return tempRoleList(interaction);
    return cancelMassOp(interaction);
  },
};

/** Shared hierarchy/managed guard for the single-role management subcommands (delete/edit/color/icon/etc). */
function guardRole(interaction, role, lang) {
  const { assignable, blocked } = filterAssignableRoles(interaction, [role], lang);
  if (assignable.length) return { ok: true };
  return { ok: false, message: blocked[0] ?? t(lang, 'moderation.role.cannotManage') };
}

/**
 * Roles of someone at or above the moderator are not theirs to change (the owner can change anyone's). The moderator's own
 * roles are fine: the roles themselves are still checked against both highest roles.
 */
function memberGuard(interaction, member, lang) {
  const { guild } = interaction;
  if (member.id === interaction.user.id || interaction.user.id === guild.ownerId) return null;
  if (member.id === guild.ownerId) return t(lang, 'core.moderate.owner');
  if (member.roles.highest.position >= interaction.member.roles.highest.position) return t(lang, 'core.moderate.higherRole');
  return null;
}

function parseHex(input) {
  if (!HEX_RE.test(input)) return null;
  return parseInt(input.replace('#', ''), 16);
}

async function addRoles(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  const rolesInput = interaction.options.getString('roles', true);
  const reason = interaction.options.getString('reason');

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: t(lang, 'moderation.common.notMember'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: t(lang, 'moderation.role.needsManageRoles'), flags: MessageFlags.Ephemeral });
    return;
  }
  const guarded = memberGuard(interaction, targetMember, lang);
  if (guarded) {
    await interaction.reply({ content: guarded, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const { resolved, unresolved } = resolveRoles(interaction.guild, rolesInput);
  const { assignable, blocked } = filterAssignableRoles(interaction, resolved, lang);

  if (!assignable.length) {
    await interaction.editReply({
      components: [textCard(t(lang, 'moderation.role.noneAdded', { details: [...unresolved.map((token) => t(lang, 'moderation.common.notFound', { list: `\`${token}\`` })), ...blocked].join(', ') }), 0xfe6465)],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const addFailed = await targetMember.roles.add(assignable, reason ?? undefined).then(() => null, (err) => err);
  if (addFailed) {
    logger.warn(`Failed to add roles to ${targetMember.id} in ${interaction.guild.id}: ${addFailed.message}`);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.changeFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = [tn(lang, 'moderation.role.added', assignable.length, { emoji: EMOJI.APPROVE, user: `${targetUser}`, count: assignable.length, roles: assignable.join(' ') })];
  if (unresolved.length) lines.push(t(lang, 'moderation.common.notFound', { list: unresolved.map((token) => `\`${token}\``).join(', ') }));
  if (blocked.length) lines.push(t(lang, 'moderation.common.skipped', { list: blocked.join(', ') }));

  await interaction.editReply({ components: [textCard(lines.join('\n'), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function removeRoles(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  const rolesInput = interaction.options.getString('roles', true);
  const reason = interaction.options.getString('reason');

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: t(lang, 'moderation.common.notMember'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: t(lang, 'moderation.role.needsManageRoles'), flags: MessageFlags.Ephemeral });
    return;
  }
  const guarded = memberGuard(interaction, targetMember, lang);
  if (guarded) {
    await interaction.reply({ content: guarded, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const { resolved, unresolved } = resolveRoles(interaction.guild, rolesInput);
  const { assignable, blocked } = filterAssignableRoles(interaction, resolved, lang);

  if (!assignable.length) {
    await interaction.editReply({
      components: [textCard(t(lang, 'moderation.role.noneRemoved', { details: [...unresolved.map((token) => t(lang, 'moderation.common.notFound', { list: `\`${token}\`` })), ...blocked].join(', ') }), 0xfe6465)],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const removeFailed = await targetMember.roles.remove(assignable, reason ?? undefined).then(() => null, (err) => err);
  if (removeFailed) {
    logger.warn(`Failed to remove roles from ${targetMember.id} in ${interaction.guild.id}: ${removeFailed.message}`);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.changeFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = [tn(lang, 'moderation.role.removed', assignable.length, { emoji: EMOJI.APPROVE, user: `${targetUser}`, count: assignable.length, roles: assignable.join(' ') })];
  if (unresolved.length) lines.push(t(lang, 'moderation.common.notFound', { list: unresolved.map((token) => `\`${token}\``).join(', ') }));
  if (blocked.length) lines.push(t(lang, 'moderation.common.skipped', { list: blocked.join(', ') }));

  await interaction.editReply({ components: [textCard(lines.join('\n'), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function createRole(interaction) {
  const lang = await languageOf(interaction);
  const name = interaction.options.getString('name', true).slice(0, 100);
  const colorInput = interaction.options.getString('color');
  const color = colorInput ? parseHex(colorInput) : undefined;

  if (colorInput && color == null) {
    await interaction.reply({ content: t(lang, 'moderation.role.invalidColor'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: t(lang, 'moderation.role.needsManageRoles'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    const role = await interaction.guild.roles.create({ name, color, reason: t(lang, 'moderation.role.audit.created', { user: interaction.user.tag }) });
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.created', { emoji: EMOJI.APPROVE, role: `${role}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to create role:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.createFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function deleteRole(interaction) {
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  const guard = guardRole(interaction, role, lang);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    const name = role.name;
    await role.delete(t(lang, 'moderation.role.audit.deleted', { user: interaction.user.tag }));
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.deleted', { emoji: EMOJI.APPROVE, name }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to delete role:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.deleteFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function editRole(interaction) {
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  const name = interaction.options.getString('name', true).slice(0, 100);
  const guard = guardRole(interaction, role, lang);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await role.setName(name, t(lang, 'moderation.role.audit.renamed', { user: interaction.user.tag }));
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.renamed', { emoji: EMOJI.APPROVE, name }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to rename role:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.renameFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function colorRole(interaction) {
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  const colorInput = interaction.options.getString('color', true);
  const color = parseHex(colorInput);

  if (color == null) {
    await interaction.reply({ content: t(lang, 'moderation.role.invalidColor'), flags: MessageFlags.Ephemeral });
    return;
  }
  const guard = guardRole(interaction, role, lang);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await role.setColor(color, t(lang, 'moderation.role.audit.recolored', { user: interaction.user.tag }));
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.recolored', { emoji: EMOJI.APPROVE, role: `${role}`, color: color.toString(16).padStart(6, '0') }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to recolor role:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.recolorFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function iconRole(interaction) {
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  const url = interaction.options.getString('url', true);
  const guard = guardRole(interaction, role, lang);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await role.setIcon(url, t(lang, 'moderation.role.audit.icon', { user: interaction.user.tag }));
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.iconSet', { emoji: EMOJI.APPROVE, role: `${role}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to set role icon:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.iconFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function mentionableRole(interaction) {
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  const value = interaction.options.getBoolean('value', true);
  const guard = guardRole(interaction, role, lang);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await role.setMentionable(value, t(lang, 'moderation.role.audit.set', { user: interaction.user.tag }));
    await interaction.editReply({ components: [textCard(t(lang, value ? 'moderation.role.mentionableOn' : 'moderation.role.mentionableOff', { emoji: EMOJI.APPROVE, role: `${role}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to update mentionable:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.updateFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function hoistRole(interaction) {
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  const value = interaction.options.getBoolean('value', true);
  const guard = guardRole(interaction, role, lang);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await role.setHoist(value, t(lang, 'moderation.role.audit.set', { user: interaction.user.tag }));
    await interaction.editReply({ components: [textCard(t(lang, value ? 'moderation.role.hoistOn' : 'moderation.role.hoistOff', { emoji: EMOJI.APPROVE, role: `${role}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to update hoist:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.updateFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function botsRole(interaction, add) {
  if (!(await requireAdministrator(interaction))) return;
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  const guard = guardRole(interaction, role, lang);
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
          await bot.roles.add(role, t(lang, 'moderation.role.audit.botsAdd', { user: interaction.user.tag }));
          count += 1;
        }
      } else if (bot.roles.cache.has(role.id)) {
        await bot.roles.remove(role, t(lang, 'moderation.role.audit.botsRemove', { user: interaction.user.tag }));
        count += 1;
      }
    } catch (err) {
      logger.warn(`role bots${add ? '' : '-remove'}: failed on ${bot.id}:`, err.message);
    }
  }

  const done = tn(lang, add ? 'moderation.role.botsAdded' : 'moderation.role.botsRemoved', count, { emoji: EMOJI.APPROVE, role: `${role}`, count });
  await interaction.editReply({ components: [textCard(done, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function topcolorRole(interaction) {
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  const targetUser = interaction.options.getUser('member', true);
  const guard = guardRole(interaction, role, lang);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: t(lang, 'moderation.common.notMember'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const color = targetMember.roles.highest.color;
  try {
    await role.setColor(color, t(lang, 'moderation.role.audit.topcolor', { from: targetUser.tag, user: interaction.user.tag }));
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.topcolor', { emoji: EMOJI.APPROVE, role: `${role}`, user: `${targetUser}`, color: color.toString(16).padStart(6, '0') }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error('Failed to copy top color:', err);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.recolorFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function listRoles(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const roles = [...interaction.guild.roles.cache.filter((r) => r.id !== interaction.guild.id).values()].sort((a, b) => b.position - a.position);
  if (!roles.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.listEmpty'))], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const shown = roles.slice(0, 40);
  const lines = shown.map((r) => tn(lang, 'moderation.role.listLine', r.members.size, { role: `${r}`, count: r.members.size }));
  const extra = roles.length - shown.length;
  const header = `${t(lang, 'moderation.role.listHeader', { count: roles.length })}\n`;
  const text = header + lines.join('\n') + (extra > 0 ? `\n${t(lang, 'moderation.role.more', { count: extra })}` : '');

  await interaction.editReply({ components: [textCard(text.slice(0, 3900))], flags: MessageFlags.IsComponentsV2 });
}

async function inRole(interaction) {
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const members = [...role.members.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  if (!members.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.inEmpty', { role: `${role}` }))], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const shown = members.slice(0, 40);
  const lines = shown.map((m) => `${m}`);
  const extra = members.length - shown.length;
  const header = `${t(lang, 'moderation.role.inHeader', { role: `${role}`, count: members.length })}\n`;
  const text = header + lines.join('\n') + (extra > 0 ? `\n${t(lang, 'moderation.role.more', { count: extra })}` : '');

  await interaction.editReply({ components: [textCard(text.slice(0, 3900))], flags: MessageFlags.IsComponentsV2 });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Adds/removes `role` for every member in `members`, one at a time with a delay, abortable via /role cancel. */
async function runMassOp(interaction, role, members, adding, lang) {
  const guildId = interaction.guild.id;
  const task = { abort: false };
  activeMassOps.set(guildId, task);

  const working = tn(lang, adding ? 'moderation.role.mass.adding' : 'moderation.role.mass.removing', members.length, { emoji: EMOJI.WARNING, role: `${role}`, count: members.length });
  await interaction.editReply({ components: [textCard(working)], flags: MessageFlags.IsComponentsV2 });

  let done = 0;
  let index = 0;
  for (const member of members) {
    if (task.abort) break;
    index += 1;
    try {
      if (adding) await member.roles.add(role, t(lang, 'moderation.role.audit.mass', { user: interaction.user.tag }));
      else await member.roles.remove(role, t(lang, 'moderation.role.audit.mass', { user: interaction.user.tag }));
      done++;
    } catch (err) {
      logger.warn(`role mass op: failed on ${member.id}:`, err.message);
    }
    // A long run shows how far it is, and how to stop it.
    if (index % MASS_PROGRESS_EVERY === 0 && index < members.length && !task.abort) {
      const progress = `${working}\n${t(lang, 'moderation.role.mass.progress', { done: index, total: members.length })}`;
      await interaction.editReply({ components: [textCard(progress)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
    await delay(MASS_OP_DELAY_MS);
  }

  if (activeMassOps.get(guildId) === task) activeMassOps.delete(guildId);

  const suffix = task.abort ? t(lang, 'moderation.role.mass.cancelledTag') : '';
  const finished = tn(lang, adding ? 'moderation.role.mass.added' : 'moderation.role.mass.removed', done, { emoji: EMOJI.APPROVE, role: `${role}`, count: done, cancelled: suffix });
  await interaction.editReply({ components: [textCard(finished, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function hasRole(interaction) {
  if (!(await requireAdministrator(interaction))) return;
  const lang = await languageOf(interaction);
  const filterRole = interaction.options.getRole('filter_role', true);
  const targetRole = interaction.options.getRole('target_role', true);
  const removing = interaction.options.getBoolean('remove') ?? false;

  const guard = guardRole(interaction, targetRole, lang);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }
  if (activeMassOps.has(interaction.guild.id)) {
    await interaction.reply({ content: t(lang, 'moderation.role.mass.alreadyRunning'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const all = await interaction.guild.members.fetch().catch(() => interaction.guild.members.cache);
  const members = [...all.filter((m) => m.roles.cache.has(filterRole.id) && (removing ? m.roles.cache.has(targetRole.id) : !m.roles.cache.has(targetRole.id))).values()];
  if (!members.length) {
    await interaction.editReply({ components: [textCard(t(lang, removing ? 'moderation.role.has.noneRemove' : 'moderation.role.has.noneAdd', { filter: `${filterRole}`, role: `${targetRole}` }))], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await runMassOp(interaction, targetRole, members, !removing, lang);
}

async function humansRole(interaction) {
  if (!(await requireAdministrator(interaction))) return;
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  const removing = interaction.options.getBoolean('remove') ?? false;

  const guard = guardRole(interaction, role, lang);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }
  if (activeMassOps.has(interaction.guild.id)) {
    await interaction.reply({ content: t(lang, 'moderation.role.mass.alreadyRunning'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const all = await interaction.guild.members.fetch().catch(() => interaction.guild.members.cache);
  const members = [...all.filter((m) => !m.user.bot && (removing ? m.roles.cache.has(role.id) : !m.roles.cache.has(role.id))).values()];
  if (!members.length) {
    await interaction.editReply({ components: [textCard(t(lang, removing ? 'moderation.role.humans.noneRemove' : 'moderation.role.humans.noneAdd', { role: `${role}` }))], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await runMassOp(interaction, role, members, !removing, lang);
}

async function allRole(interaction) {
  if (!(await requireAdministrator(interaction))) return;
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  const removing = interaction.options.getBoolean('remove') ?? false;

  const guard = guardRole(interaction, role, lang);
  if (!guard.ok) {
    await interaction.reply({ content: guard.message, flags: MessageFlags.Ephemeral });
    return;
  }
  if (activeMassOps.has(interaction.guild.id)) {
    await interaction.reply({ content: t(lang, 'moderation.role.mass.alreadyRunning'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const all = await interaction.guild.members.fetch().catch(() => interaction.guild.members.cache);
  const members = [...all.filter((m) => (removing ? m.roles.cache.has(role.id) : !m.roles.cache.has(role.id))).values()];
  if (!members.length) {
    await interaction.editReply({ components: [textCard(t(lang, removing ? 'moderation.role.all.noneRemove' : 'moderation.role.all.noneAdd', { role: `${role}` }))], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await runMassOp(interaction, role, members, !removing, lang);
}

async function tempRole(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  const role = interaction.options.getRole('role', true);
  const durationMs = parseDuration(interaction.options.getString('duration', true));

  if (!durationMs || durationMs > MAX_TEMP_ROLE_MS) {
    await interaction.reply({ content: t(lang, 'moderation.role.temp.badDuration'), flags: MessageFlags.Ephemeral });
    return;
  }
  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: t(lang, 'moderation.common.notMember'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: t(lang, 'moderation.role.needsManageRoles'), flags: MessageFlags.Ephemeral });
    return;
  }
  const roleCheck = guardRole(interaction, role, lang);
  const blocked = memberGuard(interaction, targetMember, lang) ?? (roleCheck.ok ? null : roleCheck.message);
  if (blocked) {
    await interaction.reply({ content: blocked, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const duration = formatDuration(durationMs, lang);
  try {
    if (!targetMember.roles.cache.has(role.id)) await targetMember.roles.add(role, t(lang, 'moderation.role.audit.temp', { user: interaction.user.tag, duration }));
  } catch (err) {
    logger.warn(`role temp failed for ${targetMember.id} in ${interaction.guild.id}: ${err.message}`);
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.changeFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const expiresAt = new Date(Date.now() + durationMs);
  await tempRolesDb.addTempRole(interaction.guild.id, targetMember.id, role.id, interaction.user.id, expiresAt.toISOString());
  handleStaffAction('tempRole', interaction.client, interaction.guild, { moderator: interaction.user, user: targetUser, detail: `${role} · <t:${Math.floor(expiresAt.getTime() / 1000)}:R>` }).catch(() => {});

  const text = t(lang, 'moderation.role.temp.done', { emoji: EMOJI.APPROVE, user: `${targetUser}`, role: `${role}`, duration, time: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>` });
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

async function tempRoleList(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const rows = await tempRolesDb.listTempRoles(interaction.guild.id);
  if (!rows.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.temp.listEmpty'))], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const lines = rows.slice(0, 40).map((row) => `<@${row.user_id}> · <@&${row.role_id}> · <t:${Math.floor(new Date(row.expires_at).getTime() / 1000)}:R>`);
  if (rows.length > 40) lines.push(t(lang, 'moderation.role.more', { count: rows.length - 40 }));
  const text = [tn(lang, 'moderation.role.temp.listTitle', rows.length, { count: rows.length }), ...lines].join('\n');
  await interaction.editReply({ components: [textCard(text.slice(0, 3900))], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

async function cancelMassOp(interaction) {
  if (!(await requireAdministrator(interaction))) return;
  const lang = await languageOf(interaction);
  const task = activeMassOps.get(interaction.guild.id);
  if (!task) {
    await interaction.reply({ content: t(lang, 'moderation.role.mass.notRunning'), flags: MessageFlags.Ephemeral });
    return;
  }
  task.abort = true;
  await interaction.reply({ content: t(lang, 'moderation.role.mass.cancelling', { emoji: EMOJI.APPROVE }), flags: MessageFlags.Ephemeral });
}

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
  const lang = await languageOf(interaction);
  const name = interaction.options.getString('name', true).toLowerCase().slice(0, 60);
  const rolesInput = interaction.options.getString('roles', true);

  const { resolved, unresolved } = resolveRoles(interaction.guild, rolesInput);
  if (!resolved.length) {
    await interaction.reply({ content: t(lang, 'moderation.role.group.noRoles'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await roleGroupsDb.upsertGroup(interaction.guild.id, name, resolved.map((r) => r.id));

  const lines = [tn(lang, 'moderation.role.group.saved', resolved.length, { emoji: EMOJI.APPROVE, name, count: resolved.length, roles: resolved.join(' ') })];
  if (unresolved.length) lines.push(t(lang, 'moderation.common.notFound', { list: unresolved.map((token) => `\`${token}\``).join(', ') }));
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function groupDelete(interaction) {
  const lang = await languageOf(interaction);
  const name = interaction.options.getString('name', true).toLowerCase();
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const deleted = await roleGroupsDb.deleteGroup(interaction.guild.id, name);
  await interaction.editReply({ components: [textCard(deleted ? t(lang, 'moderation.role.group.deleted', { emoji: EMOJI.APPROVE, name }) : t(lang, 'moderation.role.group.notFound', { name }), deleted ? 0xa5ea7a : 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
}

async function groupView(interaction) {
  const lang = await languageOf(interaction);
  const name = interaction.options.getString('name', true).toLowerCase();
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const group = await roleGroupsDb.getGroup(interaction.guild.id, name);
  if (!group) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.group.notFound', { name }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const text = group.role_ids.length ? group.role_ids.map((id, i) => `${i + 1}. <@&${id}>`).join('\n') : t(lang, 'moderation.role.group.empty');
  await interaction.editReply({ components: [textCard(`${t(lang, 'moderation.role.group.title', { name: group.name })}\n${text}`)], flags: MessageFlags.IsComponentsV2 });
}

async function groupList(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const groups = await roleGroupsDb.listGroups(interaction.guild.id);
  if (!groups.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.group.none'))], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = groups.map((g) => `**${g.name}** (${g.role_ids.length}) — ${g.role_ids.length ? g.role_ids.map((id) => `<@&${id}>`).join(', ') : t(lang, 'moderation.role.group.noneTag')}`);
  await interaction.editReply({ components: [textCard(lines.join('\n').slice(0, 3900))], flags: MessageFlags.IsComponentsV2 });
}

async function groupGive(interaction) {
  const lang = await languageOf(interaction);
  const name = interaction.options.getString('name', true).toLowerCase();
  const targetUser = interaction.options.getUser('user', true);

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const group = await roleGroupsDb.getGroup(interaction.guild.id, name);
  if (!group) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.group.notFound', { name }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.common.notMember'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const roles = group.role_ids.map((id) => interaction.guild.roles.cache.get(id)).filter(Boolean);
  const { assignable, blocked } = filterAssignableRoles(interaction, roles, lang);
  if (!assignable.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.group.noneAssignable', { name, details: blocked.join(', ') }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await targetMember.roles.add(assignable, t(lang, 'moderation.role.audit.groupGive', { name, user: interaction.user.tag })).catch((err) => logger.warn('role group give failed:', err.message));
  await interaction.editReply({ components: [textCard(tn(lang, 'moderation.role.group.given', assignable.length, { emoji: EMOJI.APPROVE, count: assignable.length, name, user: `${targetUser}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function groupTake(interaction) {
  const lang = await languageOf(interaction);
  const name = interaction.options.getString('name', true).toLowerCase();
  const targetUser = interaction.options.getUser('user', true);

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const group = await roleGroupsDb.getGroup(interaction.guild.id, name);
  if (!group) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.group.notFound', { name }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.common.notMember'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const roles = group.role_ids.map((id) => interaction.guild.roles.cache.get(id)).filter(Boolean).filter((r) => targetMember.roles.cache.has(r.id));
  if (!roles.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.group.noneHeld', { user: `${targetUser}`, name }))], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await targetMember.roles.remove(roles, t(lang, 'moderation.role.audit.groupTake', { name, user: interaction.user.tag })).catch((err) => logger.warn('role group take failed:', err.message));
  await interaction.editReply({ components: [textCard(tn(lang, 'moderation.role.group.taken', roles.length, { emoji: EMOJI.APPROVE, count: roles.length, name, user: `${targetUser}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}
