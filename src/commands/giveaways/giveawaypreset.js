const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { parseDuration: parseLength } = require('../../utils/duration');
const { ensureGuild } = require('../../db/guilds');
const presetsDb = require('../../db/giveawayPresets');
const { guildLimit } = require('../../db/premium');
const { formatDuration } = require('../../utils/duration');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, tn, languageOf } = require('../../i18n');

module.exports = {
  // Also registered as a slash command (it already has subcommands, so it needs no umbrella); the prefix keeps working.
  registerSlash: true,
  data: new SlashCommandBuilder()
    .setName('giveawaypreset')
    .setDescription('Manage giveaway role presets — bonus entries and claim time per role.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('create').setDescription('Save the usual settings of a giveaway as a preset to reuse.').addStringOption((o) => o.setName('name').setDescription('Preset name').setRequired(true)))
    .addSubcommand((s) => s.setName('view').setDescription('Show the settings saved in a preset.').addStringOption((o) => o.setName('name').setDescription('Preset name').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Delete a giveaway preset.').addStringOption((o) => o.setName('name').setDescription('Preset name').setRequired(true)))
    .addSubcommand((s) =>
      s
        .setName('add-role')
        .setDescription('Add or update a role in a preset.')
        .addStringOption((o) => o.setName('name').setDescription('Preset name').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
        .addStringOption((o) => o.setName('claim_time').setDescription('e.g. 5m, 1h (default: none)').setRequired(false))
        .addIntegerOption((o) => o.setName('entries').setDescription('Extra entries this role grants (default 0)').setRequired(false))
        .addBooleanOption((o) => o.setName('claim_time_stack').setDescription('Stack claim time with other matched roles? (default false)').setRequired(false))
        .addBooleanOption((o) => o.setName('entries_stack').setDescription('Stack entries with other matched roles? (default false)').setRequired(false)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove-role')
        .setDescription('Remove a role from a preset.')
        .addStringOption((o) => o.setName('name').setDescription('Preset name').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('add-level')
        .setDescription('Extra entries from a level: a member at that level or above gets them.')
        .addStringOption((o) => o.setName('name').setDescription('Preset name').setRequired(true))
        .addIntegerOption((o) => o.setName('level').setDescription('From this level').setRequired(true).setMinValue(1).setMaxValue(10000))
        .addIntegerOption((o) => o.setName('entries').setDescription('Extra entries (0 removes the bonus of that level)').setRequired(true).setMinValue(0).setMaxValue(1000))
        .addStringOption((o) => o.setName('type').setDescription('Message levels (default) or voice levels').setRequired(false).addChoices({ name: 'messages', value: 'text' }, { name: 'voice', value: 'voice' })),
    )
    .addSubcommand((s) =>
      s
        .setName('require-level')
        .setDescription('The level a member needs to enter (0 asks for nothing).')
        .addStringOption((o) => o.setName('name').setDescription('Preset name').setRequired(true))
        .addIntegerOption((o) => o.setName('level').setDescription('Message level needed').setRequired(false).setMinValue(0).setMaxValue(10000))
        .addIntegerOption((o) => o.setName('voice_level').setDescription('Voice level needed').setRequired(false).setMinValue(0).setMaxValue(10000)),
    ),
  aliases: ['gwp'],

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') return createCmd(interaction, lang);
    if (sub === 'view') return viewCmd(interaction, lang);
    if (sub === 'remove') return removeCmd(interaction, lang);
    if (sub === 'add-role') return addRoleCmd(interaction, lang);
    if (sub === 'add-level') return addLevelCmd(interaction, lang);
    if (sub === 'require-level') return requireLevelCmd(interaction, lang);
    return removeRoleCmd(interaction, lang);
  },
};

async function createCmd(interaction, lang) {
  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const existing = await presetsDb.getPreset(interaction.guild.id, name);
  if (existing) {
    await interaction.editReply({ components: [textCard(t(lang, 'giveaways.preset.exists'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  // The same plan limit as the dashboard (db/premium.js giveawayPresets).
  const allowed = await guildLimit(interaction.guild.id, 'giveawayPresets');
  if ((await presetsDb.listPresets(interaction.guild.id)).length >= allowed.limit) {
    await interaction.editReply({ components: [textCard(t(lang, allowed.premium ? 'giveaways.preset.limit' : 'giveaways.preset.limitFree', { limit: allowed.limit, premium: allowed.premiumLimit }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const preset = await presetsDb.createPreset(interaction.guild.id, name);
  await interaction.editReply({ components: [textCard(t(lang, 'giveaways.preset.created', { emoji: EMOJI.APPROVE, name: preset.name }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function viewCmd(interaction, lang) {
  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const preset = await presetsDb.getPreset(interaction.guild.id, name);
  if (!preset) {
    await interaction.editReply({ components: [textCard(t(lang, 'giveaways.preset.notFound'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const [roles, levels] = await Promise.all([presetsDb.listRoles(preset.id), presetsDb.listLevels(preset.id)]);
  const lines = roles.map((r) => {
    const entries = tn(lang, r.entries_stack ? 'giveaways.preset.view.entriesStack' : 'giveaways.preset.view.entries', r.entries, { count: r.entries });
    const duration = r.claim_time_ms ? formatDuration(r.claim_time_ms, lang) : null;
    const claim = duration
      ? t(lang, r.claim_time_stack ? 'giveaways.preset.view.claimStack' : 'giveaways.preset.view.claim', { duration })
      : t(lang, r.claim_time_stack ? 'giveaways.preset.view.noClaimStack' : 'giveaways.preset.view.noClaim');
    return t(lang, 'giveaways.preset.view.roleLine', { role: `<@&${r.role_id}>`, entries, claim });
  });
  for (const step of levels) {
    const vars = { count: step.entries, level: step.level };
    lines.push(step.source === 'voice' ? tn(lang, 'giveaways.preset.view.voiceLevel', step.entries, vars) : tn(lang, 'giveaways.preset.view.level', step.entries, vars));
  }
  if (preset.min_level) lines.push(t(lang, 'giveaways.preset.view.minLevel', { level: preset.min_level }));
  if (preset.min_voice_level) lines.push(t(lang, 'giveaways.preset.view.minVoiceLevel', { level: preset.min_voice_level }));
  if (!lines.length) lines.push(t(lang, 'giveaways.preset.view.empty'));

  await interaction.editReply({ components: [textCard([t(lang, 'giveaways.preset.view.title', { name: preset.name }), ...lines].join('\n'))], flags: MessageFlags.IsComponentsV2 });
}

async function removeCmd(interaction, lang) {
  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const removed = await presetsDb.removePreset(interaction.guild.id, name);
  await interaction.editReply({ components: [textCard(removed ? t(lang, 'giveaways.preset.removed', { emoji: EMOJI.APPROVE }) : t(lang, 'giveaways.preset.notFound'), removed ? 0xa5ea7a : 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
}

async function addRoleCmd(interaction, lang) {
  const name = interaction.options.getString('name', true);
  const role = interaction.options.getRole('role', true);
  const claimTimeStr = interaction.options.getString('claim_time');
  const entries = interaction.options.getInteger('entries') ?? 0;
  const claimTimeStack = interaction.options.getBoolean('claim_time_stack') ?? false;
  const entriesStack = interaction.options.getBoolean('entries_stack') ?? false;

  let claimTimeMs = 0;
  if (claimTimeStr) {
    claimTimeMs = parseLength(claimTimeStr);
    if (typeof claimTimeMs !== 'number' || Number.isNaN(claimTimeMs) || claimTimeMs <= 0) {
      await interaction.reply({ content: t(lang, 'giveaways.invalidClaimTime'), flags: MessageFlags.Ephemeral });
      return;
    }
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const preset = await presetsDb.getPreset(interaction.guild.id, name);
  if (!preset) {
    await interaction.editReply({ components: [textCard(t(lang, 'giveaways.preset.notFound'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await presetsDb.upsertRole(preset.id, role.id, { claimTimeMs, entries, claimTimeStack, entriesStack });
  await interaction.editReply({
    components: [textCard(claimTimeMs
      ? tn(lang, 'giveaways.preset.roleSetClaim', entries, { count: entries, emoji: EMOJI.APPROVE, role: `${role}`, duration: formatDuration(claimTimeMs, lang), name: preset.name })
      : tn(lang, 'giveaways.preset.roleSet', entries, { count: entries, emoji: EMOJI.APPROVE, role: `${role}`, name: preset.name }), 0xa5ea7a)],
    flags: MessageFlags.IsComponentsV2,
  });
}

async function removeRoleCmd(interaction, lang) {
  const name = interaction.options.getString('name', true);
  const role = interaction.options.getRole('role', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const preset = await presetsDb.getPreset(interaction.guild.id, name);
  if (!preset) {
    await interaction.editReply({ components: [textCard(t(lang, 'giveaways.preset.notFound'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const removed = await presetsDb.removeRole(preset.id, role.id);
  await interaction.editReply({ components: [textCard(removed ? t(lang, 'giveaways.preset.roleRemoved', { emoji: EMOJI.APPROVE, role: `${role}`, name: preset.name }) : t(lang, 'giveaways.preset.roleNotIn'), removed ? 0xa5ea7a : 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
}

async function addLevelCmd(interaction, lang) {
  const name = interaction.options.getString('name', true);
  const level = interaction.options.getInteger('level', true);
  const entries = interaction.options.getInteger('entries', true);
  const type = interaction.options.getString('type') === 'voice' ? 'voice' : 'text';
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const preset = await presetsDb.getPreset(interaction.guild.id, name);
  if (!preset) {
    await interaction.editReply({ components: [textCard(t(lang, 'giveaways.preset.notFound'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const voice = type === 'voice';
  if (entries === 0) {
    const removed = await presetsDb.removeLevel(preset.id, type, level);
    const text = removed
      ? t(lang, voice ? 'giveaways.preset.voiceLevelRemoved' : 'giveaways.preset.levelRemoved', { emoji: EMOJI.APPROVE, level, name: preset.name })
      : t(lang, voice ? 'giveaways.preset.voiceLevelNone' : 'giveaways.preset.levelNone', { level, name: preset.name });
    await interaction.editReply({ components: [textCard(text, removed ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const existing = await presetsDb.listLevels(preset.id);
  if (existing.length >= 25 && !existing.some((step) => step.source === type && step.level === level)) {
    await interaction.editReply({ components: [textCard(t(lang, 'giveaways.preset.levelLimit'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  await presetsDb.upsertLevel(preset.id, type, level, entries);
  const vars = { count: entries, emoji: EMOJI.APPROVE, level, name: preset.name };
  const text = voice ? tn(lang, 'giveaways.preset.voiceLevelSet', entries, vars) : tn(lang, 'giveaways.preset.levelSet', entries, vars);
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function requireLevelCmd(interaction, lang) {
  const name = interaction.options.getString('name', true);
  const level = interaction.options.getInteger('level');
  const voiceLevel = interaction.options.getInteger('voice_level');
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const preset = await presetsDb.getPreset(interaction.guild.id, name);
  if (!preset) {
    await interaction.editReply({ components: [textCard(t(lang, 'giveaways.preset.notFound'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const updated = await presetsDb.setRequirements(preset.id, { minLevel: level, minVoiceLevel: voiceLevel });
  const vars = { emoji: EMOJI.APPROVE, name: updated.name, level: updated.min_level, voiceLevel: updated.min_voice_level };
  const key = updated.min_level && updated.min_voice_level ? 'giveaways.preset.require.both'
    : updated.min_level ? 'giveaways.preset.require.message'
      : updated.min_voice_level ? 'giveaways.preset.require.voice'
        : 'giveaways.preset.require.none';
  await interaction.editReply({ components: [textCard(t(lang, key, vars), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}
