// i18n-ignore-file: internal names only; the texts the dashboard shows are in src/i18n (web.api.ticketLive.*).
// Live tickets on the dashboard. The dashboard's live tickets view asks the bot for the open tickets of a server (and the last messages of
// one); while someone looks at that view the server is "watched" for a while, and only then does the bot follow what happens in its
// tickets: a message in a ticket channel, a ticket opened, claimed or closed. Each of those sends one short signal on Redis
// (`petto:tk`, `<guildId>:<time>`), at most one every 1.5 seconds per server, and the website passes it to the open pages (their
// stream, `event: tk`), which read the list again at once. It is a channel of its own, not the dashboard's change stamp
// (`petto:ver`): a busy ticket would otherwise make every open page of the server read itself again. Without Redis nothing is sent and
// the view asks every few seconds instead.
//
// Servers nobody watches cost nothing: a message is looked at only when its server is watched, with lookups in memory.
const redis = require('./redis');
const logger = require('./logger');

const SIGNAL_CHANNEL = 'tk'; // petto:tk
const WATCH_MS = 90_000;
const SIGNAL_GAP_MS = 1_500;
// A channel this young that is not a known ticket yet may be a ticket being opened: its first message is a signal too.
const NEW_CHANNEL_MS = 60_000;
const LIMIT = 20_000;

/** @type {Map<string, number>} guild id -> watched until */
const watched = new Map();
/** @type {Map<string, { guildId: string, ticketId: string, openerId: string }>} channel id -> open ticket of a watched server */
const openChannels = new Map();
/** @type {Map<string, string>} ticket id -> guild id (a write to `tickets` names the ticket, not its server) */
const ticketGuilds = new Map();
/** @type {Map<string, { messageId: string, at: number, authorId: string, bot: boolean, staffReply?: boolean, staff?: boolean | null }>} */
const activity = new Map();
/** @type {Map<string, { last: number, timer: NodeJS.Timeout | null }>} */
const signals = new Map();
/** @type {Set<(guildId: string) => void>} */
const listeners = new Set();

function trim(map) {
  if (map.size <= LIMIT) return;
  for (const key of map.keys()) {
    map.delete(key);
    if (map.size <= LIMIT * 0.8) break;
  }
}

/**
 * The live view of a server is open: it is followed for the next 90 seconds, and its open tickets are remembered (their channels and ids).
 * @param {string} guildId
 * @param {Array<{ id: string | number, channel_id?: string | null, opener_id?: string, status?: string }> | null} tickets
 * @param {{ add?: boolean }} [options]
 */
function watch(guildId, tickets = null, { add = false } = {}, now = Date.now()) {
  const id = String(guildId);
  watched.set(id, now + WATCH_MS);
  trim(watched);
  if (!tickets) return;
  // The whole list of open tickets replaces what was known of this server; a single ticket (its messages are open) is added to it.
  if (!add) for (const [channelId, entry] of openChannels) if (entry.guildId === id) openChannels.delete(channelId);
  for (const ticket of tickets) {
    ticketGuilds.set(String(ticket.id), id);
    if (ticket.channel_id && (ticket.status ?? 'open') === 'open') openChannels.set(String(ticket.channel_id), { guildId: id, ticketId: String(ticket.id), openerId: String(ticket.opener_id ?? '') });
  }
  trim(ticketGuilds);
  trim(openChannels);
}

/** @param {string} guildId */
function isWatched(guildId, now = Date.now()) {
  const until = watched.get(String(guildId));
  if (until === undefined) return false;
  if (until > now) return true;
  watched.delete(String(guildId));
  return false;
}

/** Sends the signal of a server: now when the last one is old enough, otherwise once at the end of the gap (several become one). */
function signal(guildId, now = Date.now()) {
  const id = String(guildId);
  if (!isWatched(id, now)) return false;
  const state = signals.get(id) ?? { last: 0, timer: null };
  signals.set(id, state);
  trim(signals);
  if (state.timer) return true;
  const wait = Math.max(0, state.last + SIGNAL_GAP_MS - now);
  const send = () => {
    state.timer = null;
    state.last = Date.now();
    for (const listener of listeners) {
      try { listener(id); } catch { /* a listener never stops the others */ }
    }
    if (redis.enabled()) redis.publish(SIGNAL_CHANNEL, `${id}:${state.last}`).catch((error) => logger.debug?.(`[tickets] live signal of ${id} failed: ${error?.message ?? error}`));
  };
  if (!wait) send();
  else {
    state.timer = setTimeout(send, wait);
    state.timer.unref?.();
  }
  return true;
}

/**
 * The last message of a ticket channel, as the list shows it.
 * @param {string} channelId
 * @param {{ messageId: string, at: number, authorId: string, bot: boolean, staffReply?: boolean, staff?: boolean | null }} entry
 */
function recordActivity(channelId, entry) {
  activity.set(String(channelId), entry);
  trim(activity);
}

/** @param {string} channelId */
function lastActivity(channelId) {
  return activity.get(String(channelId)) ?? null;
}

/**
 * A message was sent somewhere. Followed only in a watched server: in a known ticket channel it is remembered as the ticket's last
 * message, in a channel made a moment ago it may be the first message of a new ticket. Either way the server gets its signal.
 * @param {any} message
 */
function noteMessage(message, now = Date.now()) {
  const guildId = message?.guild?.id ?? message?.guildId;
  if (!guildId || !isWatched(guildId, now)) return false;
  const channelId = String(message.channelId ?? message.channel?.id ?? '');
  const known = openChannels.get(channelId);
  if (known) {
    recordActivity(channelId, { messageId: String(message.id), at: Number(message.createdTimestamp) || now, authorId: String(message.author?.id ?? ''), bot: Boolean(message.author?.bot || message.webhookId), staff: null });
    return signal(guildId, now);
  }
  const created = Number(message.channel?.createdTimestamp ?? 0);
  if (created && now - created < NEW_CHANNEL_MS) return signal(guildId, now);
  return false;
}

/** A channel of a watched server was made or deleted (a ticket opened, or its channel removed). */
function noteChannel(channel, now = Date.now()) {
  const guildId = channel?.guild?.id ?? channel?.guildId;
  if (!guildId) return false;
  return signal(guildId, now);
}

/**
 * A write to the table `tickets` (see db/postgres.js): the server of the write, or of the ticket it names, gets its signal.
 * @param {{ filters?: Array<{ type: string, column: string, value: unknown }> }} query
 * @param {string | null} guildId
 */
function noteTicketWrite(query, guildId = null, now = Date.now()) {
  let id = guildId;
  if (!id) {
    const filter = (query?.filters ?? []).find((item) => item.type === 'eq' && item.column === 'id');
    id = filter ? ticketGuilds.get(String(filter.value)) ?? null : null;
  }
  return id ? signal(id, now) : false;
}

/** For the checks: hears every signal sent in this process. */
function onSignal(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function reset() {
  watched.clear(); openChannels.clear(); ticketGuilds.clear(); activity.clear();
  for (const state of signals.values()) if (state.timer) clearTimeout(state.timer);
  signals.clear();
}

// ── What a message looks like on the dashboard ─────────────────────────────────────────────────────────────────────────────────────

const TEXT_LIMIT = 2000;
const EMBED_TEXT_LIMIT = 300;

/** The text of a Components V2 message (its Text Display parts, also inside containers and sections), the buttons left out. */
function componentText(components, out = []) {
  for (const raw of components ?? []) {
    const part = typeof raw?.toJSON === 'function' ? raw.toJSON() : raw;
    if (!part || typeof part !== 'object') continue;
    if (part.type === 10 && typeof part.content === 'string') out.push(part.content);
    if (Array.isArray(part.components)) componentText(part.components, out);
    if (part.accessory) componentText([part.accessory], out);
  }
  return out;
}

const cut = (text, limit) => {
  const value = String(text ?? '');
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
};

/**
 * One message as the dashboard shows it: who wrote it (name and avatar), the text, the attachments as links, the embeds and the text of
 * a Components V2 card in short.
 * @param {any} message
 */
function summarizeMessage(message) {
  const author = message.author ?? {};
  const member = message.member ?? null;
  const name = member?.displayName ?? author.globalName ?? author.username ?? '?';
  const avatar = (typeof member?.displayAvatarURL === 'function' ? member.displayAvatarURL({ size: 64 }) : null)
    ?? (typeof author.displayAvatarURL === 'function' ? author.displayAvatarURL({ size: 64 }) : null);
  const attachments = [...(message.attachments?.values?.() ?? [])].slice(0, 10).map((file) => ({
    name: cut(file.name ?? 'file', 120),
    url: String(file.url ?? ''),
    size: Number(file.size) || 0,
    image: /^image\//.test(String(file.contentType ?? '')) || /\.(png|jpe?g|gif|webp)$/i.test(String(file.name ?? '')),
  })).filter((file) => /^https:\/\//.test(file.url));
  const embeds = (message.embeds ?? []).slice(0, 5).map((embed) => {
    const data = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed?.data ?? embed ?? {};
    return {
      title: cut(data.title ?? data.author?.name ?? '', 256),
      description: cut(data.description ?? '', EMBED_TEXT_LIMIT),
      color: typeof data.color === 'number' ? data.color : null,
      fields: Array.isArray(data.fields) ? data.fields.length : 0,
    };
  }).filter((embed) => embed.title || embed.description || embed.fields);
  const card = componentText(message.components).join('\n');
  const content = typeof message.cleanContent === 'string' && message.cleanContent ? message.cleanContent : String(message.content ?? '');
  return {
    id: String(message.id),
    author: { id: String(author.id ?? ''), name: cut(name, 80), avatar: avatar ?? null, bot: Boolean(author.bot || message.webhookId) },
    content: cut(content, TEXT_LIMIT),
    card: cut(card, 1000),
    attachments,
    embeds,
    stickers: [...(message.stickers?.values?.() ?? [])].slice(0, 3).map((sticker) => cut(sticker.name ?? '', 40)),
    createdAt: new Date(Number(message.createdTimestamp) || Date.now()).toISOString(),
    edited: Boolean(message.editedTimestamp),
  };
}

module.exports = {
  SIGNAL_CHANNEL, WATCH_MS, SIGNAL_GAP_MS,
  watch, isWatched, signal, noteMessage, noteChannel, noteTicketWrite, recordActivity, lastActivity, onSignal, reset,
  summarizeMessage, componentText,
};
