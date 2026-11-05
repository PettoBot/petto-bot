const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const roleTriggersDb = require('../../db/roleTriggers');
const { ensureGuild } = require('../../db/guilds');
const { ACTIONS, TRIGGERS, validateRule } = require('../../utils/roleTriggers');
const { formatDuration } = require('../../utils/duration');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');
const roleTriggerWarm = require('../../utils/roleTriggerWarm');

// Administrator only: a rule bans, kicks and jails by itself, so changing them is for who runs the server.
module.exports = {
  aliases: ['rtrig'],
  prefixOnly: true,
  data: new SlashCommandBuilder()
    .setName('roletrigger')
    .setDescription('Do something automatically to a member who is given a role or finishes onboarding with it.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('add')
      .setDescription('Set the action for a role (replaces the rule of that role).')
      .addRoleOption((o) => o.setName('role').setDescription('The role that fires the action').setRequired(true))
      .addStringOption((o) => o.setName('action').setDescription('What to do').setRequired(true)
        .addChoices(...ACTIONS.map((value) => ({ name: value === 'remove_role' ? 'remove role' : value, value }))))
      .addStringOption((o) => o.setName('duration').setDescription('For mute, jail or ban: how long, e.g. 1h, 1d (a ban becomes a temporary ban)').setRequired(false))
      .addStringOption((o) => o.setName('reason').setDescription('Added to the reason of the case').setRequired(false).setMaxLength(200))
      .addStringOption((o) => o.setName('on').setDescription('When: role_added (default), onboarding or either').setRequired(false)
        .addChoices(...TRIGGERS.map((value) => ({ name: value, value })))))
    .addSubcommand((sub) => sub
      .setName('remove')
      .setDescription('Remove the rule of a role.')
      .addRoleOption((o) => o.setName('role').setDescription('The role of the rule').setRequired(true)))
    .addSubcommand((sub) => sub.setName('list').setDescription('List the role triggers of this server.')),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    // Also when it comes from the prefix or an umbrella: the permission of the wrapped command is the one that counts.
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: t(lang, 'automation.roletrigger.needsAdmin'), flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const guild = interaction.guild;
    const show = (text, color) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });

    if (sub === 'list') {
      const rules = await roleTriggersDb.listRules(guild.id);
      if (!rules.length) return show(t(lang, 'automation.roletrigger.none'));
      return show([...rules.map((rule) => ruleLine(rule, lang)), ...coverageNote(guild, lang)].join('\n'));
    }

    if (sub === 'remove') {
      const role = interaction.options.getRole('role', true);
      const removed = await roleTriggersDb.removeRule(guild.id, role.id);
      return show(t(lang, removed ? 'automation.roletrigger.removed' : 'automation.roletrigger.notFound', { emoji: EMOJI.APPROVE, role: `<@&${role.id}>` }), removed ? 0xa5ea7a : 0x4b4f59);
    }

    const role = interaction.options.getRole('role', true);
    const rules = await roleTriggersDb.listRules(guild.id);
    const checked = validateRule({
      role,
      guildId: guild.id,
      action: interaction.options.getString('action', true),
      duration: interaction.options.getString('duration'),
      reason: interaction.options.getString('reason'),
      on: interaction.options.getString('on') ?? 'role_added',
      existingRoleIds: rules.map((rule) => rule.role_id),
    });
    if (!checked.ok) return show(t(lang, `automation.roletrigger.error.${checked.error}`, { max: 25 }), 0xfe6465);
    await ensureGuild(guild.id);
    const saved = await roleTriggersDb.upsertRule(guild.id, checked.rule);
    // The members of the server are loaded in the background (so the rule sees the role given to them); if that cannot be done, the admin is told.
    roleTriggerWarm.scheduleGuild(guild);
    return show([t(lang, 'automation.roletrigger.added', { emoji: EMOJI.APPROVE, line: ruleLine(saved, lang) }), ...coverageNote(guild, lang, { loading: true })].join('\n'), 0xa5ea7a);
  },
};

/** The line that says that members Petto does not have in memory yet may be missed (nothing when the server is covered). */
function coverageNote(guild, lang, opts) {
  return roleTriggerWarm.coverageWarning(guild, opts) ? ['', t(lang, 'automation.roletrigger.coverage', { max: roleTriggerWarm.MAX_GUILD_MEMBERS.toLocaleString('en-US') })] : [];
}

/** One rule as it is listed: `<@&role> (when it is given) → ban (1d)`. */
function ruleLine(rule, lang) {
  const duration = Number(rule.duration_ms) ? ` (${formatDuration(Number(rule.duration_ms), lang)})` : '';
  const reason = rule.reason ? ` · ${rule.reason}` : '';
  return t(lang, 'automation.roletrigger.rule', {
    role: `<@&${rule.role_id}>`,
    on: t(lang, `automation.roletrigger.on.${rule.on_event}`),
    action: t(lang, `automation.roletrigger.action.${rule.action}`),
    duration,
    reason,
  });
}
