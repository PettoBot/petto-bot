const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const stickyDb = require('../../db/stickyMessages');
const { getTemplate } = require('../../db/embedTemplates');
const { stickyPayload } = require('../../utils/stickyPayload');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stickymessage')
    .setDescription('A message that re-posts itself at the bottom of a channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Set (or replace) the sticky message in a channel.')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption((o) => o.setName('content').setDescription('The sticky text (supports {newline}, {separator}), or - when you use a saved embed').setRequired(true))
        .addStringOption((o) => o.setName('template').setDescription('Name of a saved embed to send instead of the text').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('Remove the sticky message from a channel.').addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List every sticky message in this server.')),
  aliases: ['sticky'],

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'set') return setCmd(interaction);
    if (sub === 'remove') return removeCmd(interaction);
    return listCmd(interaction);
  },
};

async function setCmd(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  const rawContent = interaction.options.getString('content', true);
  const templateName = (interaction.options.getString('template') ?? '').trim();
  const content = rawContent.trim() === '-' && templateName ? '' : rawContent.replaceAll('{newline}', '\n').replaceAll('{separator}', '──────────────────────');

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.SendMessages)) {
    await interaction.reply({ content: 'I need permission to send messages in that channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  if (templateName && !(await getTemplate(interaction.guild.id, templateName).catch(() => null))?.data) {
    await interaction.editReply({ components: [textCard(`There is no saved embed called \`${templateName}\`.`, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const existing = await stickyDb.getSticky(interaction.guild.id, channel.id);
  if (existing?.message_id) {
    const old = await channel.messages.fetch(existing.message_id).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }

  const row = await stickyDb.setSticky(interaction.guild.id, channel.id, content, templateName || null);

  const payload = await stickyPayload(row, { guild: interaction.guild, channel, member: interaction.member, user: interaction.user });
  const sent = !payload ? null : await channel.send(payload).catch((err) => {
    logger.error('Failed to post sticky message:', err);
    return null;
  });

  if (sent) await stickyDb.setMessageId(interaction.guild.id, channel.id, sent.id);

  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Sticky message set in ${channel}.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function removeCmd(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const existing = await stickyDb.getSticky(interaction.guild.id, channel.id);
  if (!existing) {
    await interaction.editReply({ components: [textCard(`No sticky message in ${channel}.`, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (existing.message_id) {
    const old = await channel.messages.fetch(existing.message_id).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }
  await stickyDb.removeSticky(interaction.guild.id, channel.id);

  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Sticky message removed from ${channel}.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function listCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const list = await stickyDb.listForGuild(interaction.guild.id);
  const text = list.length ? list.map((s) => `<#${s.channel_id}> — ${s.embed_template ? `embed \`${s.embed_template}\`` : `${s.content.slice(0, 60)}${s.content.length > 60 ? '…' : ''}`}`).join('\n') : 'No sticky messages configured.';
  await interaction.editReply({ components: [textCard(text, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}
