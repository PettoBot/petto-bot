const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { parseDuration: parseLength } = require('../../utils/duration');
const { ensureGuild } = require('../../db/guilds');
const presetsDb = require('../../db/giveawayPresets');
const { formatDuration } = require('../../utils/duration');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

module.exports = {
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
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') return createCmd(interaction);
    if (sub === 'view') return viewCmd(interaction);
    if (sub === 'remove') return removeCmd(interaction);
    if (sub === 'add-role') return addRoleCmd(interaction);
    if (sub === 'add-level') return addLevelCmd(interaction);
    if (sub === 'require-level') return requireLevelCmd(interaction);
    return removeRoleCmd(interaction);
  },
};

async function createCmd(interaction) {
  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const existing = await presetsDb.getPreset(interaction.guild.id, name);
  if (existing) {
    await interaction.editReply({ components: [textCard('A preset with that name already exists.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const preset = await presetsDb.createPreset(interaction.guild.id, name);
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Preset **${preset.name}** created. Add roles with \`giveawaypreset add-role\`.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function viewCmd(interaction) {
  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const preset = await presetsDb.getPreset(interaction.guild.id, name);
  if (!preset) {
    await interaction.editReply({ components: [textCard("That preset doesn't exist.", 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const [roles, levels] = await Promise.all([presetsDb.listRoles(preset.id), presetsDb.listLevels(preset.id)]);
  const lines = roles.map(
    (r) =>
      `<@&${r.role_id}> — **${r.entries}** entries${r.entries_stack ? ' (stacks)' : ''}, ${r.claim_time_ms ? formatDuration(r.claim_time_ms) : 'no'} claim time${r.claim_time_stack ? ' (stacks)' : ''}`,
  );
  for (const step of levels) lines.push(`${step.source === 'voice' ? 'Voice level' : 'Level'} **${step.level}+** — **${step.entries}** extra entries`);
  if (preset.min_level) lines.push(`Needs message level **${preset.min_level}** to enter`);
  if (preset.min_voice_level) lines.push(`Needs voice level **${preset.min_voice_level}** to enter`);
  if (!lines.length) lines.push('Nothing configured yet.');

  await interaction.editReply({ components: [textCard(`**Preset: ${preset.name}**\n${lines.join('\n')}`, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function removeCmd(interaction) {
  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const removed = await presetsDb.removePreset(interaction.guild.id, name);
  await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  Preset removed.` : "That preset doesn't exist.", removed ? 0xa5ea7a : 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
}

async function addRoleCmd(interaction) {
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
      await interaction.reply({ content: 'Provide a valid claim time, e.g. `5m`, `1h`.', flags: MessageFlags.Ephemeral });
      return;
    }
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const preset = await presetsDb.getPreset(interaction.guild.id, name);
  if (!preset) {
    await interaction.editReply({ components: [textCard("That preset doesn't exist.", 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await presetsDb.upsertRole(preset.id, role.id, { claimTimeMs, entries, claimTimeStack, entriesStack });
  await interaction.editReply({
    components: [textCard(`${EMOJI.APPROVE}  ${role} now grants **${entries}** entries${claimTimeMs ? ` and ${formatDuration(claimTimeMs)} claim time` : ''} in **${preset.name}**.`, 0xa5ea7a)],
    flags: MessageFlags.IsComponentsV2,
  });
}

async function removeRoleCmd(interaction) {
  const name = interaction.options.getString('name', true);
  const role = interaction.options.getRole('role', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const preset = await presetsDb.getPreset(interaction.guild.id, name);
  if (!preset) {
    await interaction.editReply({ components: [textCard("That preset doesn't exist.", 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const removed = await presetsDb.removeRole(preset.id, role.id);
  await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  Removed ${role} from **${preset.name}**.` : 'That role was not in the preset.', removed ? 0xa5ea7a : 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
}

async function addLevelCmd(interaction) {
  const name = interaction.options.getString('name', true);
  const level = interaction.options.getInteger('level', true);
  const entries = interaction.options.getInteger('entries', true);
  const type = interaction.options.getString('type') === 'voice' ? 'voice' : 'text';
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const preset = await presetsDb.getPreset(interaction.guild.id, name);
  if (!preset) {
    await interaction.editReply({ components: [textCard("That preset doesn't exist.", 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const label = type === 'voice' ? 'voice level' : 'level';
  if (entries === 0) {
    const removed = await presetsDb.removeLevel(preset.id, type, level);
    await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  Removed the bonus of ${label} ${level} from **${preset.name}**.` : `**${preset.name}** had no bonus at ${label} ${level}.`, removed ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const existing = await presetsDb.listLevels(preset.id);
  if (existing.length >= 25 && !existing.some((step) => step.source === type && step.level === level)) {
    await interaction.editReply({ components: [textCard('A preset can have 25 level bonuses. Remove one first.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  await presetsDb.upsertLevel(preset.id, type, level, entries);
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  From ${label} **${level}**, members get **${entries}** extra entries in **${preset.name}**. Only the best step a member has reached counts.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function requireLevelCmd(interaction) {
  const name = interaction.options.getString('name', true);
  const level = interaction.options.getInteger('level');
  const voiceLevel = interaction.options.getInteger('voice_level');
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const preset = await presetsDb.getPreset(interaction.guild.id, name);
  if (!preset) {
    await interaction.editReply({ components: [textCard("That preset doesn't exist.", 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const updated = await presetsDb.setRequirements(preset.id, { minLevel: level, minVoiceLevel: voiceLevel });
  const asks = [updated.min_level ? `message level **${updated.min_level}**` : null, updated.min_voice_level ? `voice level **${updated.min_voice_level}**` : null].filter(Boolean);
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  **${updated.name}** ${asks.length ? `asks for ${asks.join(' and ')} to enter` : 'asks for no level'}.${asks.length ? ' Leveling has to be on for members to have a level.' : ''}`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}
