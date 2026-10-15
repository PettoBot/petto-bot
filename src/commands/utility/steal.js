const { SlashCommandBuilder, PermissionFlagsBits, StickerFormatType, MessageFlags } = require('discord.js');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');
const { permissionName } = require('../../utils/permissionLabels');
const { t, languageOf } = require('../../i18n');

const EMOJI_RE = /<(a?):(\w+):(\d+)>/g;

const MAX_EMOJIS = 20;

/** The custom emojis written in a text, in order. */
function emojisInText(text) {
  return [...String(text ?? '').matchAll(EMOJI_RE)].map((match) => ({ animated: Boolean(match[1]), name: match[2], id: match[3] }));
}

/** Every custom emoji of a message: in its text, in its embeds, and the ones people reacted with. */
function emojisOfMessage(message) {
  const pieces = [message?.content];
  for (const embed of message?.embeds ?? []) {
    pieces.push(embed.title, embed.description, embed.footer?.text, embed.author?.name);
    for (const field of embed.fields ?? []) pieces.push(field.name, field.value);
  }
  const found = emojisInText(pieces.filter(Boolean).join('\n'));
  for (const reaction of message?.reactions?.cache?.values?.() ?? []) {
    if (reaction.emoji?.id) found.push({ animated: Boolean(reaction.emoji.animated), name: reaction.emoji.name ?? 'emoji', id: reaction.emoji.id });
  }
  return found;
}

function emojiUrl(id, animated) {
  return `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=512`;
}

function stickerUrl(sticker) {
  if (sticker.format === StickerFormatType.Lottie) return null;
  const ext = sticker.format === StickerFormatType.GIF ? 'gif' : 'png';
  return `https://media.discordapp.net/stickers/${sticker.id}.${ext}`;
}

module.exports = {
  aliases: ['stl'],
  data: new SlashCommandBuilder()
    .setName('steal')
    .setDescription('Add an emoji or sticker from elsewhere to this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
    .setDMPermission(false)
    .addStringOption((o) => o.setName('emoji').setDescription('A custom emoji to steal (or reply to a message with emojis, reactions or a sticker instead)').setRequired(false)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
      await interaction.reply({ content: t(lang, 'utility.steal.needPermission', { permission: permissionName('ManageGuildExpressions', lang) }), flags: MessageFlags.Ephemeral });
      return;
    }

    // Only available via the prefix path (rawMessage carries message.reference/stickers) — a real
    // slash interaction has no "message this was in reply to" for the sticker case to work with.
    const message = interaction.rawMessage;
    const repliedMessage = message?.reference ? await message.fetchReference().catch(() => null) : null;
    const repliedSticker = repliedMessage?.stickers?.first() ?? message?.stickers?.first();

    await interaction.deferReply();

    if (repliedSticker) {
      const url = stickerUrl(repliedSticker);
      if (!url) {
        await interaction.editReply({ components: [textCard(t(lang, 'utility.steal.lottie'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
        return;
      }
      try {
        const created = await interaction.guild.stickers.create({ file: url, name: repliedSticker.name, tags: repliedSticker.tags ?? 'e', description: repliedSticker.description ?? '' });
        await interaction.editReply({ components: [textCard(t(lang, 'utility.steal.stickerAdded', { emoji: EMOJI.APPROVE, name: created.name }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
      } catch (err) {
        logger.error('Failed to steal sticker:', err);
        await interaction.editReply({ components: [textCard(t(lang, 'utility.steal.stickerFailed', { emoji: EMOJI.DENY, error: err.message }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      }
      return;
    }

    // The emojis typed after the command come first; with none typed, the ones of the message that is replied to (its text, its
    // embeds and its reactions).
    const typed = emojisInText(interaction.options.getString('emoji') ?? message?.content ?? '');
    const candidates = typed.length ? typed : emojisOfMessage(repliedMessage);
    const seen = new Set();
    const matches = candidates.filter((entry) => !seen.has(entry.id) && seen.add(entry.id));

    if (!matches.length) {
      await interaction.editReply({ components: [textCard(t(lang, 'utility.steal.nothing'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const results = [];
    for (const { animated, name, id } of matches.slice(0, MAX_EMOJIS)) {
      try {
        const created = await interaction.guild.emojis.create({ attachment: emojiUrl(id, Boolean(animated)), name });
        results.push(t(lang, 'utility.steal.added', { emoji: `${created}`, name: created.name }));
      } catch (err) {
        results.push(t(lang, 'utility.steal.failed', { name, error: err.message }));
      }
    }

    const more = matches.length > MAX_EMOJIS ? `\n${t(lang, 'utility.steal.more', { max: MAX_EMOJIS })}` : '';
    await interaction.editReply({ components: [textCard(`${t(lang, 'utility.steal.title', { count: results.length })}\n${results.join('\n')}${more}`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  },
};
