const MAX_ENTRIES_PER_CHANNEL = 10;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const deleted = new Map();
const edited = new Map();
const known = new Map();
const MAX_KNOWN_MESSAGES = 5000;

function trim(list) {
  const cutoff = Date.now() - MAX_AGE_MS;
  return list.filter((entry) => entry.capturedAt >= cutoff).slice(0, MAX_ENTRIES_PER_CHANNEL);
}

function collectionValues(collection) {
  return collection ? [...collection.values()] : [];
}

function snapshotMessage(message) {
  return {
    id: message.id,
    channelId: message.channelId,
    author: {
      id: message.author?.id ?? null,
      tag: message.author?.tag ?? message.author?.username ?? 'Unknown user',
      name: message.member?.displayName ?? message.author?.globalName ?? message.author?.username ?? 'Unknown user',
      avatar: message.author?.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? null,
      bot: Boolean(message.author?.bot),
    },
    content: message.content ?? '',
    createdTimestamp: message.createdTimestamp ?? Date.now(),
    attachments: collectionValues(message.attachments).map((attachment) => ({
      name: attachment.name ?? 'Attachment',
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
    author: { ...previous.author, ...current.author, name: current.author.name === 'Unknown user' ? previous.author.name : current.author.name },
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

module.exports = { rememberKnown, rememberDeleted, rememberEdited, getDeleted, getEdited, snapshotMessage, MAX_ENTRIES_PER_CHANNEL };
