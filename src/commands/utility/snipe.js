const { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getDeleted, getEdited, getReaction, clearChannel, avatarUrl, MAX_ENTRIES_PER_CHANNEL } = require('../../utils/snipeCache');
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
    .setAuthor({ name: `${message.author.name ?? t(lang, 'utility.snipe.unknownUser')} · ${label}`, ...(avatarUrl(message.author) ? { iconURL: avatarUrl(message.author) } : {}) })
    .setTimestamp(message.createdTimestamp)
    .setFooter({ text: t(lang, 'utility.snipe.footer', { label: label.toLowerCase(), time: new Date(entry.capturedAt).toISOString() }) });

  if (message.content) embed.setDescription(clip(message.content, 4096));
  else embed.setDescription(noText);

  const files = attachmentLines(message.attachments, lang);
  if (files) embed.addFields({ name: t(lang, 'utility.snipe.attachments'), value: clip(files, 1024), inline: false });
  if (message.embedCount) embed.addFields({ name: t(lang, 'utility.snipe.richContent'), value: tn(lang, 'utility.snipe.embeds', message.embedCount), inline: false });
  return embed;
}

function reactionEmbed(entry, lang) {
  const { emoji, user, message } = entry;
  const label = t(lang, 'utility.snipe.label.reaction');
  const lines = [
    t(lang, 'utility.snipe.reaction.line', { emoji: emoji.display, user: user.name ?? t(lang, 'utility.snipe.unknownUser') }),
    t(lang, 'utility.snipe.reaction.message', { url: message.url, author: message.authorName ?? t(lang, 'utility.snipe.unknownUser') }),
  ];
  if (message.preview) lines.push(`> ${clip(message.preview, 200).replace(/\n+/g, ' ')}`);
  const embed = new EmbedBuilder()
    .setColor(COLORS.DEFAULT)
    .setAuthor({ name: `${user.name ?? t(lang, 'utility.snipe.unknownUser')} · ${label}`, ...(avatarUrl(user) ? { iconURL: avatarUrl(user) } : {}) })
    .setDescription(clip(lines.join('\n'), 4096))
    .setFooter({ text: t(lang, 'utility.snipe.footer', { label: label.toLowerCase(), time: new Date(entry.capturedAt).toISOString() }) });
  if (emoji.url) embed.setThumbnail(emoji.url);
  return embed;
}

const INDEX_OPTION = (option) => option.setName('index').setDescription('1 is the latest, up to 10').setMinValue(1).setMaxValue(MAX_ENTRIES_PER_CHANNEL).setRequired(false);

module.exports = {
  aliases: ['sniped'],
  prefixDefaultSubcommand: 'deleted',
  // The words people type: `!snipe edit 2`, `!snipe reaction`, `!snipe reset`.
  prefixSubcommandAliases: { edit: 'edited', del: 'deleted', delete: 'deleted', reaction: 'reactions', react: 'reactions', reset: 'clear', clean: 'clear' },
  data: new SlashCommandBuilder()
    .setName('snipe')
    .setDescription('View a recently deleted or edited message, or a removed reaction, in this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('deleted').setDescription('View a deleted message.').addIntegerOption(INDEX_OPTION))
    .addSubcommand((sub) => sub.setName('edited').setDescription('View a previous version of an edited message.').addIntegerOption(INDEX_OPTION))
    .addSubcommand((sub) => sub.setName('reactions').setDescription('View a reaction that was taken off a message.').addIntegerOption(INDEX_OPTION))
    .addSubcommand((sub) => sub.setName('clear').setDescription('Forget what is saved in this channel.').addStringOption((option) => option.setName('what').setDescription('What to forget (default: all of it)').setRequired(false).addChoices({ name: 'all', value: 'all' }, { name: 'deleted', value: 'deleted' }, { name: 'edited', value: 'edited' }, { name: 'reactions', value: 'reactions' }))),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const subcommand = interaction.options.getSubcommand();
    const index = interaction.options.getInteger('index') ?? 1;

    if (subcommand === 'clear') {
      const removed = clearChannel(interaction.channel.id, interaction.options.getString('what') ?? 'all');
      await interaction.reply({ content: removed ? tn(lang, 'utility.snipe.cleared', removed) : t(lang, 'utility.snipe.clearedNothing'), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }
    if (subcommand === 'reactions') {
      const found = getReaction(interaction.channel.id, index);
      if (!found) {
        await interaction.reply({ content: t(lang, 'utility.snipe.noneReactions', { index }), flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({ embeds: [reactionEmbed(found, lang)], allowedMentions: { parse: [] } });
      return;
    }

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
