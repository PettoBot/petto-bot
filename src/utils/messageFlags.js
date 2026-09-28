// Small inline-flag DSL for message text fields (welcome/leave/boost/autoresponder/etc), ported
// from bli's {flag:value} convention. Only {reactreply:emoji} is implemented for now — the rest
// of bli's flag set ({dm}, {sendto:}, {delete_reply:N}...) can be added the same way later.

/** Pulls every {reactreply:emoji} tag out of `text`, returning the cleaned text plus the emoji list. */
function extractReactReplies(text) {
  const emojis = [];
  const stripped = text.replace(/\{reactreply:([^}]+)\}/gi, (_, raw) => {
    emojis.push(raw.trim());
    return '';
  });
  return { text: stripped.trim(), emojis };
}

/** Removes response flags from every string in a saved embed template while collecting them. */
function extractReactRepliesFromTemplate(value, emojis = []) {
  if (typeof value === 'string') {
    const stripped = value.replace(/\{reactreply:([^}]+)\}/gi, (_, raw) => {
      emojis.push(raw.trim());
      return '';
    });
    return stripped.trim();
  }
  if (Array.isArray(value)) return value.map((item) => extractReactRepliesFromTemplate(item, emojis));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, extractReactRepliesFromTemplate(item, emojis)]));
  }
  return value;
}

/** Reacts to `message` with each emoji in order, best-effort (a bad/unknown emoji shouldn't block the rest). */
async function applyReactReplies(message, emojis) {
  for (const emoji of emojis) {
    await message.react(emoji).catch(() => {});
  }
}

module.exports = { extractReactReplies, extractReactRepliesFromTemplate, applyReactReplies };
