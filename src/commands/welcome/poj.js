const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const ms = require('ms');
const { ensureGuild } = require('../../db/guilds');
const pojDb = require('../../db/poj');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const DEFAULT_DELETE_MS = 5000;

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
  const channel = interaction.options.getChannel('channel', true);
  const deleteAfterStr = interaction.options.getString('delete_after');
  const deleteAfterMs = deleteAfterStr ? ms(deleteAfterStr) : DEFAULT_DELETE_MS;

  if (typeof deleteAfterMs !== 'number' || Number.isNaN(deleteAfterMs) || deleteAfterMs <= 0) {
    await interaction.reply({ content: 'Provide a valid duration, e.g. `5s`, `10s`, `1m`.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await pojDb.ensureConfig(interaction.guild.id);

  try {
    await pojDb.addChannel(interaction.guild.id, channel.id, deleteAfterMs);
  } catch (err) {
    await interaction.editReply({ components: [textCard(err.userFacing ? err.message : 'Failed to add channel.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Added ${channel} — ping deletes after **${ms(deleteAfterMs, { long: true })}**.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function removeCmd(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const removed = await pojDb.removeChannel(interaction.guild.id, channel.id);
  await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  Removed ${channel}.` : `${channel} wasn't in the ping-on-join list.`, removed ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function listCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const config = await pojDb.ensureConfig(interaction.guild.id);
  const channels = await pojDb.listChannels(interaction.guild.id);

  const lines = [`**Status:** ${config.enabled ? `${EMOJI.APPROVE} Enabled` : `${EMOJI.DENY} Disabled`}`];
  lines.push(channels.length ? channels.map((c) => `<#${c.channel_id}> — deletes after **${ms(c.delete_after_ms, { long: true })}**`).join('\n') : 'No channels configured.');
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function enableCmd(interaction) {
  const enabled = interaction.options.getBoolean('enabled', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await pojDb.setEnabled(interaction.guild.id, enabled);
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Ping-on-join ${enabled ? 'enabled' : 'disabled'}.`, enabled ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function clearCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await pojDb.clearChannels(interaction.guild.id);
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  All ping-on-join channels removed.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}
