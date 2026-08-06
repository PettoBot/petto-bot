const { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getDeleted, getEdited, MAX_ENTRIES_PER_CHANNEL } = require('../../utils/snipeCache');
const { COLORS } = require('../../utils/colors');

function clip(value, limit) {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function attachmentLines(attachments) {
  return (attachments ?? []).filter((attachment) => attachment.url).map((attachment) => `[${attachment.name}](${attachment.url})`).join('\n');
}

function baseEmbed(entry, label) {
  const { message } = entry;
  const embed = new EmbedBuilder()
    .setColor(COLORS.DEFAULT)
    .setAuthor({ name: `${message.author.name} · ${label}`, ...(message.author.avatar ? { iconURL: message.author.avatar } : {}) })
    .setTimestamp(message.createdTimestamp)
    .setFooter({ text: `Snipe ${label.toLowerCase()} · captured ${new Date(entry.capturedAt).toISOString()}` });

  if (message.content) embed.setDescription(clip(message.content, 4096));
  else embed.setDescription('*No text content*');

  const files = attachmentLines(message.attachments);
  if (files) embed.addFields({ name: 'Attachments', value: clip(files, 1024), inline: false });
  if (message.embeds?.length) embed.addFields({ name: 'Rich content', value: `${message.embeds.length} embed${message.embeds.length === 1 ? '' : 's'} were attached to this message.`, inline: false });
  return embed;
}

module.exports = {
  aliases: ['sniped'],
  prefixDefaultSubcommand: 'deleted',
  data: new SlashCommandBuilder()
    .setName('snipe')
    .setDescription('View a recently deleted or edited message in this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('deleted').setDescription('View a deleted message.').addIntegerOption((option) => option.setName('index').setDescription('1 is the latest, up to 10').setMinValue(1).setMaxValue(MAX_ENTRIES_PER_CHANNEL).setRequired(false)))
    .addSubcommand((sub) => sub.setName('edited').setDescription('View a previous version of an edited message.').addIntegerOption((option) => option.setName('index').setDescription('1 is the latest, up to 10').setMinValue(1).setMaxValue(MAX_ENTRIES_PER_CHANNEL).setRequired(false))),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const index = interaction.options.getInteger('index') ?? 1;
    const entry = subcommand === 'edited' ? getEdited(interaction.channel.id, index) : getDeleted(interaction.channel.id, index);

    if (!entry) {
      await interaction.reply({ content: `There is no ${subcommand} message ${index} in this channel's recent cache.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const embed = baseEmbed(entry, subcommand === 'edited' ? 'edited message' : 'deleted message');
    if (subcommand === 'edited') {
      embed.setFields([]);
      embed.addFields(
        { name: 'Before', value: clip(entry.before || '*No text content*', 1024), inline: false },
        { name: 'After', value: clip(entry.after || '*No text content*', 1024), inline: false },
      );
      const files = attachmentLines(entry.message.attachments);
      if (files) embed.addFields({ name: 'Attachments', value: clip(files, 1024), inline: false });
    }

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
