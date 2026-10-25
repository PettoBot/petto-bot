const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StickerFormatType } = require('discord.js');
const { infoPayload, noticePayload, stamp, snowflakeTime } = require('../../utils/infoCard');
const { emojisInText, emojisOfMessage, emojiUrl, stickerUrl, unicodeEmojiIn, unicodeEmojiUrl } = require('../../utils/expressions');
const { EMOJI } = require('../../utils/emojis');
const { STEAL_PREFIX } = require('../../interactions/jumbo');
const { t, languageOf } = require('../../i18n');

const row = (label, value) => `${EMOJI.FIELD_DOT} **${label}** ${value}`;

module.exports = {
  // A prefix command (`!jumbo`): it reads the message it replies to, which a real slash command cannot.
  aliases: ['bigemoji', 'enlarge'],
  data: new SlashCommandBuilder()
    .setName('jumbo')
    .setDescription('Shows an emoji or a sticker big, and lets you steal it for this server.')
    .addStringOption((o) => o.setName('emoji').setDescription('An emoji (or reply to a message with an emoji or a sticker instead)').setRequired(false)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const message = interaction.rawMessage;
    const repliedMessage = message?.reference ? await message.fetchReference().catch(() => null) : null;
    const typed = interaction.options.getString('emoji') ?? '';
    const sticker = repliedMessage?.stickers?.first() ?? message?.stickers?.first() ?? null;

    let found = null;
    let more = 0;
    if (sticker && !typed.trim()) {
      found = { kind: 'sticker', id: sticker.id, name: sticker.name, url: stickerUrl(sticker), animated: sticker.format === StickerFormatType.GIF, lottie: sticker.format === StickerFormatType.Lottie, here: interaction.guild?.stickers.cache.has(sticker.id) };
    } else {
      const customs = emojisInText(typed);
      const fromReply = customs.length ? [] : emojisOfMessage(repliedMessage);
      const list = [...new Map([...customs, ...fromReply].map((entry) => [entry.id, entry])).values()];
      if (list.length) {
        const [first] = list;
        more = list.length - 1;
        found = { kind: 'emoji', id: first.id, name: first.name, url: emojiUrl(first.id, first.animated), animated: first.animated, here: interaction.guild?.emojis.cache.has(first.id) };
      } else {
        const plain = unicodeEmojiIn(typed) ?? (typed.trim() ? null : unicodeEmojiIn(repliedMessage?.content));
        if (plain) found = { kind: 'unicode', name: plain, url: unicodeEmojiUrl(plain) };
      }
    }

    if (!found) {
      await interaction.reply(noticePayload(t(lang, 'utility.jumbo.nothing'), 0xfe6465));
      return;
    }
    if (found.lottie) {
      await interaction.reply(noticePayload(t(lang, 'utility.jumbo.lottie', { name: found.name }), 0xfe6465));
      return;
    }

    const kind = found.kind === 'unicode' ? 'unicode' : `${found.kind}${found.animated ? 'Moving' : 'Still'}`;
    const lines = [row(t(lang, 'utility.jumbo.kind'), t(lang, `utility.jumbo.kind.${kind}`))];
    if (found.kind !== 'unicode') {
      lines.unshift(row(t(lang, 'utility.jumbo.name'), `\`${found.name}\``));
      lines.push(row(t(lang, 'utility.jumbo.created'), stamp(snowflakeTime(found.id))));
    }
    if (more > 0) lines.push(`-# ${t(lang, 'utility.jumbo.more', { count: more })}`);

    const buttons = [{ label: t(lang, 'utility.jumbo.open'), url: found.url }];
    const rows = [];
    // The steal button is only for a custom one that this server does not have yet.
    if (interaction.guild && found.kind !== 'unicode' && !found.here) {
      const id = found.kind === 'sticker' ? `${STEAL_PREFIX}:s:${found.id}` : `${STEAL_PREFIX}:e:${found.id}:${found.animated ? 'a' : 's'}:${found.name}`;
      rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(id.slice(0, 100)).setLabel(t(lang, 'utility.jumbo.steal')).setStyle(ButtonStyle.Success)));
    }

    await interaction.reply(infoPayload({
      accent: null,
      title: found.kind === 'unicode' ? found.name : found.kind === 'sticker' ? found.name : `:${found.name}:`,
      banner: found.url,
      sections: [{ lines }],
      footer: found.kind === 'unicode' ? t(lang, 'utility.jumbo.unicodeNote') : t(lang, 'info.card.id', { id: found.id }),
      rows,
      buttons,
    }));
  },
};

