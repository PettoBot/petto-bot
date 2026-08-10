const { getConfig } = require('../db/antinuke');
const { sendLog } = require('../logging/engine');
const { EMOJI } = require('./emojis');
const logger = require('./logger');

// In-memory sliding window of destructive-action timestamps, per guild per executor.
const actionsByGuild = new Map(); // guildId -> Map<executorId, timestamp[]>
const triggeredByGuild = new Map(); // guildId -> Map<executorId, expiresAt>

function recordAction(guildId, executorId, windowSeconds) {
  const guildMap = actionsByGuild.get(guildId) ?? new Map();
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const recent = (guildMap.get(executorId) ?? []).filter((ts) => now - ts < windowMs);
  recent.push(now);
  guildMap.set(executorId, recent);
  actionsByGuild.set(guildId, guildMap);
  return recent.length;
}

/** Best-effort audit log lookup for who performed a destructive action on `targetId`. */
async function findExecutorByTarget(guild, auditLogType, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type: auditLogType, limit: 5 });
    const entry = logs.entries.find((e) => e.targetId === String(targetId) && Date.now() - e.createdTimestamp < 10_000);
    return entry?.executor ?? null;
  } catch {
    return null;
  }
}

/**
 * Best-effort audit log lookup for events with no clean target id to match
 * against (e.g. webhook creation only tells us the channel, not which
 * webhook) — falls back to "most recent matching entry, if very recent".
 */
async function findExecutorByRecency(guild, auditLogType) {
  try {
    const logs = await guild.fetchAuditLogs({ type: auditLogType, limit: 1 });
    const entry = logs.entries.first();
    if (entry && Date.now() - entry.createdTimestamp < 10_000) return entry.executor ?? null;
    return null;
  } catch {
    return null;
  }
}

/**
 * Tracks a destructive action (ban, channel delete, role delete, emoji
 * delete, webhook creation) against its executor. Once the same executor
 * crosses `action_threshold` such actions within `window_seconds`, responds
 * automatically: bans the executor if it's a bot, or strips all roles
 * ("quarantine") if it's a human — the guild owner and any whitelisted id
 * are never auto-actioned.
 */
async function handleExecutor(client, guild, executor, config, actionLabel) {
  if (!executor) return;
  if (executor.id === client.user.id) return;
  if (executor.id === guild.ownerId) return;
  if (config.whitelist_ids?.includes(executor.id)) return;

  const count = recordAction(guild.id, executor.id, config.window_seconds);
  if (count < config.action_threshold) return;

  // Several Discord events can arrive concurrently after the threshold is
  // crossed. Trigger once per window so anti-nuke does not repeatedly ban the
  // same bot or spam role-removal requests for the same human.
  const now = Date.now();
  const triggered = triggeredByGuild.get(guild.id) ?? new Map();
  const triggeredUntil = triggered.get(executor.id) ?? 0;
  if (triggeredUntil > now) return;
  triggered.set(executor.id, now + config.window_seconds * 1000);
  for (const [id, expiresAt] of triggered) {
    if (expiresAt <= now) triggered.delete(id);
  }
  triggeredByGuild.set(guild.id, triggered);

  await sendLog(client, guild.id, 'automod', {
    author: { name: executor.username, icon_url: executor.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? undefined },
    description: `${EMOJI.DENY} **Anti-nuke triggered** — <@${executor.id}> performed ${count} destructive action(s) (${actionLabel}) within ${config.window_seconds}s.`,
    color: 0xfe6465,
    footer: { text: `User ID: ${executor.id}` },
    timestamp: new Date().toISOString(),
  }).catch((err) => logger.error('Anti-nuke: failed to send alert:', err));

  try {
    if (executor.bot) {
      await guild.members.ban(executor.id, { reason: 'Anti-nuke: automated response to a burst of destructive actions' });
      return;
    }

    const member = await guild.members.fetch(executor.id).catch(() => null);
    if (!member || !member.manageable) return;

    const previousRoles = member.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.id);
    await member.roles.set([], 'Anti-nuke: quarantine after a burst of destructive actions');

    await sendLog(client, guild.id, 'automod', {
      description: `${EMOJI.ALERT} Quarantined <@${executor.id}> (all roles removed). Previous roles: ${previousRoles.map((id) => `<@&${id}>`).join(' ') || 'none'}. Restore manually once reviewed.`,
      color: 0xfe6465,
      timestamp: new Date().toISOString(),
    }).catch(() => {});
  } catch (err) {
    logger.error('Anti-nuke: response action failed:', err);
  }
}

/** Tracks a destructive action that has a clean target id to correlate against the audit log (ban, channel/role/emoji delete). */
async function trackDestructiveAction(client, guild, { auditLogType, targetId, actionLabel }) {
  const config = await getConfig(guild.id);
  if (!config?.enabled) return;

  const executor = await findExecutorByTarget(guild, auditLogType, targetId);
  await handleExecutor(client, guild, executor, config, actionLabel);
}

/** Tracks a destructive action with no clean target id (e.g. webhook creation, only known via the channel it fired on). */
async function trackDestructiveActionByRecency(client, guild, { auditLogType, actionLabel }) {
  const config = await getConfig(guild.id);
  if (!config?.enabled) return;

  const executor = await findExecutorByRecency(guild, auditLogType);
  await handleExecutor(client, guild, executor, config, actionLabel);
}

module.exports = { trackDestructiveAction, trackDestructiveActionByRecency };
