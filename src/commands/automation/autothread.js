const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const db = require('../../db/autoThreads');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const ARCHIVE_CHOICES = [
  { name: '1 hour', value: 60 },
  { name: '1 day', value: 1440 },
  { name: '3 days', value: 4320 },
  { name: '1 week', value: 10080 },
];

module.exports = {
  aliases: ['at'],
  data: new SlashCommandBuilder()
    .setName('autothread')
    .setDescription('Automatically starts a thread off every new message in a channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Turn on auto-threading for a channel.')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel to auto-thread').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption((o) => o.setName('name').setDescription('Thread name (supports variables, default: {user_name})').setRequired(false))
        .addStringOption((o) => o.setName('message').setDescription('Starter message sent inside the new thread (supports variables, {reactreply:emoji})').setRequired(false))
        .addStringOption((o) => o.setName('embed_template').setDescription('Or use a saved /embed template as the starter message').setRequired(false))
        .addIntegerOption((o) => o.setName('archive').setDescription('Auto-archive after (default: 1 hour)').setRequired(false).addChoices(...ARCHIVE_CHOICES)),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('Turn off auto-threading for a channel.').addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List every channel with auto-threading on.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addCmd(interaction);
    if (sub === 'remove') return removeCmd(interaction);
    return listCmd(interaction);
  },
};

async function addCmd(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  const name = interaction.options.getString('name') ?? '{user_name}';
  const message = interaction.options.getString('message') ?? null;
  const embedTemplate = interaction.options.getString('embed_template') ?? null;
  const archive = interaction.options.getInteger('archive') ?? 60;

  if (!channel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.CreatePublicThreads)) {
    await interaction.reply({ content: 'I need the **Create Public Threads** permission in that channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await db.upsertThread(interaction.guild.id, channel.id, { name_template: name, message_text: message, embed_template: embedTemplate, archive_minutes: archive });

  const text = `${EMOJI.APPROVE}  Auto-threading is now on for ${channel}.\n**Thread name:** \`${name}\`${message ? `\n**Starter message:** ${message.length > 200 ? `${message.slice(0, 200)}…` : message}` : ''}${embedTemplate ? `\n**Embed template:** \`${embedTemplate}\`` : ''}`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function removeCmd(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const removed = await db.removeThread(interaction.guild.id, channel.id);
  await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  Auto-threading turned off for ${channel}.` : `Auto-threading isn't on for ${channel}.`, removed ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function listCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const threads = await db.listThreads(interaction.guild.id);
  if (!threads.length) {
    await interaction.editReply({ components: [textCard('No channels have auto-threading on. Use `!autothread add`.', 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = threads.map((t) => `<#${t.channel_id}> — name: \`${t.name_template}\`${t.message_text || t.embed_template ? ', with a starter message' : ''}`);
  await interaction.editReply({ components: [textCard(`**Auto-threading (${threads.length}):**\n${lines.join('\n')}`, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}
