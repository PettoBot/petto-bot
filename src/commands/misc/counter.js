const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const countersDb = require('../../db/counters');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { OPTIONS: OPTION_LIST, optionLabel } = require('../../utils/counterNames');
const { t, languageOf } = require('../../i18n');

const TYPE_CHOICES = [
  { name: 'voice', value: 'voice' }, { name: 'text', value: 'text' }, { name: 'category', value: 'category' },
  { name: 'announcement', value: 'announce' }, { name: 'stage', value: 'stage' },
];

module.exports = {
  aliases: ['counters'],
  data: new SlashCommandBuilder()
    .setName('counter')
    .setDescription('Create live server counters as channel names.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('add').setDescription('Create a live counter channel.').addStringOption((o) => o.setName('option').setDescription('What to count, or a unix timestamp').setRequired(true)).addStringOption((o) => o.setName('type').setDescription('Channel type').setRequired(true).addChoices(...TYPE_CHOICES)).addStringOption((o) => o.setName('name_template').setDescription('Use {option}, {value}, or {remaining}').setRequired(false)).addIntegerOption((o) => o.setName('interval_seconds').setDescription('Update interval, 60-86400 seconds').setMinValue(60).setMaxValue(86400).setRequired(false)).addChannelOption((o) => o.setName('parent').setDescription('Parent category').setRequired(false)).addStringOption((o) => o.setName('prefix').setDescription('Text before the rendered name').setRequired(false)).addStringOption((o) => o.setName('suffix').setDescription('Text after the rendered name').setRequired(false)))
    .addSubcommand((s) => s.setName('edit').setDescription('Edit a live counter without recreating its channel.').addChannelOption((o) => o.setName('channel').setDescription('Counter channel').setRequired(true)).addStringOption((o) => o.setName('name_template').setDescription('Use {option}, {value}, or {remaining}').setRequired(false)).addIntegerOption((o) => o.setName('interval_seconds').setDescription('Update interval, 60-86400 seconds').setMinValue(60).setMaxValue(86400).setRequired(false)).addChannelOption((o) => o.setName('parent').setDescription('New parent category').setRequired(false)).addStringOption((o) => o.setName('prefix').setDescription('Text before the rendered name').setRequired(false)).addStringOption((o) => o.setName('suffix').setDescription('Text after the rendered name').setRequired(false)).addBooleanOption((o) => o.setName('enabled').setDescription('Enable updates').setRequired(false)))
    .addSubcommand((s) => s.setName('remove').setDescription('Stop updating a counter; the channel stays.').addChannelOption((o) => o.setName('channel').setDescription('Counter channel').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List live counters.')),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return add(interaction, lang);
    if (sub === 'edit') return edit(interaction, lang);
    if (sub === 'remove') return remove(interaction, lang);
    return list(interaction, lang);
  },
};

const OPTIONS = new Set(OPTION_LIST);

function card(interaction, content, color = 0x4b4f59) { return interaction.reply({ components: [textCard(content, color)], flags: MessageFlags.IsComponentsV2 }); }

async function add(interaction, lang) {
  const option = interaction.options.getString('option', true).trim().toLowerCase();
  const type = interaction.options.getString('type', true);
  if (!OPTIONS.has(option) && !/^\d{10}$/.test(option)) return card(interaction, t(lang, 'counters.add.unknownOption', { options: [...OPTIONS].join(', ') }), 0xfe6465);
  const channelType = { voice: ChannelType.GuildVoice, text: ChannelType.GuildText, category: ChannelType.GuildCategory, announce: ChannelType.GuildAnnouncement, stage: ChannelType.GuildStageVoice }[type];
  try {
    const parent = interaction.options.getChannel('parent');
    // i18n-ignore: the default template is saved as is; `{option}` shows in the server's language when the name is drawn
    const nameTemplate = interaction.options.getString('name_template')?.slice(0, 100) || '{option}: {value}';
    const intervalSeconds = interaction.options.getInteger('interval_seconds') ?? 60;
    const prefix = interaction.options.getString('prefix')?.slice(0, 30) || '';
    const suffix = interaction.options.getString('suffix')?.slice(0, 30) || '';
    if (parent && parent.type !== ChannelType.GuildCategory) return card(interaction, t(lang, 'counters.parentNotCategory'), 0xfe6465);
    const channel = await interaction.guild.channels.create({ name: `${prefix}${optionLabel(option, lang)}${suffix}`.slice(0, 100), type: channelType, parent: parent?.id, reason: t(lang, 'counters.add.reason', { user: interaction.user.tag }) });
    await countersDb.add({ guild_id: interaction.guild.id, channel_id: channel.id, counter_option: option, channel_type: type, created_by: interaction.user.id, name_template: nameTemplate, interval_seconds: intervalSeconds, prefix, suffix, parent_id: parent?.id ?? null });
    return card(interaction, t(lang, 'counters.add.done', { emoji: EMOJI.APPROVE, channel: `${channel}` }), 0xa5ea7a);
  } catch (err) {
    // The error of Discord is shown as it comes.
    if (err.message != null) return card(interaction, t(lang, 'counters.add.failed', { error: err.message }), 0xfe6465);
    return card(interaction, t(lang, 'counters.add.failedPermission', { permission: t(lang, 'core.perm.ManageChannels') }), 0xfe6465);
  }
}

async function edit(interaction, lang) {
  const channel = interaction.options.getChannel('channel', true);
  const current = await countersDb.get(interaction.guild.id, channel.id);
  if (!current) return card(interaction, t(lang, 'counters.notCounter'), 0xfe6465);
  const patch = {};
  const template = interaction.options.getString('name_template');
  const interval = interaction.options.getInteger('interval_seconds');
  const parent = interaction.options.getChannel('parent');
  const prefix = interaction.options.getString('prefix');
  const suffix = interaction.options.getString('suffix');
  const enabled = interaction.options.getBoolean('enabled');
  if (template) patch.name_template = template.slice(0, 100);
  if (interval != null) patch.interval_seconds = interval;
  if (parent) {
    if (parent.type !== ChannelType.GuildCategory) return card(interaction, t(lang, 'counters.parentNotCategory'), 0xfe6465);
    patch.parent_id = parent.id;
    await channel.setParent(parent.id, { lockPermissions: false }).catch(() => {});
  }
  if (prefix != null) patch.prefix = prefix.slice(0, 30);
  if (suffix != null) patch.suffix = suffix.slice(0, 30);
  if (enabled != null) patch.enabled = enabled;
  if (!Object.keys(patch).length) return card(interaction, t(lang, 'counters.edit.nothing'), 0xfe6465);
  await countersDb.update(interaction.guild.id, channel.id, patch);
  return card(interaction, t(lang, 'counters.edit.done', { emoji: EMOJI.APPROVE, channel: `${channel}` }), 0xa5ea7a);
}

async function remove(interaction, lang) {
  const channel = interaction.options.getChannel('channel', true);
  const removed = await countersDb.remove(interaction.guild.id, channel.id);
  return card(interaction, removed ? t(lang, 'counters.remove.done', { emoji: EMOJI.APPROVE, channel: `${channel}` }) : t(lang, 'counters.notCounter'), removed ? 0xa5ea7a : 0xfe6465);
}

const CHANNEL_TYPES = new Set(TYPE_CHOICES.map((choice) => choice.value));

async function list(interaction, lang) {
  const rows = await countersDb.list(interaction.guild.id);
  const typeName = (type) => (CHANNEL_TYPES.has(type) ? t(lang, `counters.type.${type}`) : type);
  const body = rows.length ? rows.map((row) => `<#${row.channel_id}> · \`${row.counter_option}\` · ${typeName(row.channel_type)}`).join('\n') : t(lang, 'counters.list.none');
  return card(interaction, t(lang, 'counters.list.title', { count: rows.length, body }));
}
