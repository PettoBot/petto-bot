const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { upsertConfig } = require('../db/verificationConfig');
const logger = require('./logger');
const { t, guildLanguage } = require('../i18n');

// The channels the gate role is hidden from. Threads follow their channel.
const GATED_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildStageVoice, ChannelType.GuildCategory, ChannelType.GuildMedia]);
// Edits sent at the same time. Each one is a single request; Petto's own limit (`restRequestsPerSecond`, 8 a second) still spaces them, so
// three keep it near the limit without taking all of it from the rest of the bot. One after the other they went at the speed of a round trip.
const GATE_CONCURRENCY = 3;

// One gate role being made per server at a time: a second caller (a member who joins meanwhile, the panel job, a second press in the
// dashboard) waits for the same one instead of making another role and editing every channel again.
const making = new Map(); // guildId -> { promise, listeners: Set<fn> }

/**
 * What the gate needs in one channel: `done` when the role already has View Channel set there (allowed or denied: what the server chose is
 * kept), `noAccess` when Petto cannot edit it (asking would only get a 403 and cost a request), `todo` otherwise. Null for other kinds.
 */
function gateNeed(channel, roleId, me) {
  if (!GATED_TYPES.has(channel.type)) return null;
  const overwrite = channel.permissionOverwrites?.cache?.get(roleId);
  if (overwrite && (overwrite.deny?.has?.(PermissionFlagsBits.ViewChannel) || overwrite.allow?.has?.(PermissionFlagsBits.ViewChannel))) return 'done';
  const perms = me ? channel.permissionsFor?.(me) : null;
  if (perms && !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageRoles])) return 'noAccess';
  return 'todo';
}

/**
 * Hides every channel from `role` (View Channel denied), only where it is not set yet and Petto may edit it, a few at a time.
 * `onProgress({ phase: 'channels', done, total })` after each one. Returns the counts.
 */
async function gateChannels(guild, role, { reason, onProgress, concurrency = GATE_CONCURRENCY } = {}) {
  const me = guild.members?.me ?? null;
  const todo = [];
  let kept = 0;
  let noAccess = 0;
  for (const channel of guild.channels.cache.values()) {
    const need = gateNeed(channel, role.id, me);
    if (need === 'todo') todo.push(channel);
    else if (need === 'done') kept += 1;
    else if (need === 'noAccess') noAccess += 1;
  }
  const total = todo.length;
  let done = 0;
  let failed = 0;
  onProgress?.({ phase: 'channels', done, total });
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const channel = todo[next++];
      await channel.permissionOverwrites.edit(role, { ViewChannel: false }, { reason }).catch((err) => {
        failed += 1;
        logger.warn(`Could not set verification overwrite in #${channel.name} (${channel.id}):`, err.message);
      });
      done += 1;
      onProgress?.({ phase: 'channels', done, total });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, total)) }, worker));
  return { total, changed: done - failed, failed, kept, noAccess };
}

/**
 * Returns the guild's "Unverified" role, creating one (and denying it View
 * Channel everywhere) the first time /verify is set up. New members get this
 * role on join and lose it once they pass the Turnstile check, so no separate
 * "Verified" role — or any pre-existing channel permission setup — is required.
 * `onProgress({ phase, done, total })` follows the channels while a new role is set up.
 */
async function ensureUnverifiedRole(guild, verifyConfig, { onProgress } = {}) {
  if (verifyConfig.unverified_role_id) {
    const existing = guild.roles.cache.get(verifyConfig.unverified_role_id);
    if (existing) return existing;
  }

  const running = making.get(guild.id);
  if (running) {
    if (onProgress) running.listeners.add(onProgress);
    try { return await running.promise; } finally { if (onProgress) running.listeners.delete(onProgress); }
  }

  const entry = { listeners: new Set(onProgress ? [onProgress] : []), promise: null };
  const tell = (progress) => { for (const listener of entry.listeners) { try { listener(progress); } catch { /* a listener never stops the setup */ } } };
  entry.promise = (async () => {
    // The role and the reasons in the audit log are in the language of the server.
    const lang = await guildLanguage(guild.id);
    const role = await guild.roles.create({
      name: t(lang, 'verify.role.unverified'),
      color: 0x2b2d31,
      permissions: [],
      reason: t(lang, 'verify.reason.gateRole'),
    });
    await gateChannels(guild, role, { reason: t(lang, 'verify.reason.gateSetup'), onProgress: tell });
    await upsertConfig(guild.id, { unverified_role_id: role.id });
    return role;
  })();
  making.set(guild.id, entry);
  try {
    return await entry.promise;
  } finally {
    making.delete(guild.id);
  }
}

module.exports = { ensureUnverifiedRole, gateChannels, gateNeed, GATED_TYPES };
