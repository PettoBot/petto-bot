// A sender's own text above a saved embed (a timer's message over its embed). A Components V2 message cannot have `content`: Discord
// refuses the whole message, so the text goes in as the first text component instead.

const IS_V2 = 1 << 15; // MessageFlags.IsComponentsV2
const MAX_V2_COMPONENTS = 40;

/** Every component of a V2 message, nested ones and accessories too (Discord counts them all, at most 40). */
function countComponents(list) {
  return (Array.isArray(list) ? list : []).reduce((sum, node) => sum + 1 + countComponents(node?.components) + (node?.accessory ? 1 : 0), 0);
}

/** True when a text says something (a letter, a number, an emoji or a mention), not only punctuation such as "." or ",". */
function isRealText(text) {
  return /[\p{L}\p{N}\p{Extended_Pictographic}]|<[@#:a]/u.test(String(text ?? ''));
}

/**
 * `payload` (from templatePayload, without `reactions`) with `text` above it. A V2 design never keeps `content`: the text becomes its first
 * text component when it says something and there is room. A classic message keeps the embed's own text, or takes this one.
 */
function withLeadingText(payload, text) {
  if (!payload) return payload;
  const words = String(text ?? '').trim();
  if (!(Number(payload.flags ?? 0) & IS_V2)) return { ...payload, content: payload.content || words || undefined };
  const { content: ignored, ...rest } = payload;
  void ignored;
  const components = rest.components ?? [];
  if (!isRealText(words) || countComponents(components) >= MAX_V2_COMPONENTS) return { ...rest, components };
  return { ...rest, components: [{ type: 10, content: words.slice(0, 4000) }, ...components] };
}

module.exports = { withLeadingText, isRealText, countComponents };
