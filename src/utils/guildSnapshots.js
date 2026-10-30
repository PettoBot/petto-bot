const crypto = require('node:crypto');
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const config = require('../config');
const logger = require('./logger');
const { forEachWithConcurrency } = require('./concurrency');
const snapshotsDb = require('../db/guildSnapshots');
const redis = require('./redis');

const FETCH_ME_MS = 4_000; // the bot's own member is asked from Discord for at most this long
const ME_CHECK_MS = 3_600_000; // a server where the bot cannot post somewhere has the roles of the bot checked against Discord at most this often
const MISSING_SHOWN = 3; // channels named in the line of the log, the rest is counted
const LOG_EVERY_MS = 3_600_000; // the line about the channels the bot cannot post in is said again for a server at most this often
const LOG_MIN_CHANGE = 10; // ... and only when this many channels (or LOG_MIN_PERCENT of the ones last said, if that is more) were closed or opened since it was said
const LOG_MIN_PERCENT = 10;
// Forum and media channels are not posted in like a text channel (a post starts a thread): the answer there is "unknown", never "cannot".
const NOT_POSTABLE_TYPES = new Set([ChannelType.GuildForum, ChannelType.GuildMedia, ChannelType.GuildDirectory, ChannelType.GuildCategory]);
const permissionName = (flag) => Object.entries(PermissionFlagsBits).find(([, value]) => value === flag)?.[0] ?? String(flag);

/**
 * What the bot needs to post in a channel: see it and write in it (`SendMessages`, which is also what the text chat of a voice or stage channel asks for;
 * a thread asks for `SendMessagesInThreads`). null for a channel that is not one to post in (a category, a forum, a media channel, a DM).
 */
function postPermissionsFor(channel) {
  if (!channel?.isTextBased?.() || channel.isDMBased?.() || NOT_POSTABLE_TYPES.has(channel.type)) return null;
  return [PermissionFlagsBits.ViewChannel, channel.isThread?.() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages];
}

/**
 * Whether the bot (`me`, its member) can see a channel and post in it: `{ send, view, missing }`. `true` or `false` only when it is known: a bot that is
 * not loaded (`me` is null), a channel that is not one to post in and a channel whose permissions cannot be computed are `null`, never `false`, because
 * the dashboard marks a `false` as "Petto cannot post here". A bot with the Administrator permission can see and post everywhere (it ignores overwrites).
 * `missing` is the first permission the bot lacks, for the log.
 */
function botAccess(channel, me) {
  const needs = postPermissionsFor(channel);
  if (!needs || !me) return { send: null, view: null, missing: null };
  if (me.permissions?.has?.(PermissionFlagsBits.Administrator)) return { send: true, view: true, missing: null };
  const permissions = channel.permissionsFor?.(me);
  if (!permissions?.has) return { send: null, view: null, missing: null };
  if (permissions.has(PermissionFlagsBits.Administrator)) return { send: true, view: true, missing: null };
  const missing = needs.find((flag) => !permissions.has(flag));
  return { send: missing === undefined, view: permissions.has(PermissionFlagsBits.ViewChannel), missing: missing === undefined ? null : permissionName(missing) };
}
const DEBOUNCE_MS = 3_000;
const SYNC_CONCURRENCY = 4;
// The dashboard reads a server from Redis first (`petto:snap:<id>`, the same row as the table) and hears on `petto:snap` when one
// changes. Ten minutes, like the full pass that writes it again. Without Redis it reads the table, as before.
const SNAPSHOT_TTL_MS = 600_000;
const SNAPSHOT_CHANNEL = 'snap'; // petto:snap
const GUILDS_CHANNEL = 'guilds'; // petto:guilds, a server was added or removed
const snapshotKey = (guildId) => `snap:${guildId}`;

/**
 * The saved copy of one server, with channels and roles shaped like Discord's REST answers (the dashboard reads them as such), and its emojis. `notes`, when
 * given, receives `{ id, name, missing }` for each channel the bot cannot post in, so the log can say why.
 */
function buildSnapshot(guild, { notes = null } = {}) {
  const me = guild.members?.me ?? null;
  const channels = [...guild.channels.cache.values()]
    .filter((channel) => !channel.isThread?.())
    .map((channel) => {
      const access = botAccess(channel, me);
      if (access.send === false) notes?.push({ id: String(channel.id), name: channel.name, missing: access.missing });
      return {
        id: String(channel.id),
        name: channel.name,
        type: channel.type,
        position: channel.rawPosition ?? channel.position ?? 0,
        parent_id: channel.parentId ?? null,
        topic: channel.topic ?? null,
        nsfw: Boolean(channel.nsfw),
        // Whether the bot can see the channel and write in it: the dashboard says so where a channel is picked for something the bot posts (the feeds).
        // null is "not known" (the bot's member is not loaded, a forum): the dashboard treats anything but false as postable.
        bot_can_send: access.send,
        // Whether it can see the channel at all, so the dashboard can say "cannot see" apart from "cannot write".
        bot_can_view: access.view,
      };
    });
  const roles = [...guild.roles.cache.values()].map((role) => ({
    id: String(role.id),
    name: role.name,
    color: role.color ?? 0,
    position: role.rawPosition ?? role.position ?? 0,
    managed: Boolean(role.managed),
    permissions: String(role.permissions?.bitfield ?? 0n),
    icon: role.icon ?? null,
    hoist: Boolean(role.hoist),
    mentionable: Boolean(role.mentionable),
    // The roles the bot itself has, so the dashboard can tell which roles it can hand out (the ones below its highest role).
    mine: Boolean(guild.members?.me?.roles?.cache?.has(role.id)),
  }));
  // The emoji pickers of the dashboard read these instead of asking Discord for the list.
  const emojis = [...(guild.emojis?.cache?.values?.() ?? [])].map((emoji) => ({
    id: String(emoji.id),
    name: emoji.name ?? null,
    animated: Boolean(emoji.animated),
  }));
  return {
    guild_id: String(guild.id),
    name: guild.name,
    icon: guild.icon ?? null,
    owner_id: guild.ownerId ?? null,
    member_count: Number.isFinite(guild.memberCount) ? guild.memberCount : null,
    banner: guild.banner ?? null,
    emoji_count: guild.emojis?.cache?.size ?? 0,
    premium_tier: Number(guild.premiumTier ?? 0),
    boost_count: guild.premiumSubscriptionCount ?? 0,
    bot_nick: guild.members?.me?.nickname ?? null,
    bot_avatar: guild.members?.me?.avatar ?? null,
    channels,
    roles,
    emojis,
  };
}

const lastSaved = new Map(); // guild id -> { hash, updatedAt } of the last save
const timers = new Map();

/** Writes the Redis copy of a saved row and, when it changed, says so on `petto:snap`. Without Redis this does nothing. */
async function shareSnapshot(row, { announce }) {
  const stored = await redis.setJson(snapshotKey(row.guild_id), row, SNAPSHOT_TTL_MS);
  if (stored && announce) await redis.publish(SNAPSHOT_CHANNEL, row.guild_id);
}

/** The bot's own member of a server, loaded from Discord when it is not in memory (or `force`d: its roles are read again). Null when it cannot be had in a few seconds. */
async function loadBotMember(guild, { force = false } = {}) {
  const cached = guild.members?.me ?? null;
  if ((cached && !force) || typeof guild.members?.fetchMe !== 'function') return cached;
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${FETCH_ME_MS / 1000} seconds`)), FETCH_ME_MS); }); // i18n-ignore: a line of the log
    timer.unref?.();
    return (await Promise.race([guild.members.fetchMe(force ? { force: true } : undefined), timeout])) ?? guild.members.me ?? null;
  } catch (error) {
    logger.warn(`[snapshots] could not load the bot's member of ${guild.id}: ${error.message}`); // i18n-ignore: a line of the log
    return guild.members?.me ?? cached;
  } finally {
    clearTimeout(timer);
  }
}

const memberCheckedAt = new Map(); // guild id -> when the roles of the bot were last read from Discord because a channel was closed to it
const lastClosed = new Map(); // guild id -> { at, closed: Map(channel id -> missing permission) } as the log last said it

/** How many channels differ between two sets of closed channels: opened, closed, or closed for another permission. */
function closedChange(before, now) {
  let changed = 0;
  for (const [id, missing] of now) if (before.get(id) !== missing) changed += 1;
  for (const id of before.keys()) if (!now.has(id)) changed += 1;
  return changed;
}

/**
 * One line of the log about the channels the bot cannot post in: how many, the first few with the permission each lacks, and "and N more". A server with
 * private channels hidden from the bot has hundreds of them, so the line is short, it is said the first time the server is looked at, and after that only
 * when the set changed by at least 10 channels or 10 percent (whichever is more) since it was last said, and never more than once an hour for a server.
 * The set last said is kept until then, so many small changes add up to one line instead of being forgotten.
 */
function logClosedChannels(guild, notes) {
  const id = String(guild.id);
  const now = new Map(notes.map((note) => [note.id, note.missing]));
  const last = lastClosed.get(id);
  if (!last && !notes.length) { lastClosed.set(id, { at: Date.now(), closed: now }); return; } // nothing closed at the first look: nothing to say
  if (last) {
    const changed = closedChange(last.closed, now);
    if (!changed) return;
    if (changed < Math.max(LOG_MIN_CHANGE, Math.ceil(Math.max(last.closed.size, now.size) * LOG_MIN_PERCENT / 100))) return;
    if (Date.now() - last.at < LOG_EVERY_MS) return;
  }
  lastClosed.set(id, { at: Date.now(), closed: now });
  const where = `[snapshots] ${guild.name} (${id})`; // i18n-ignore: a line of the log
  if (!notes.length) { logger.info(`${where}: Petto can post in every channel again.`); return; } // i18n-ignore: a line of the log
  const shown = notes.slice(0, MISSING_SHOWN).map((note) => `#${note.name} (${note.missing})`).join(', ');
  const more = notes.length > MISSING_SHOWN ? ` and ${notes.length - MISSING_SHOWN} more` : ''; // i18n-ignore: a line of the log
  const normal = notes.every((note) => note.missing === 'ViewChannel') ? ' (normal when private channels hide from Petto)' : ''; // i18n-ignore: a line of the log
  logger.info(`${where}: Petto cannot post in ${notes.length} channel(s), missing permission: ${shown}${more}${normal}.`); // i18n-ignore: a line of the log
}

/**
 * Saves the server unless nothing changed since the last save. Either way the Redis copy is written again, so it does not expire. The bot's own member is
 * loaded first when it is missing (without it nothing can be said about a channel, and the copy says "not known"). `refreshMe` reads the bot's member from
 * Discord again (a role or its permissions changed, or the dashboard asked for a resync); otherwise it is read again, at most once an hour, only when some
 * channel looks closed to the bot, since a copy of its roles that is behind is the usual reason a server where the bot is an Administrator says "cannot".
 */
async function saveGuildSnapshot(guild, { refreshMe = false } = {}) {
  const id = String(guild.id);
  await loadBotMember(guild, { force: refreshMe });
  let notes = [];
  let row = buildSnapshot(guild, { notes });
  if (!refreshMe && notes.length && guild.members?.me && Date.now() - (memberCheckedAt.get(id) ?? 0) > ME_CHECK_MS) {
    memberCheckedAt.set(id, Date.now());
    await loadBotMember(guild, { force: true });
    notes = [];
    row = buildSnapshot(guild, { notes });
  }
  logClosedChannels(guild, notes);
  const hash = crypto.createHash('md5').update(JSON.stringify(row)).digest('hex');
  const previous = lastSaved.get(row.guild_id);
  if (previous?.hash === hash) {
    await shareSnapshot({ ...row, updated_at: previous.updatedAt }, { announce: false });
    return false;
  }
  const saved = { ...row, updated_at: new Date().toISOString() };
  await snapshotsDb.saveSnapshot(saved);
  lastSaved.set(row.guild_id, { hash, updatedAt: saved.updated_at });
  await shareSnapshot(saved, { announce: true });
  return true;
}

const refreshNext = new Set(); // servers whose save must read the bot's member from Discord again

/** A burst of channel or role changes (a server being set up) becomes one save a few seconds later. `refreshMe`: the bot's roles or permissions may have changed. */
function scheduleGuildSnapshot(guild, { refreshMe = false } = {}) {
  if (!guild?.id) return;
  if (refreshMe) refreshNext.add(guild.id);
  if (timers.has(guild.id)) return;
  const timer = setTimeout(() => {
    timers.delete(guild.id);
    saveGuildSnapshot(guild, { refreshMe: refreshNext.delete(guild.id) }).catch((error) => logger.error(`[snapshots] saving ${guild.id} failed:`, error));
  }, DEBOUNCE_MS);
  timer.unref?.();
  timers.set(guild.id, timer);
}

async function removeGuildSnapshot(guildId) {
  lastSaved.delete(String(guildId));
  lastClosed.delete(String(guildId));
  memberCheckedAt.delete(String(guildId));
  await snapshotsDb.deleteSnapshots([guildId]);
  await redis.del(snapshotKey(guildId));
}

/** Tells the dashboard on `petto:guilds` that the bot joined or left a server (its list of servers changed). */
function announceGuildChange(guildId) {
  return redis.publish(GUILDS_CHANNEL, String(guildId));
}

/** Saves every server the bot has in memory and forgets the ones it no longer has. */
async function syncAllGuildSnapshots(client) {
  const guilds = [...client.guilds.cache.values()];
  let saved = 0;
  await forEachWithConcurrency(guilds, async (guild) => {
    try {
      if (await saveGuildSnapshot(guild)) saved += 1;
    } catch (error) {
      logger.error(`[snapshots] saving ${guild.id} failed:`, error);
    }
  }, SYNC_CONCURRENCY);

  // With only some shards in this process the others' servers are not in memory, so nothing may be forgotten here.
  let removed = 0;
  if (!config.shards && guilds.length) {
    const present = new Set(guilds.map((guild) => String(guild.id)));
    const gone = (await snapshotsDb.listSnapshotIds()).filter((id) => !present.has(id));
    if (gone.length) {
      await snapshotsDb.deleteSnapshots(gone);
      for (const id of gone) { lastSaved.delete(id); await redis.del(snapshotKey(id)); }
      removed = gone.length;
    }
  }
  return { saved, removed, total: guilds.length };
}

module.exports = {
  SNAPSHOT_TTL_MS,
  botAccess,
  postPermissionsFor,
  loadBotMember,
  buildSnapshot,
  saveGuildSnapshot,
  scheduleGuildSnapshot,
  removeGuildSnapshot,
  announceGuildChange,
  syncAllGuildSnapshots,
};
