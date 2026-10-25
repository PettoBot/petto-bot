// i18n-ignore-file: no text of its own, it only finds the emojis and stickers of a message and the address of their pictures
// The emojis and stickers of a message, shared by `!steal` and `!jumbo`.
const { StickerFormatType } = require('discord.js');

const EMOJI_RE = /<(a?):(\w+):(\d+)>/g;
const PICTOGRAPH_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}]/u;

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

/** The picture of a sticker, or null for a Lottie one (Discord has no picture of those). */
function stickerUrl(sticker) {
  if (sticker.format === StickerFormatType.Lottie) return null;
  const ext = sticker.format === StickerFormatType.GIF ? 'gif' : 'png';
  return `https://media.discordapp.net/stickers/${sticker.id}.${ext}`;
}

/** The first emoji that is not a custom one in a text, as a string with all its parts (skin, joins), or null. */
function unicodeEmojiIn(text) {
  const clean = String(text ?? '').replace(EMOJI_RE, ' ');
  const segments = typeof Intl?.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(clean)].map((s) => s.segment) : [...clean];
  return segments.find((piece) => PICTOGRAPH_RE.test(piece)) ?? null;
}

/** A picture of an ordinary emoji (Twemoji, 72 pixels, which is the biggest PNG it has). */
function unicodeEmojiUrl(emoji) {
  const points = [...emoji].map((char) => char.codePointAt(0).toString(16));
  const joined = points.includes('200d') ? points : points.filter((point) => point !== 'fe0f');
  return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${joined.join('-')}.png`;
}

module.exports = { emojisInText, emojisOfMessage, emojiUrl, stickerUrl, unicodeEmojiIn, unicodeEmojiUrl };
