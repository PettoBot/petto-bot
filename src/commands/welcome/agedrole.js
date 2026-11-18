const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { rulesOf, addRule, removeRule, MAX_RULES } = require('../../utils/agedRoles');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['agedr'],
  data: new SlashCommandBuilder()
    .setName('agedrole')
    .setDescription('Roles given to members after some days in the server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Give a role to members after they have been in the server for some days.')
        .addRoleOption((o) => o.setName('role').setDescription('Role to give').setRequired(true))
        .addIntegerOption((o) => o.setName('days').setDescription('Days in the server (1 to 3650)').setMinValue(1).setMaxValue(3650).setRequired(true))
        .addRoleOption((o) => o.setName('remove_role').setDescription('A role to take away at the same time (for example the New member role)').setRequired(false))
        .addStringOption((o) => o.setName('target').setDescription('Who gets it (default: humans only)').setRequired(false).addChoices({ name: 'humans only', value: 'humans' }, { name: 'everyone', value: 'all' }, { name: 'bots only', value: 'bots' })),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Stop giving a role by days in the server.')
        .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true))
        .addIntegerOption((o) => o.setName('days').setDescription('Only the rule with these days (default: every rule of the role)').setMinValue(1).setMaxValue(3650).setRequired(false)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List the roles given by days in the server.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addCmd(interaction);
    if (sub === 'remove') return removeCmd(interaction);
    return listCmd(interaction);
  },
};

async function addCmd(interaction) {
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  const days = interaction.options.getInteger('days', true);
  const removeRole = interaction.options.getRole('remove_role');
  const target = interaction.options.getString('target') ?? 'humans';
  const me = interaction.guild.members.me;
  for (const each of [role, removeRole].filter(Boolean)) {
    if (each.managed || each.id === interaction.guild.id) { await interaction.reply({ content: t(lang, 'agedroles.managed', { role: `${each}` }), flags: MessageFlags.Ephemeral }); return; }
    if (me && each.position >= me.roles.highest.position) { await interaction.reply({ content: t(lang, 'agedroles.aboveMe', { role: `${each}` }), flags: MessageFlags.Ephemeral }); return; }
  }
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  const result = await addRule(interaction.guild.id, { roleId: role.id, days, removeRoleId: removeRole?.id ?? null, target });
  if (!result.ok) {
    await interaction.editReply({ components: [textCard(t(lang, `agedroles.problem.${result.reason}`, { max: MAX_RULES }), 0)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const text = t(lang, removeRole ? 'agedroles.addedRemove' : 'agedroles.added', { emoji: EMOJI.APPROVE, role: `${role}`, days, removeRole: `${removeRole ?? ''}`, target: t(lang, `agedroles.target.${target}`) });
  await interaction.editReply({ components: [textCard(text)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

async function removeCmd(interaction) {
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  const days = interaction.options.getInteger('days');
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await removeRule(interaction.guild.id, role.id, days);
  await interaction.editReply({ components: [textCard(removed ? t(lang, 'agedroles.removed', { emoji: EMOJI.APPROVE, role: `${role}`, count: removed }) : t(lang, 'agedroles.notFound', { role: `${role}` }))], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

async function listCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const rules = await rulesOf(interaction.guild.id);
  if (!rules.length) { await interaction.editReply({ components: [textCard(t(lang, 'agedroles.empty'))], flags: MessageFlags.IsComponentsV2 }); return; }
  const lines = rules.map((r) => t(lang, r.removeRoleId ? 'agedroles.lineRemove' : 'agedroles.line', { role: `<@&${r.roleId}>`, days: r.days, removeRole: r.removeRoleId ? `<@&${r.removeRoleId}>` : '', target: t(lang, `agedroles.target.${r.target}`), off: r.enabled ? '' : ` · ${t(lang, 'agedroles.off')}` }));
  await interaction.editReply({ components: [textCard([t(lang, 'agedroles.listTitle', { count: rules.length, max: MAX_RULES }), ...lines].join('\n').slice(0, 3900))], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}
