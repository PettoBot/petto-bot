const MAX_ENTRIES_PER_CHANNEL = 10;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const deleted = new Map();
const edited = new Map();
const reactions = new Map();
const known = new Map();
const MAX_KNOWN_MESSAGES = 5000;

function trim(list) {
  const cutoff = Date.now() - MAX_AGE_MS;
  return list.filter((entry) => entry.capturedAt >= cutoff).slice(0, MAX_ENTRIES_PER_CHANNEL);
}

function collectionValues(collection) {
  return collection ? [...collection.values()] : [];
}

// A name Discord did not give is kept as null: !snipe writes "Unknown user" in the server's language when it shows it.
function snapshotMessage(message) {
  return {
    id: message.id,
    channelId: message.channelId,
    author: {
      id: message.author?.id ?? null,
      tag: message.author?.tag ?? message.author?.username ?? null,
      name: message.member?.displayName ?? message.author?.globalName ?? message.author?.username ?? null,
      avatar: message.author?.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? null,
      bot: Boolean(message.author?.bot),
    },
    content: message.content ?? '',
    createdTimestamp: message.createdTimestamp ?? Date.now(),
    attachments: collectionValues(message.attachments).map((attachment) => ({
      name: attachment.name ?? null,
      url: attachment.url,
      contentType: attachment.contentType ?? '',
    })),
    embeds: (message.embeds ?? []).slice(0, 10).map((embed) => (typeof embed.toJSON === 'function' ? embed.toJSON() : embed)),
    capturedAt: Date.now(),
  };
}

function remember(map, message, extra = {}) {
  if (!message?.guild || !message.channelId) return;
  const entry = { ...extra, message: snapshotFor(message), capturedAt: Date.now() };
  map.set(message.channelId, trim([entry, ...(map.get(message.channelId) ?? [])]));
}

function rememberKnown(message) {
  if (!message?.guild || !message.channelId || !message.id) return;
  known.set(message.id, { message: snapshotMessage(message), capturedAt: Date.now() });
  while (known.size > MAX_KNOWN_MESSAGES) known.delete(known.keys().next().value);
}

function snapshotFor(message) {
  const current = snapshotMessage(message);
  const previous = known.get(message.id)?.message;
  if (!previous) return current;

  return {
    ...previous,
    ...current,
    content: current.content || previous.content,
    attachments: current.attachments.length ? current.attachments : previous.attachments,
    embeds: current.embeds.length ? current.embeds : previous.embeds,
    author: { ...previous.author, ...current.author, name: current.author.name ?? previous.author.name },
  };
}

function rememberDeleted(message) {
  remember(deleted, message);
}

function rememberEdited(oldMessage, newMessage) {
  if (!oldMessage?.guild || !newMessage?.guild || oldMessage.content === newMessage.content) return;
  rememberKnown(newMessage);
  remember(edited, newMessage, { before: snapshotFor(oldMessage).content ?? '', after: newMessage.content ?? '' });
}

// The last reactions taken off a message, per channel. Only the emoji, who took it off and a short look at the message are kept, and
// only in memory like the rest (nothing here is saved; a restart empties it).
const PREVIEW_LENGTH = 200;

function emojiOf(emoji) {
  if (!emoji || (!emoji.id && !emoji.name)) return null;
  const display = emoji.id ? `<${emoji.animated ? 'a' : ''}:${emoji.name ?? 'emoji'}:${emoji.id}>` : emoji.name;
  return { id: emoji.id ?? null, name: emoji.name ?? null, animated: Boolean(emoji.animated), display, url: emoji.id ? `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}?size=96` : null };
}

/** A reaction taken off a message of a server, by a person. Does nothing for a bot, a direct message or an emoji Discord did not name. */
function rememberReactionRemoved(reaction, user) {
  const message = reaction?.message;
  if (!message?.guild || !message.channelId || !user || user.bot) return;
  const emoji = emojiOf(reaction.emoji);
  if (!emoji) return;
  const entry = {
    emoji,
    user: { id: user.id ?? null, name: user.globalName ?? user.username ?? null, tag: user.tag ?? user.username ?? null, avatar: user.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? null },
    message: {
      id: message.id,
      channelId: message.channelId,
      guildId: message.guild.id,
      url: message.id ? `https://discord.com/channels/${message.guild.id}/${message.channelId}/${message.id}` : null,
      authorName: message.member?.displayName ?? message.author?.globalName ?? message.author?.username ?? null,
      preview: typeof message.content === 'string' ? message.content.slice(0, PREVIEW_LENGTH) : '',
    },
    capturedAt: Date.now(),
  };
  reactions.set(message.channelId, trim([entry, ...(reactions.get(message.channelId) ?? [])]));
}

/** Empties what is kept for a channel: `what` is `deleted`, `edited`, `reactions` or `all`. Returns how many entries went. */
function clearChannel(channelId, what = 'all') {
  const lists = { deleted, edited, reactions };
  const names = what === 'all' ? Object.keys(lists) : [what];
  let removed = 0;
  for (const name of names) {
    const map = lists[name];
    if (!map) continue;
    removed += trim(map.get(channelId) ?? []).length;
    map.delete(channelId);
  }
  return removed;
}

function get(map, channelId, index = 1) {
  const list = trim(map.get(channelId) ?? []);
  map.set(channelId, list);
  return list[Math.max(1, Number(index) || 1) - 1] ?? null;
}

function getDeleted(channelId, index) {
  return get(deleted, channelId, index);
}

function getEdited(channelId, index) {
  return get(edited, channelId, index);
}

function getReaction(channelId, index) {
  return get(reactions, channelId, index);
}

/** How many entries are kept for a channel, by kind (for `!snipe clear` and the checks). */
function countFor(channelId) {
  return { deleted: trim(deleted.get(channelId) ?? []).length, edited: trim(edited.get(channelId) ?? []).length, reactions: trim(reactions.get(channelId) ?? []).length };
}

module.exports = { rememberKnown, rememberDeleted, rememberEdited, rememberReactionRemoved, getDeleted, getEdited, getReaction, clearChannel, countFor, snapshotMessage, MAX_ENTRIES_PER_CHANNEL };
