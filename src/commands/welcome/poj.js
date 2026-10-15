const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { parseDuration: parseLength, formatDuration } = require('../../utils/duration');
const { ensureGuild } = require('../../db/guilds');
const pojDb = require('../../db/poj');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

const DEFAULT_DELETE_MS = 5000;
// The limit db/poj.js enforces (its error is the one userFacing error addChannel throws).
const MAX_CHANNELS = 10;

module.exports = {
  aliases: ['j'],
  data: new SlashCommandBuilder()
    .setName('poj')
    .setDescription('Ping on Join, mentions a new member in specific channels, then deletes the ping.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a ping-on-join channel (up to 10).')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel to ping in').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption((o) => o.setName('delete_after').setDescription('e.g. 5s, 10s, 1m (default 5s)').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a ping-on-join channel.').addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List ping-on-join channels.'))
    .addSubcommand((s) => s.setName('enable').setDescription('Turn ping-on-join on/off.').addBooleanOption((o) => o.setName('enabled').setDescription('Enable?').setRequired(true)))
    .addSubcommand((s) => s.setName('clear').setDescription('Remove every ping-on-join channel.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addCmd(interaction);
    if (sub === 'remove') return removeCmd(interaction);
    if (sub === 'list') return listCmd(interaction);
    if (sub === 'enable') return enableCmd(interaction);
    return clearCmd(interaction);
  },
};

async function addCmd(interaction) {
  const lang = await languageOf(interaction);
  const channel = interaction.options.getChannel('channel', true);
  const deleteAfterStr = interaction.options.getString('delete_after');
  const deleteAfterMs = deleteAfterStr ? parseLength(deleteAfterStr) : DEFAULT_DELETE_MS;

  if (typeof deleteAfterMs !== 'number' || Number.isNaN(deleteAfterMs) || deleteAfterMs <= 0) {
    await interaction.reply({ content: t(lang, 'welcome.poj.invalidDuration'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await pojDb.ensureConfig(interaction.guild.id);

  try {
    await pojDb.addChannel(interaction.guild.id, channel.id, deleteAfterMs);
  } catch (err) {
    await interaction.editReply({ components: [textCard(err.userFacing ? t(lang, 'welcome.poj.maxChannels', { max: MAX_CHANNELS }) : t(lang, 'welcome.poj.addFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await interaction.editReply({ components: [textCard(t(lang, 'welcome.poj.added', { emoji: EMOJI.APPROVE, channel: `${channel}`, duration: formatDuration(deleteAfterMs, lang) }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function removeCmd(interaction) {
  const lang = await languageOf(interaction);
  const channel = interaction.options.getChannel('channel', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const removed = await pojDb.removeChannel(interaction.guild.id, channel.id);
  await interaction.editReply({ components: [textCard(removed ? t(lang, 'welcome.poj.removed', { emoji: EMOJI.APPROVE, channel: `${channel}` }) : t(lang, 'welcome.poj.notInList', { channel: `${channel}` }), removed ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function listCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const config = await pojDb.ensureConfig(interaction.guild.id);
  const channels = await pojDb.listChannels(interaction.guild.id);

  const lines = [config.enabled ? t(lang, 'welcome.poj.status.enabled', { emoji: EMOJI.APPROVE }) : t(lang, 'welcome.poj.status.disabled', { emoji: EMOJI.DENY })];
  lines.push(channels.length ? channels.map((c) => t(lang, 'welcome.poj.listLine', { channel: `<#${c.channel_id}>`, duration: formatDuration(c.delete_after_ms, lang) })).join('\n') : t(lang, 'welcome.poj.noChannels'));
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function enableCmd(interaction) {
  const lang = await languageOf(interaction);
  const enabled = interaction.options.getBoolean('enabled', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await pojDb.setEnabled(interaction.guild.id, enabled);
  await interaction.editReply({ components: [textCard(t(lang, enabled ? 'welcome.poj.enabled' : 'welcome.poj.disabled', { emoji: EMOJI.APPROVE }), enabled ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function clearCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await pojDb.clearChannels(interaction.guild.id);
  await interaction.editReply({ components: [textCard(t(lang, 'welcome.poj.cleared', { emoji: EMOJI.APPROVE }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}
