const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requireAdministrator } = require('../../utils/moderationCommand');
const { filterAssignableRoles } = require('../../utils/roleResolve');
const { startMassJob } = require('../../utils/bulkRoleCommand');
const { isGone } = require('../../utils/deadRoles');
const { ensureGuild } = require('../../db/guilds');
const db = require('../../db/joinRoles');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, tn, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['jr'],
  // `!joinrole apply @Role preview`: the name of an option alone turns it on.
  prefixBareFlags: true,
  data: new SlashCommandBuilder()
    .setName('joinrole')
    .setDescription('Roles automatically given to new members on join.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Give a role automatically on join.')
        .addRoleOption((o) => o.setName('role').setDescription('Role to give').setRequired(true))
        .addStringOption((o) => o.setName('target').setDescription('Who gets it (default: everyone)').setRequired(false).addChoices({ name: 'everyone', value: 'all' }, { name: 'humans only', value: 'humans' }, { name: 'bots only', value: 'bots' }))
        .addBooleanOption((o) => o.setName('after_rules').setDescription('Give it only after they accept the rules (Membership Screening)').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('Stop auto-giving a role on join.').addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List all configured join roles.'))
    .addSubcommand((s) => s.setName('clear').setDescription('Remove every configured join role.'))
    .addSubcommand((s) =>
      s
        .setName('apply')
        .setDescription('Give a join role now to the members who are already in the server.')
        .addRoleOption((o) => o.setName('role').setDescription('A configured join role').setRequired(true))
        .addBooleanOption((o) => o.setName('preview').setDescription('Only count who would get it, nothing is changed').setRequired(false))
        .addStringOption((o) => o.setName('reason').setDescription('Reason (shown in the audit log)').setRequired(false)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addCmd(interaction);
    if (sub === 'remove') return removeCmd(interaction);
    if (sub === 'list') return listCmd(interaction);
    if (sub === 'apply') return applyCmd(interaction);
    return clearCmd(interaction);
  },
};

function targetLabel(target, lang) {
  return t(lang, target === 'humans' ? 'welcome.joinRole.target.humans' : target === 'bots' ? 'welcome.joinRole.target.bots' : 'welcome.joinRole.target.all');
}

async function addCmd(interaction) {
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  const target = interaction.options.getString('target') ?? 'all';
  const afterRules = interaction.options.getBoolean('after_rules') ?? false;

  if (role.managed || role.id === interaction.guild.id) {
    await interaction.reply({ content: t(lang, 'welcome.joinRole.managed'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (role.position >= interaction.guild.members.me.roles.highest.position) {
    await interaction.reply({ content: t(lang, 'welcome.joinRole.aboveMe'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await db.addRole(interaction.guild.id, role.id, target, afterRules);

  await interaction.editReply({ components: [textCard(t(lang, 'welcome.joinRole.added', { emoji: EMOJI.APPROVE, role: `${role}`, target: targetLabel(target, lang) }) + (afterRules ? `\n${t(lang, 'welcome.joinRole.waitsRules')}` : ''), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function removeCmd(interaction) {
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const removed = await db.removeRole(interaction.guild.id, role.id);
  await interaction.editReply({ components: [textCard(removed ? t(lang, 'welcome.joinRole.removed', { emoji: EMOJI.APPROVE, role: `${role}` }) : t(lang, 'welcome.joinRole.notConfigured', { role: `${role}` }), removed ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function listCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const roles = await db.listRoles(interaction.guild.id);
  if (!roles.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'welcome.joinRole.empty'))], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const guild = interaction.guild;
  const me = guild.members.me;
  // What would keep a role from being given: it was deleted, it is managed by an integration, or it is above Petto's highest role.
  const problem = (row) => {
    if (isGone(guild, row.role_id)) return 'gone';
    const role = guild.roles.cache.get(row.role_id);
    if (role?.managed) return 'managed';
    if (role && me && role.position >= me.roles.highest.position) return 'above';
    return null;
  };
  const lines = roles.map((r) => {
    const found = problem(r);
    const wait = r.after_rules ? ` · ${t(lang, 'welcome.joinRole.list.afterRules')}` : '';
    return `<@&${r.role_id}> · ${targetLabel(r.target, lang)}${wait}${found ? `\n${t(lang, `welcome.joinRole.list.problem.${found}`, { emoji: EMOJI.WARNING })}` : ''}`;
  });
  const notes = [];
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) notes.push(t(lang, 'welcome.joinRole.list.noPermission', { emoji: EMOJI.WARNING }));
  const body = [`${t(lang, 'welcome.joinRole.listTitle', { count: roles.length })}`, ...lines, ...notes].join('\n');
  await interaction.editReply({ components: [textCard(body.slice(0, 3900))], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

/** `apply`: the join role now for the members who are already here, with the target it was set for (a job of the engine of the dashboard: preview, pause, cancel). */
async function applyCmd(interaction) {
  if (!(await requireAdministrator(interaction))) return;
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  const rows = await db.listRoles(interaction.guild.id);
  const row = rows.find((each) => each.role_id === role.id);
  if (!row) {
    await interaction.reply({ content: t(lang, 'welcome.joinRole.notConfigured', { role: `${role}` }), flags: MessageFlags.Ephemeral });
    return;
  }
  const { assignable, blocked } = filterAssignableRoles(interaction, [role], lang);
  if (!assignable.length) {
    await interaction.reply({ content: blocked[0], flags: MessageFlags.Ephemeral });
    return;
  }
  await startMassJob(interaction, {
    role,
    action: 'add',
    memberType: row.target,
    // A role that waits for the rules is not given to the members who have not accepted them yet.
    skipPending: Boolean(row.after_rules),
    preview: interaction.options.getBoolean('preview') ?? false,
    reason: interaction.options.getString('reason') ?? t(lang, 'welcome.joinRole.applyReason'),
  });
}

async function clearCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await db.clearRoles(interaction.guild.id);
  await interaction.editReply({ components: [textCard(removed ? tn(lang, 'welcome.joinRole.cleared', removed, { count: removed, emoji: EMOJI.APPROVE }) : t(lang, 'welcome.joinRole.nothingToClear'), removed ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}
