const { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getDeleted, getEdited, MAX_ENTRIES_PER_CHANNEL } = require('../../utils/snipeCache');
const { COLORS } = require('../../utils/colors');
const { t, tn, languageOf } = require('../../i18n');

function clip(value, limit) {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function attachmentLines(attachments, lang) {
  return (attachments ?? []).filter((attachment) => attachment.url).map((attachment) => `[${attachment.name ?? t(lang, 'utility.snipe.attachment')}](${attachment.url})`).join('\n');
}

function baseEmbed(entry, label, lang) {
  const { message } = entry;
  const noText = t(lang, 'utility.snipe.noText');
  const embed = new EmbedBuilder()
    .setColor(COLORS.DEFAULT)
    .setAuthor({ name: `${message.author.name ?? t(lang, 'utility.snipe.unknownUser')} · ${label}`, ...(message.author.avatar ? { iconURL: message.author.avatar } : {}) })
    .setTimestamp(message.createdTimestamp)
    .setFooter({ text: t(lang, 'utility.snipe.footer', { label: label.toLowerCase(), time: new Date(entry.capturedAt).toISOString() }) });

  if (message.content) embed.setDescription(clip(message.content, 4096));
  else embed.setDescription(noText);

  const files = attachmentLines(message.attachments, lang);
  if (files) embed.addFields({ name: t(lang, 'utility.snipe.attachments'), value: clip(files, 1024), inline: false });
  if (message.embeds?.length) embed.addFields({ name: t(lang, 'utility.snipe.richContent'), value: tn(lang, 'utility.snipe.embeds', message.embeds.length), inline: false });
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
    const lang = await languageOf(interaction);
    const subcommand = interaction.options.getSubcommand();
    const index = interaction.options.getInteger('index') ?? 1;
    const entry = subcommand === 'edited' ? getEdited(interaction.channel.id, index) : getDeleted(interaction.channel.id, index);

    if (!entry) {
      await interaction.reply({ content: t(lang, subcommand === 'edited' ? 'utility.snipe.noneEdited' : 'utility.snipe.noneDeleted', { index }), flags: MessageFlags.Ephemeral });
      return;
    }

    const embed = baseEmbed(entry, t(lang, subcommand === 'edited' ? 'utility.snipe.label.edited' : 'utility.snipe.label.deleted'), lang);
    if (subcommand === 'edited') {
      const noText = t(lang, 'utility.snipe.noText');
      embed.setFields([]);
      embed.addFields(
        { name: t(lang, 'utility.snipe.before'), value: clip(entry.before || noText, 1024), inline: false },
        { name: t(lang, 'utility.snipe.after'), value: clip(entry.after || noText, 1024), inline: false },
      );
      const files = attachmentLines(entry.message.attachments, lang);
      if (files) embed.addFields({ name: t(lang, 'utility.snipe.attachments'), value: clip(files, 1024), inline: false });
    }

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
