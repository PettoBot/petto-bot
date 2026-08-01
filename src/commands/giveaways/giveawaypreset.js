const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const ms = require('ms');
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
    .addSubcommand((s) => s.setName('create').setDescription('Create a preset.').addStringOption((o) => o.setName('name').setDescription('Preset name').setRequired(true)))
    .addSubcommand((s) => s.setName('view').setDescription('View a preset.').addStringOption((o) => o.setName('name').setDescription('Preset name').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Delete a preset.').addStringOption((o) => o.setName('name').setDescription('Preset name').setRequired(true)))
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
    ),
  aliases: ['gwp'],

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') return createCmd(interaction);
    if (sub === 'view') return viewCmd(interaction);
    if (sub === 'remove') return removeCmd(interaction);
    if (sub === 'add-role') return addRoleCmd(interaction);
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

  const roles = await presetsDb.listRoles(preset.id);
  const lines = roles.length
    ? roles.map(
        (r) =>
          `<@&${r.role_id}> — **${r.entries}** entries${r.entries_stack ? ' (stacks)' : ''}, ${r.claim_time_ms ? formatDuration(r.claim_time_ms) : 'no'} claim time${r.claim_time_stack ? ' (stacks)' : ''}`,
      )
    : ['No roles configured yet.'];

  await interaction.editReply({ components: [textCard(`**Preset: ${preset.name}**\n${lines.join('\n')}`, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
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
    claimTimeMs = ms(claimTimeStr);
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
