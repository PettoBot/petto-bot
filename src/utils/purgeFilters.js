// Which messages a `purge` removes. Kept free of Discord and database imports so scripts/check-purge.js can run it alone.

const LINK_RE = /(?:https?:\/\/|www\.)\S+/i;
const INVITE_RE = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/\S+/i;
const IMAGE_RE = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i;

const CUSTOM_EMOJI_RE = /<a?:\w{2,32}:\d{15,25}>/;
// A Unicode emoji (pictographs, flags, keycaps), for the `emojis` filter together with the custom ones.
const UNICODE_EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3/u;
const SNOWFLAKE_RE = /^\d{15,25}$/;
const MESSAGE_LINK_RE = /channels\/(?:\d+|@me)\/\d+\/(\d{15,25})/;

// The reactions filter does not delete messages: it removes the reactions of the ones it finds.
const PURGE_FILTERS = ['all', 'bots', 'humans', 'links', 'invites', 'attachments', 'images', 'embeds', 'mentions', 'webhooks', 'stickers', 'emojis', 'reactions'];

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
  webhooks: (message) => Boolean(message.webhookId),
  stickers: (message) => (message.stickers?.size ?? 0) > 0,
  emojis: (message) => CUSTOM_EMOJI_RE.test(message.content ?? '') || UNICODE_EMOJI_RE.test(message.content ?? ''),
  reactions: (message) => (message.reactions?.cache?.size ?? 0) > 0,
};

/** The id of a message written as an id or a message link, or null. */
function messageIdOf(input) {
  const text = String(input ?? '').trim();
  if (SNOWFLAKE_RE.test(text)) return text;
  return MESSAGE_LINK_RE.exec(text)?.[1] ?? null;
}

const newer = (a, b) => BigInt(a) > BigInt(b);

/**
 * Whether a message is removed by a purge. Every condition that was given has to match: the member, the filter
 * and the text. Pinned messages are never removed (`includePinned` only exists to count the ones that were kept).
 */
function matchesPurge(message, { userId = null, filter = 'all', text = null, startsWith = null, endsWith = null, beforeId = null, afterId = null, includePinned = false } = {}) {
  if (message.pinned && !includePinned) return false;
  if (userId && message.author?.id !== userId) return false;
  const test = FILTER_TESTS[filter] ?? FILTER_TESTS.all;
  if (!test(message)) return false;
  const content = (message.content ?? '').toLowerCase();
  if (text && !content.includes(text.toLowerCase())) return false;
  if (startsWith && !content.startsWith(startsWith.toLowerCase())) return false;
  if (endsWith && !content.trimEnd().endsWith(endsWith.toLowerCase())) return false;
  if (beforeId && message.id && !newer(beforeId, message.id)) return false;
  if (afterId && message.id && !newer(message.id, afterId)) return false;
  return true;
}

// The short words people type for each filter (!purge bots 50, !purge files...).
const FILTER_WORDS = {
  bot: 'bots', bots: 'bots', human: 'humans', humans: 'humans', link: 'links', links: 'links', invite: 'invites', invites: 'invites',
  file: 'attachments', files: 'attachments', attachment: 'attachments', attachments: 'attachments', image: 'images', images: 'images',
  embed: 'embeds', embeds: 'embeds', mention: 'mentions', mentions: 'mentions', webhook: 'webhooks', webhooks: 'webhooks',
  sticker: 'stickers', stickers: 'stickers', emoji: 'emojis', emojis: 'emojis', emote: 'emojis', emotes: 'emojis',
  reaction: 'reactions', reactions: 'reactions',
};
// A member written as a mention, an ID or @name.
const USER_TOKEN_RE = /^(<@!?\d+>|\d{15,25}|@\S+)$/;
const TEXT_WORDS = { contains: 'text', startswith: 'starts_with', endswith: 'ends_with' };

function tokens(text) {
  const found = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g; // i18n-ignore: the quotes of a tokenizer, no text
  let match;
  while ((match = re.exec(text))) found.push(match[1] ?? match[2] ?? match[3]);
  return found;
}
const DOUBLE_QUOTE = String.fromCharCode(34);
const quote = (value) => DOUBLE_QUOTE + String(value).split(DOUBLE_QUOTE).join('') + DOUBLE_QUOTE;

/**
 * The shorter ways of writing !purge, turned into its usual form (<amount> [user] --filter ... --text ...):
 * purge bots 50, purge @user 20, purge contains free nitro, purge startswith !, purge before <link>,
 * purge after <link> (also upto), purge between <first> <last>. Anything else is left as it was written.
 */
function purgePrefixArgs(argText) {
  const list = tokens(argText);
  const first = list[0]?.toLowerCase();
  if (!first) return argText;
  if (FILTER_WORDS[first]) return ['--filter', FILTER_WORDS[first], ...list.slice(1).map((token) => (/\s/.test(token) ? quote(token) : token))].join(' ');
  if (TEXT_WORDS[first]) {
    const rest = list.slice(1);
    if (!rest.length) return argText;
    return ['--' + TEXT_WORDS[first], quote(rest.join(' '))].join(' ');
  }
  if ((first === 'before' || first === 'after' || first === 'upto') && list[1]) {
    return [first === 'before' ? '--before' : '--after', list[1], ...list.slice(2)].join(' ');
  }
  if ((first === 'between' || first === 'bt') && list[1] && list[2]) {
    const [a, b] = [messageIdOf(list[1]), messageIdOf(list[2])];
    if (!a || !b) return argText;
    const [older, later] = newer(a, b) ? [b, a] : [a, b];
    // Both ends are deleted too: the ids are moved one step outwards.
    return ['--after', (BigInt(older) - 1n).toString(), '--before', (BigInt(later) + 1n).toString(), ...list.slice(3)].join(' ');
  }
  // purge @user 20: the amount goes first, as the command reads it.
  if (USER_TOKEN_RE.test(list[0]) && /^\d{1,3}$/.test(list[1] ?? '')) return purgePrefixArgs([list[1], list[0], ...list.slice(2)].map((token) => (/\s/.test(token) ? quote(token) : token)).join(' '));
  // purge 50 [member] [kind] [words...]: whatever is left after the member and the kind is the text to look for.
  if (/^\d{1,3}$/.test(list[0]) && !list.some((token) => token.startsWith('--'))) {
    const out = [list[0]];
    let index = 1;
    if (list[index] && USER_TOKEN_RE.test(list[index])) out.push(list[index++]);
    if (list[index] && FILTER_WORDS[list[index].toLowerCase()]) out.push('--filter', FILTER_WORDS[list[index++].toLowerCase()]);
    if (index < list.length) out.push('--text', quote(list.slice(index).join(' ')));
    return out.join(' ');
  }
  return argText;
}

module.exports = { PURGE_FILTERS, matchesPurge, messageIdOf, purgePrefixArgs, FILTER_WORDS };
