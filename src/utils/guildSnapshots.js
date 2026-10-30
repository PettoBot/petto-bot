const crypto = require('node:crypto');
const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const logger = require('./logger');
const { forEachWithConcurrency } = require('./concurrency');
const snapshotsDb = require('../db/guildSnapshots');
const redis = require('./redis');

const POST_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]; // what a feed needs to post in a channel (see feeds/service.js)
const DEBOUNCE_MS = 3_000;
const SYNC_CONCURRENCY = 4;
// The dashboard reads a server from Redis first (`petto:snap:<id>`, the same row as the table) and hears on `petto:snap` when one
// changes. Ten minutes, like the full pass that writes it again. Without Redis it reads the table, as before.
const SNAPSHOT_TTL_MS = 600_000;
const SNAPSHOT_CHANNEL = 'snap'; // petto:snap
const GUILDS_CHANNEL = 'guilds'; // petto:guilds, a server was added or removed
const snapshotKey = (guildId) => `snap:${guildId}`;

/** The saved copy of one server, with channels and roles shaped like Discord's REST answers (the dashboard reads them as such), and its emojis. */
function buildSnapshot(guild) {
  const channels = [...guild.channels.cache.values()]
    .filter((channel) => !channel.isThread?.())
    .map((channel) => ({
      id: String(channel.id),
      name: channel.name,
      type: channel.type,
      position: channel.rawPosition ?? channel.position ?? 0,
      parent_id: channel.parentId ?? null,
      topic: channel.topic ?? null,
      nsfw: Boolean(channel.nsfw),
      // Whether the bot can see the channel and write in it: the dashboard says so where a channel is picked for something the bot posts (the feeds).
      bot_can_send: channel.isTextBased?.() && !channel.isDMBased?.() ? Boolean(guild.members?.me && channel.permissionsFor?.(guild.members.me)?.has(POST_PERMISSIONS)) : null,
    }));
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

/** Saves the server unless nothing changed since the last save. Either way the Redis copy is written again, so it does not expire. */
async function saveGuildSnapshot(guild) {
  const row = buildSnapshot(guild);
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

/** A burst of channel or role changes (a server being set up) becomes one save a few seconds later. */
function scheduleGuildSnapshot(guild) {
  if (!guild?.id || timers.has(guild.id)) return;
  const timer = setTimeout(() => {
    timers.delete(guild.id);
    saveGuildSnapshot(guild).catch((error) => logger.error(`[snapshots] saving ${guild.id} failed:`, error));
  }, DEBOUNCE_MS);
  timer.unref?.();
  timers.set(guild.id, timer);
}

async function removeGuildSnapshot(guildId) {
  lastSaved.delete(String(guildId));
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
  buildSnapshot,
  saveGuildSnapshot,
  scheduleGuildSnapshot,
  removeGuildSnapshot,
  announceGuildChange,
  syncAllGuildSnapshots,
};
