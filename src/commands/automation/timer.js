const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const autoMessagesDb = require('../../db/autoMessages');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { textCard } = require('../../utils/caseCard');

module.exports = {
  aliases: ['tm'],
  data: new SlashCommandBuilder()
    .setName('timer')
    .setDescription('Send a repeating message in a channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('add').setDescription('Create a timer, minimum 10 minutes.').addChannelOption((o) => o.setName('channel').setDescription('Text channel.').setRequired(true)).addStringOption((o) => o.setName('interval').setDescription('e.g. 10m, 2h, 1d.').setRequired(true)).addStringOption((o) => o.setName('message').setDescription('Message to send.').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a timer.').addIntegerOption((o) => o.setName('id').setDescription('Timer ID.').setRequired(true)))
    .addSubcommand((s) => s.setName('view').setDescription('View a timer.').addIntegerOption((o) => o.setName('id').setDescription('Timer ID.').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List this server’s timers.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addTimer(interaction);
    if (sub === 'remove') return removeTimer(interaction);
    if (sub === 'view') return viewTimer(interaction);
    const rows = await autoMessagesDb.list(interaction.guild.id);
    const body = rows.length ? rows.map(formatRow).join('\n') : 'No timers configured.';
    return interaction.reply({ components: [textCard(body, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
  },
};

function formatRow(row) {
  return `**#${row.id}** <#${row.channel_id}> every **${formatDuration(row.interval_ms)}** · ${row.message}`;
}

async function addTimer(interaction) {
  const intervalMs = parseDuration(interaction.options.getString('interval', true));
  if (!intervalMs || intervalMs < 10 * 60 * 1000) return interaction.reply({ content: 'The interval must be at least 10 minutes.', flags: MessageFlags.Ephemeral });
  const channel = interaction.options.getChannel('channel', true);
  if (!channel.isTextBased()) return interaction.reply({ content: 'Choose a text channel.', flags: MessageFlags.Ephemeral });
  const existing = (await autoMessagesDb.list(interaction.guild.id)).find((row) => row.channel_id === channel.id);
  if (existing) return interaction.reply({ content: `That channel already has timer #${existing.id}. Remove it first.`, flags: MessageFlags.Ephemeral });
  const row = await autoMessagesDb.add({ guildId: interaction.guild.id, channelId: channel.id, intervalMs, message: interaction.options.getString('message', true) });
  return interaction.reply({ components: [textCard(`Timer #${row.id} created for <#${channel.id}> every **${formatDuration(intervalMs)}**.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function removeTimer(interaction) {
  const removed = await autoMessagesDb.remove(interaction.guild.id, interaction.options.getInteger('id', true));
  return interaction.reply({ components: [textCard(removed ? 'Timer removed.' : 'That timer does not exist.', removed ? 0xa5ea7a : 0xff6b6b)], flags: MessageFlags.IsComponentsV2 });
}

async function viewTimer(interaction) {
  const row = await autoMessagesDb.get(interaction.guild.id, interaction.options.getInteger('id', true));
  return interaction.reply({ components: [textCard(row ? formatRow(row) : 'That timer does not exist.', row ? 0x4b4f59 : 0xff6b6b)], flags: MessageFlags.IsComponentsV2 });
}
