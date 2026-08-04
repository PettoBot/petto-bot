const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const permissionsDb = require('../../db/permissions');
const { textCard } = require('../../utils/caseCard');
const { COLORS } = require('../../utils/colors');

module.exports = {
  aliases: ['auth', 'pgroup'],
  data: new SlashCommandBuilder()
    .setName('permission')
    .setDescription("Manage Petto's optional 0-100 command authorization levels.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('mylevel').setDescription('Show your effective Petto authorization level.'))
    .addSubcommandGroup((g) =>
      g
        .setName('group')
        .setDescription('Create and assign authorization groups.')
        .addSubcommand((s) => s.setName('create').setDescription('Create a group.').addStringOption((o) => o.setName('name').setDescription('Group name').setRequired(true)).addIntegerOption((o) => o.setName('level').setDescription('Level from 0 to 100').setMinValue(0).setMaxValue(100).setRequired(true)))
        .addSubcommand((s) => s.setName('delete').setDescription('Delete a group.').addStringOption((o) => o.setName('name').setDescription('Group name').setRequired(true)))
        .addSubcommand((s) => s.setName('level').setDescription('Change a group level.').addStringOption((o) => o.setName('name').setDescription('Group name').setRequired(true)).addIntegerOption((o) => o.setName('level').setDescription('Level from 0 to 100').setMinValue(0).setMaxValue(100).setRequired(true)))
        .addSubcommand((s) => s.setName('add-role').setDescription('Add a role to a group.').addStringOption((o) => o.setName('name').setDescription('Group name').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand((s) => s.setName('remove-role').setDescription('Remove a role from a group.').addStringOption((o) => o.setName('name').setDescription('Group name').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand((s) => s.setName('add-user').setDescription('Add a user to a group.').addStringOption((o) => o.setName('name').setDescription('Group name').setRequired(true)).addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)))
        .addSubcommand((s) => s.setName('remove-user').setDescription('Remove a user from a group.').addStringOption((o) => o.setName('name').setDescription('Group name').setRequired(true)).addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('List groups and their levels.'))
        .addSubcommand((s) => s.setName('view').setDescription('View a group.').addStringOption((o) => o.setName('name').setDescription('Group name').setRequired(true))),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('command')
        .setDescription('Set the minimum authorization level for a command.')
        .addSubcommand((s) => s.setName('set').setDescription('Require a level for a command.').addStringOption((o) => o.setName('name').setDescription('Built-in command name, without prefix').setRequired(true)).addIntegerOption((o) => o.setName('level').setDescription('Level from 0 to 100; 0 means public').setMinValue(0).setMaxValue(100).setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('List commands with a custom required level.')),
    ),

  async execute(interaction) {
    await ensureGuild(interaction.guild.id);
    await permissionsDb.getOrCreateBaseGroup(interaction.guild.id);
    const group = interaction.options.getSubcommandGroup(false);
    if (!group) return myLevel(interaction);
    const sub = interaction.options.getSubcommand();
    if (group === 'group') return groupCommand(interaction, sub);
    return commandCommand(interaction, sub);
  },
};

async function respond(interaction, message, color = COLORS.DEFAULT) {
  return interaction.reply({ components: [textCard(message, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [], users: [], roles: [], repliedUser: false } });
}

function audit(interaction, action, summary) {
  return permissionsDb.recordAudit(interaction.guild.id, interaction.user, action, summary).catch(() => {});
}

async function findGroup(guildId, name) {
  const wanted = String(name).trim().toLowerCase();
  const groups = await permissionsDb.listGroups(guildId);
  return groups.find((g) => g.name.toLowerCase() === wanted) ?? null;
}

async function myLevel(interaction) {
  const level = await permissionsDb.getEffectiveLevel(interaction.guild.id, interaction.member);
  return respond(interaction, `Your effective Petto authorization level is **${level}/100**.`);
}

async function groupCommand(interaction, sub) {
  const guildId = interaction.guild.id;
  if (sub === 'list') {
    const groups = await permissionsDb.listGroups(guildId);
    const lines = groups.map((g) => `**${g.is_base ? '@everyone' : g.name}** — level **${g.level}** · ${g.members.length} member(s)`);
    return respond(interaction, lines.length ? lines.join('\n') : 'No authorization groups configured yet.');
  }

  const name = interaction.options.getString('name', true);
  if (sub === 'create') {
    const level = interaction.options.getInteger('level', true);
    try {
      const group = await permissionsDb.createGroup(guildId, name, level);
      await audit(interaction, 'create_group', `Created group "${group.name}" at level ${group.level}`);
      return respond(interaction, `Authorization group **${group.name}** created at level **${group.level}**.`, COLORS.GREEN);
    } catch (err) {
      if (err?.code === '23505') return respond(interaction, `A group named **${name}** already exists.`, COLORS.RED);
      throw err;
    }
  }

  const group = await findGroup(guildId, name);
  if (!group) return respond(interaction, `Authorization group **${name}** was not found.`, COLORS.RED);
  if (sub === 'delete') {
    const removed = await permissionsDb.deleteGroup(guildId, group.id);
    if (removed) await audit(interaction, 'delete_group', `Deleted group "${group.name}"`);
    return respond(interaction, removed ? `Group **${group.name}** deleted.` : 'The @everyone group cannot be deleted.', removed ? COLORS.GREEN : COLORS.RED);
  }
  if (sub === 'level') {
    const level = interaction.options.getInteger('level', true);
    await permissionsDb.updateGroupLevel(guildId, group.id, level);
    await audit(interaction, 'update_group_level', `Set "${group.name}" to level ${level}`);
    return respond(interaction, `Group **${group.name}** now has level **${level}**.`, COLORS.GREEN);
  }
  if (sub === 'view') {
    const members = group.members.length ? group.members.map((m) => `${m.subject_type === 'role' ? '<@&' : '<@'}${m.subject_id}>`).join(' ') : 'No users or roles assigned.';
    return respond(interaction, `**${group.is_base ? '@everyone' : group.name}** · level **${group.level}**\n${members}`);
  }

  const isRole = sub.endsWith('role');
  const subject = isRole ? interaction.options.getRole('role', true) : interaction.options.getUser('user', true);
  const subjectType = isRole ? 'role' : 'user';
  const adding = sub.startsWith('add-');
  if (adding) await permissionsDb.addGroupMember(group.id, subjectType, subject.id);
  else await permissionsDb.removeGroupMember(group.id, subjectType, subject.id);
  await audit(interaction, adding ? 'add_member' : 'remove_member', `${adding ? 'Added' : 'Removed'} ${subjectType} ${subject.id} ${adding ? 'to' : 'from'} "${group.name}"`);
  return respond(interaction, `${adding ? 'Added' : 'Removed'} ${subject} ${adding ? 'to' : 'from'} group **${group.name}**.`, COLORS.GREEN);
}

async function commandCommand(interaction, sub) {
  if (sub === 'list') {
    const rows = await permissionsDb.listCommandLevels(interaction.guild.id);
    const custom = rows.filter((row) => row.required_level > 0).sort((a, b) => a.command_name.localeCompare(b.command_name));
    return respond(interaction, custom.length ? custom.map((row) => `\`${row.command_name}\` → level **${row.required_level}**`).join('\n') : 'All commands are public to members who pass Discord permissions.');
  }

  const rawName = interaction.options.getString('name', true).toLowerCase();
  const canonical = interaction.client.commandAliases.get(rawName) ?? rawName;
  if (!interaction.client.commands.has(canonical)) return respond(interaction, `Unknown built-in command **${rawName}**. Use your prefix + help to find commands.`, COLORS.RED);
  const level = interaction.options.getInteger('level', true);
  await permissionsDb.setCommandLevel(interaction.guild.id, canonical, level);
  await audit(interaction, 'set_command_level', `Set ${canonical} to required level ${level}`);
  return respond(interaction, `Command **${canonical}** now requires authorization level **${level}**.`, COLORS.GREEN);
}
