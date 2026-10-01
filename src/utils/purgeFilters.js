// Which messages a `purge` removes. Kept free of Discord and database imports so scripts/check-purge.js can run it alone.

const LINK_RE = /(?:https?:\/\/|www\.)\S+/i;
const INVITE_RE = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/\S+/i;
const IMAGE_RE = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i;

const PURGE_FILTERS = ['all', 'bots', 'humans', 'links', 'invites', 'attachments', 'images', 'embeds', 'mentions'];

function hasImage(message) {
  for (const attachment of message.attachments?.values?.() ?? []) {
    if (attachment.contentType?.startsWith('image/') || IMAGE_RE.test(attachment.url ?? '')) return true;
  }
  return (message.embeds ?? []).some((embed) => embed.type === 'image' || Boolean(embed.image) || Boolean(embed.thumbnail));
}

function hasMention(message) {
  const mentions = message.mentions;
  if (!mentions) return false;
  return Boolean(mentions.everyone) || (mentions.users?.size ?? 0) > 0 || (mentions.roles?.size ?? 0) > 0;
}

const FILTER_TESTS = {
  all: () => true,
  bots: (message) => Boolean(message.author?.bot),
  humans: (message) => !message.author?.bot,
  links: (message) => LINK_RE.test(message.content ?? ''),
  invites: (message) => INVITE_RE.test(message.content ?? ''),
  attachments: (message) => (message.attachments?.size ?? 0) > 0,
  images: hasImage,
  embeds: (message) => (message.embeds?.length ?? 0) > 0,
  mentions: hasMention,
};

/**
 * Whether a message is removed by a purge. Every condition that was given has to match: the member, the filter
 * and the text. Pinned messages are never removed (`includePinned` only exists to count the ones that were kept).
 */
function matchesPurge(message, { userId = null, filter = 'all', text = null, includePinned = false } = {}) {
  if (message.pinned && !includePinned) return false;
  if (userId && message.author?.id !== userId) return false;
  const test = FILTER_TESTS[filter] ?? FILTER_TESTS.all;
  if (!test(message)) return false;
  if (text && !(message.content ?? '').toLowerCase().includes(text.toLowerCase())) return false;
  return true;
}

module.exports = { PURGE_FILTERS, matchesPurge };
