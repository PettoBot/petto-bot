// The emojis of a board: the main one and up to four more (a star board that also counts bananas). Compared without the variation selector.
const bare = (emoji) => String(emoji ?? '').replace(/\uFE0F/g, '');
const MAX_EMOJIS = 5;
const EMOJI_TOKEN = /<a?:\w+:\d+>|\p{Extended_Pictographic}(?:\u200d\p{Extended_Pictographic})*\uFE0F?|[\u{1F1E6}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3/gu;

/** `"⭐ 🍌 <:wow:123>"` (or run together) → the emojis in it, without repeats, at most five. */
function parseEmojiList(text) {
  const found = String(text ?? '').match(EMOJI_TOKEN) ?? [];
  return [...new Map(found.map((e) => [bare(e), e])).values()].slice(0, MAX_EMOJIS);
}

/** Every emoji a board counts: its main emoji first. */
function emojisOf(row) {
  return [row.emoji, ...(Array.isArray(row.extra_emojis) ? row.extra_emojis : [])].filter(Boolean);
}

module.exports = { bare, MAX_EMOJIS, parseEmojiList, emojisOf };
