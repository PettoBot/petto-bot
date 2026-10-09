const crypto = require('node:crypto');
const config = require('../config');
const logger = require('./logger');
const { forEachWithConcurrency } = require('./concurrency');
const snapshotsDb = require('../db/guildSnapshots');

const DEBOUNCE_MS = 3_000;
const SYNC_CONCURRENCY = 4;

/** The saved copy of one server, with channels and roles shaped like Discord's REST answers (the dashboard reads them as such). */
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
  };
}

const lastSaved = new Map();
const timers = new Map();

/** Saves the server unless nothing changed since the last save. */
async function saveGuildSnapshot(guild) {
  const row = buildSnapshot(guild);
  const hash = crypto.createHash('md5').update(JSON.stringify(row)).digest('hex');
  if (lastSaved.get(row.guild_id) === hash) return false;
  await snapshotsDb.saveSnapshot(row);
  lastSaved.set(row.guild_id, hash);
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
    if (gone.length) { await snapshotsDb.deleteSnapshots(gone); removed = gone.length; }
  }
  return { saved, removed, total: guilds.length };
}

module.exports = { buildSnapshot, saveGuildSnapshot, scheduleGuildSnapshot, removeGuildSnapshot, syncAllGuildSnapshots };
