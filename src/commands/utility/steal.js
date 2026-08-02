const { SlashCommandBuilder, PermissionFlagsBits, StickerFormatType, MessageFlags } = require('discord.js');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');

const EMOJI_RE = /<(a?):(\w+):(\d+)>/g;

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
    .addStringOption((o) => o.setName('emoji').setDescription('A custom emoji to steal (or reply to a message with a sticker instead)').setRequired(false)),

  async execute(interaction) {
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
      await interaction.reply({ content: 'I need the **Manage Expressions** permission to add emojis/stickers.', flags: MessageFlags.Ephemeral });
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
        await interaction.editReply({ components: [textCard('Lottie stickers cannot be stolen.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
        return;
      }
      try {
        const created = await interaction.guild.stickers.create({ file: url, name: repliedSticker.name, tags: repliedSticker.tags ?? 'e', description: repliedSticker.description ?? '' });
        await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Sticker **${created.name}** added!`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
      } catch (err) {
        logger.error('Failed to steal sticker:', err);
        await interaction.editReply({ components: [textCard(`${EMOJI.DENY}  Failed to steal sticker: ${err.message}`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      }
      return;
    }

    const searchText = interaction.options.getString('emoji') ?? message?.content ?? '';
    const matches = [...searchText.matchAll(EMOJI_RE)];

    if (!matches.length) {
      await interaction.editReply({ components: [textCard('Provide a custom emoji to steal, or reply to a message that has a sticker.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const results = [];
    for (const match of matches) {
      const [, animated, name, id] = match;
      try {
        const created = await interaction.guild.emojis.create({ attachment: emojiUrl(id, Boolean(animated)), name });
        results.push(`${created} \`:${created.name}:\` — added`);
      } catch (err) {
        results.push(`\`:${name}:\` — failed (${err.message})`);
      }
    }

    await interaction.editReply({ components: [textCard(`**Steal — ${results.length} emoji(s):**\n${results.join('\n')}`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  },
};
