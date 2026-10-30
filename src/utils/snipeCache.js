// What /snipe can show: the last deleted and edited messages and removed reactions of a channel. Everything lives in memory only (nothing is
// saved anywhere, a restart empties it) and it is kept small on purpose:
//   - at most MAX_ENTRIES_PER_CHANNEL entries per channel and kind, none older than MAX_AGE_MS;
//   - at most MAX_CHANNELS channels per kind: the one that was written longest ago goes first (the maps are in order of use);
//   - only what is shown is stored (author id, name and avatar hash, the text clipped to CONTENT_LIMIT, the names and addresses of up to
//     MAX_ATTACHMENTS files, how many embeds), never the message itself;
//   - eviction happens when something is added (the oldest are looked at first), with no timer.
const MAX_ENTRIES_PER_CHANNEL = 10;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CHANNELS = 200;
const MAX_KNOWN_MESSAGES = 1500;
const CONTENT_LIMIT = 1000;
const MAX_ATTACHMENTS = 8;
const PREVIEW_LENGTH = 200;

const deleted = new Map(); // channelId -> entries, newest first
const edited = new Map();
const reactions = new Map();
const known = new Map(); // messageId -> { message, capturedAt }: what a deleted message looked like when it was written

const clip = (value, limit) => {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

function trim(list) {
  const cutoff = Date.now() - MAX_AGE_MS;
  return list.filter((entry) => entry.capturedAt >= cutoff).slice(0, MAX_ENTRIES_PER_CHANNEL);
}

/** Puts a channel's list last in its map (the most recently used), drops the expired ones from the front and the extra ones over the cap. */
function store(map, channelId, list) {
  map.delete(channelId);
  map.set(channelId, list);
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [id, entries] of map) {
    if (map.size <= MAX_CHANNELS && (entries[0]?.capturedAt ?? 0) >= cutoff) break;
    map.delete(id);
  }
}

/** The address of the avatar of a user from its hash (a user with no avatar of its own has none to show). */
function avatarUrl(user) {
  return user?.id && user?.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null;
}

// A name Discord did not give is kept as null: !snipe writes "Unknown user" in the server's language when it shows it.
function snapshotMessage(message) {
  const files = message.attachments ? [...message.attachments.values()].slice(0, MAX_ATTACHMENTS) : [];
  return {
    id: message.id,
    channelId: message.channelId,
    author: {
      id: message.author?.id ?? null,
      name: clip(message.member?.displayName ?? message.author?.globalName ?? message.author?.username ?? '', 80) || null,
      avatar: message.author?.avatar ?? null,
      bot: Boolean(message.author?.bot),
    },
    content: clip(message.content, CONTENT_LIMIT),
    createdTimestamp: message.createdTimestamp ?? Date.now(),
    attachments: files.filter((file) => file.url).map((file) => ({ name: file.name ? clip(file.name, 100) : null, url: file.url })),
    embedCount: message.embeds?.length ?? 0,
    capturedAt: Date.now(),
  };
}

function remember(map, message, extra = {}) {
  if (!message?.guild || !message.channelId) return;
  const entry = { ...extra, message: snapshotFor(message), capturedAt: Date.now() };
  store(map, message.channelId, trim([entry, ...(map.get(message.channelId) ?? [])]));
}

function rememberKnown(message) {
  if (!message?.guild || !message.channelId || !message.id) return;
  known.delete(message.id);
  known.set(message.id, { message: snapshotMessage(message), capturedAt: Date.now() });
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [id, entry] of known) {
    if (known.size <= MAX_KNOWN_MESSAGES && entry.capturedAt >= cutoff) break;
    known.delete(id);
  }
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
    embedCount: current.embedCount || previous.embedCount,
    author: { ...previous.author, ...current.author, name: current.author.name ?? previous.author.name, avatar: current.author.avatar ?? previous.author.avatar },
  };
}

function rememberDeleted(message) {
  remember(deleted, message);
}

function rememberEdited(oldMessage, newMessage) {
  if (!oldMessage?.guild || !newMessage?.guild || oldMessage.content === newMessage.content) return;
  rememberKnown(newMessage);
  remember(edited, newMessage, { before: clip(snapshotFor(oldMessage).content, CONTENT_LIMIT), after: clip(newMessage.content, CONTENT_LIMIT) });
}

// The last reactions taken off a message, per channel: the emoji, who took it off and a short look at the message.
function emojiOf(emoji) {
  if (!emoji || (!emoji.id && !emoji.name)) return null;
  const name = clip(emoji.name, 32);
  const display = emoji.id ? `<${emoji.animated ? 'a' : ''}:${name || 'emoji'}:${emoji.id}>` : name;
  return { id: emoji.id ?? null, name: name || null, animated: Boolean(emoji.animated), display, url: emoji.id ? `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}?size=96` : null };
}

/** A reaction taken off a message of a server, by a person. Does nothing for a bot, a direct message or an emoji Discord did not name. */
function rememberReactionRemoved(reaction, user) {
  const message = reaction?.message;
  if (!message?.guild || !message.channelId || !user || user.bot) return;
  const emoji = emojiOf(reaction.emoji);
  if (!emoji) return;
  const entry = {
    emoji,
    user: { id: user.id ?? null, name: clip(user.globalName ?? user.username ?? '', 80) || null, avatar: user.avatar ?? null },
    message: {
      id: message.id,
      channelId: message.channelId,
      url: message.id ? `https://discord.com/channels/${message.guild.id}/${message.channelId}/${message.id}` : null,
      authorName: clip(message.member?.displayName ?? message.author?.globalName ?? message.author?.username ?? '', 80) || null,
      preview: typeof message.content === 'string' ? message.content.slice(0, PREVIEW_LENGTH) : '',
    },
    capturedAt: Date.now(),
  };
  store(reactions, message.channelId, trim([entry, ...(reactions.get(message.channelId) ?? [])]));
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
  if (list.length) store(map, channelId, list); // looked at: it counts as used
  else map.delete(channelId);
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

/** The sizes of everything kept (for the memory check). */
function stats() {
  const entries = (map) => [...map.values()].reduce((total, list) => total + list.length, 0);
  return {
    channels: { deleted: deleted.size, edited: edited.size, reactions: reactions.size },
    entries: { deleted: entries(deleted), edited: entries(edited), reactions: entries(reactions) },
    known: known.size,
  };
}

module.exports = {
  rememberKnown, rememberDeleted, rememberEdited, rememberReactionRemoved, getDeleted, getEdited, getReaction, clearChannel, countFor, stats, avatarUrl, snapshotMessage,
  MAX_ENTRIES_PER_CHANNEL, MAX_CHANNELS, MAX_KNOWN_MESSAGES, MAX_AGE_MS, CONTENT_LIMIT, MAX_ATTACHMENTS,
};
