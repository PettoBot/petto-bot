const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const ms = require('ms');
const { ensureGuild } = require('../../db/guilds');
const templatesDb = require('../../db/giveawayTemplates');
const presetsDb = require('../../db/giveawayPresets');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveawaytemplate')
    .setDescription('Save full giveaway configurations to relaunch later.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('list').setDescription('List saved giveaway templates.'))
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Save a giveaway template.')
        .addStringOption((o) => o.setName('name').setDescription('Template name').setRequired(true))
        .addStringOption((o) => o.setName('prize').setDescription('Prize').setRequired(true))
        .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 1h, 3d').setRequired(true))
        .addChannelOption((o) => o.setName('channel').setDescription('Default channel (optional)').setRequired(false))
        .addStringOption((o) => o.setName('claim_time').setDescription('e.g. 5m (default: none)').setRequired(false))
        .addStringOption((o) => o.setName('preset').setDescription('Giveaway preset name (default: none)').setRequired(false))
        .addStringOption((o) => o.setName('embed_template').setDescription('Saved giveaway embed template name (default: none)').setRequired(false))
        .addStringOption((o) => o.setName('entry_mode').setDescription('button or reaction (default: button)').setRequired(false).addChoices({ name: 'button', value: 'button' }, { name: 'reaction', value: 'reaction' })),
    )
    .addSubcommand((s) => s.setName('edit').setDescription('Same options as create — overwrites the existing template.').addStringOption((o) => o.setName('name').setDescription('Template name').setRequired(true)).addStringOption((o) => o.setName('prize').setDescription('Prize').setRequired(false)).addIntegerOption((o) => o.setName('winners').setDescription('Number of winners').setRequired(false).setMinValue(1)).addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 1h, 3d').setRequired(false)).addChannelOption((o) => o.setName('channel').setDescription('Default channel').setRequired(false)).addStringOption((o) => o.setName('claim_time').setDescription('e.g. 5m').setRequired(false)).addStringOption((o) => o.setName('preset').setDescription('Giveaway preset name').setRequired(false)).addStringOption((o) => o.setName('embed_template').setDescription('Saved giveaway embed template name').setRequired(false)).addStringOption((o) => o.setName('entry_mode').setDescription('button or reaction').setRequired(false).addChoices({ name: 'button', value: 'button' }, { name: 'reaction', value: 'reaction' })))
    .addSubcommand((s) => s.setName('remove').setDescription('Delete a giveaway template.').addStringOption((o) => o.setName('name').setDescription('Template name').setRequired(true))),
  aliases: ['gwt'],

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') return listCmd(interaction);
    if (sub === 'create') return saveCmd(interaction, false);
    if (sub === 'edit') return saveCmd(interaction, true);
    return removeCmd(interaction);
  },
};

async function listCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const templates = await templatesDb.listTemplates(interaction.guild.id);
  const text = templates.length ? templates.map((t) => `\`${t.name}\` — **${t.data.prize}**, ${t.data.winners} winner(s)`).join('\n') : 'No giveaway templates saved.';
  await interaction.editReply({ components: [textCard(text, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function saveCmd(interaction, isEdit) {
  const name = interaction.options.getString('name', true);

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  let base = {};
  if (isEdit) {
    const existing = await templatesDb.getTemplate(interaction.guild.id, name);
    if (!existing) {
      await interaction.editReply({ components: [textCard("That template doesn't exist. Use `giveawaytemplate create` first.", 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    base = existing.data;
  }

  const prize = interaction.options.getString('prize') ?? base.prize;
  const winners = interaction.options.getInteger('winners') ?? base.winners;
  const durationStr = interaction.options.getString('duration');
  const durationMs = durationStr ? ms(durationStr) : base.durationMs;
  const channel = interaction.options.getChannel('channel');
  const claimTimeStr = interaction.options.getString('claim_time');
  const presetName = interaction.options.getString('preset');
  const embedTemplate = interaction.options.getString('embed_template');
  const entryMode = interaction.options.getString('entry_mode') ?? base.entryMode ?? 'button';

  if (!prize || !winners || !durationMs || typeof durationMs !== 'number' || Number.isNaN(durationMs)) {
    await interaction.editReply({ components: [textCard('Provide at least `prize`, `winners`, and a valid `duration` (e.g. `10m`).', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  let presetId = isEdit ? base.presetId : null;
  if (presetName) {
    const preset = await presetsDb.getPreset(interaction.guild.id, presetName);
    if (!preset) {
      await interaction.editReply({ components: [textCard(`Preset \`${presetName}\` doesn't exist.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    presetId = preset.id;
  }

  const data = {
    prize,
    winners,
    durationMs,
    channelId: channel?.id ?? (isEdit ? base.channelId : null),
    claimTimeMs: claimTimeStr ? ms(claimTimeStr) : isEdit ? base.claimTimeMs : null,
    presetId,
    embedTemplate: embedTemplate ?? (isEdit ? base.embedTemplate : null),
    entryMode,
  };

  const saved = await templatesDb.upsertTemplate(interaction.guild.id, name, data);
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Template **${saved.name}** saved.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function removeCmd(interaction) {
  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await templatesDb.deleteTemplate(interaction.guild.id, name);
  await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  Template removed.` : "That template doesn't exist.", removed ? 0xa5ea7a : 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
}
