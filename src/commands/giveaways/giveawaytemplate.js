const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { commandRef } = require('../../utils/commandRef');
const { parseDuration: parseLength } = require('../../utils/duration');
const { ensureGuild } = require('../../db/guilds');
const templatesDb = require('../../db/giveawayTemplates');
const presetsDb = require('../../db/giveawayPresets');
const embedTemplatesDb = require('../../db/embedTemplates');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, tn, languageOf } = require('../../i18n');

module.exports = {
  // Also registered as a slash command (it already has subcommands, so it needs no umbrella); the prefix keeps working.
  registerSlash: true,
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
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') return listCmd(interaction, lang);
    if (sub === 'create') return saveCmd(interaction, false, lang);
    if (sub === 'edit') return saveCmd(interaction, true, lang);
    return removeCmd(interaction, lang);
  },
};

async function listCmd(interaction, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const templates = await templatesDb.listTemplates(interaction.guild.id);
  const text = templates.length
    ? templates.map((row) => tn(lang, 'giveaways.template.listLine', row.data.winners, { count: row.data.winners, name: row.name, prize: row.data.prize })).join('\n')
    : t(lang, 'giveaways.template.none');
  await interaction.editReply({ components: [textCard(text)], flags: MessageFlags.IsComponentsV2 });
}

async function saveCmd(interaction, isEdit, lang) {
  const name = interaction.options.getString('name', true);

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  let base = {};
  if (isEdit) {
    const existing = await templatesDb.getTemplate(interaction.guild.id, name);
    if (!existing) {
      await interaction.editReply({ components: [textCard(t(lang, 'giveaways.template.editMissing'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    base = existing.data;
  }

  const prize = interaction.options.getString('prize') ?? base.prize;
  const winners = interaction.options.getInteger('winners') ?? base.winners;
  const durationStr = interaction.options.getString('duration');
  const durationMs = durationStr ? parseLength(durationStr) : base.durationMs;
  const channel = interaction.options.getChannel('channel');
  const claimTimeStr = interaction.options.getString('claim_time');
  const presetName = interaction.options.getString('preset');
  const embedTemplate = interaction.options.getString('embed_template');
  const entryMode = interaction.options.getString('entry_mode') ?? base.entryMode ?? 'button';

  if (!prize || !winners || !durationMs || typeof durationMs !== 'number' || Number.isNaN(durationMs)) {
    await interaction.editReply({ components: [textCard(t(lang, 'giveaways.template.needFields'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  let presetId = isEdit ? base.presetId : null;
  if (presetName) {
    const preset = await presetsDb.getPreset(interaction.guild.id, presetName);
    if (!preset) {
      await interaction.editReply({ components: [textCard(t(lang, 'giveaways.presetMissing', { name: presetName }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    presetId = preset.id;
  }

  if (embedTemplate) {
    const embedDoc = await embedTemplatesDb.getTemplate(interaction.guild.id, embedTemplate);
    if (!embedDoc) {
      await interaction.editReply({
        components: [textCard(t(lang, 'giveaways.embedMissing', { name: embedTemplate, command: commandRef(interaction, `embed create ${embedTemplate}`) }), 0xfe6465)],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }
  }

  const data = {
    prize,
    winners,
    durationMs,
    channelId: channel?.id ?? (isEdit ? base.channelId : null),
    claimTimeMs: claimTimeStr ? parseLength(claimTimeStr) : isEdit ? base.claimTimeMs : null,
    presetId,
    embedTemplate: embedTemplate ?? (isEdit ? base.embedTemplate : null),
    entryMode,
  };

  const saved = await templatesDb.upsertTemplate(interaction.guild.id, name, data);
  await interaction.editReply({ components: [textCard(t(lang, 'giveaways.template.saved', { emoji: EMOJI.APPROVE, name: saved.name }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function removeCmd(interaction, lang) {
  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await templatesDb.deleteTemplate(interaction.guild.id, name);
  await interaction.editReply({ components: [textCard(removed ? t(lang, 'giveaways.template.removed', { emoji: EMOJI.APPROVE }) : t(lang, 'giveaways.template.notFound'), removed ? 0xa5ea7a : 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
}
