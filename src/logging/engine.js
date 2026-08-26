const { Routes, AuditLogEvent } = require('discord.js');
const { EVENTS, getLogConfig, deleteWebhookById, removeEntries } = require('../db/logConfig');
const logger = require('../utils/logger');
const missingWebhookWarnings = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getAvatar(user) {
  if (!user) return null;
  try {
    return user.displayAvatarURL({ extension: 'png', size: 256 });
  } catch {
    return null;
  }
}

/** Best-effort lookup of who performed an action via the audit log (Discord has no direct actor field on most events). */
async function fetchMod(guild, action, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type: action, limit: 5 });
    const entry = logs.entries.find((e) => e.targetId === String(targetId) && Date.now() - e.createdTimestamp < 6000);
    if (entry?.executor) return `<@${entry.executor.id}>`;
  } catch {
    // Missing View Audit Log permission or similar — attribution is best-effort, not required.
  }
  return null;
}

/**
 * Delivers a log embed to every channel configured for `event` in this
 * guild, via that channel's dedicated webhook. If a webhook was deleted out
 * from under us (Discord error 10015), the dead webhook and the failing
 * entry are pruned so future events don't keep retrying it.
 */
async function sendLog(client, guildId, event, embed, { ignoreIds = [], files = [], components = [] } = {}) {
  try {
    const config = await getLogConfig(guildId);
    if (ignoreIds.length && ignoreIds.some((id) => id && config.ignored.includes(id))) return;

    const entries = config.entries.filter((e) => e.event === event);
    if (!entries.length) return;

    for (const entry of entries) {
      const wh = config.webhooks.find((w) => w.channel_id === entry.channel_id);
      if (!wh) {
        const warningKey = `${guildId}:${entry.channel_id}`;
        const lastWarning = missingWebhookWarnings.get(warningKey) ?? 0;
        if (Date.now() - lastWarning >= 60_000) {
          missingWebhookWarnings.set(warningKey, Date.now());
          logger.warn(`[logEngine] No webhook found for configured log channel ${entry.channel_id} in guild ${guildId}. Re-add this log target with !logs add if it persists.`);
        }
        continue;
      }

      const body = {
        // Overrides whatever avatar/name got baked into the webhook at creation time, so a
        // stale webhook (created before the bot had a real avatar, or before an avatar/name
        // change) never has to be manually re-patched, every send just carries the current one.
        username: client.user.username,
        avatar_url: getAvatar(client.user) ?? undefined,
        embeds: [entry.color != null ? { ...embed, color: entry.color } : embed],
        flags: 4096, // SuppressNotifications
      };
      if (components.length) {
        body.components = components.map((component) => (
          typeof component?.toJSON === 'function' ? component.toJSON() : component
        ));
      }

      let deliveryError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await client.rest.post(Routes.webhook(wh.webhook_id, wh.webhook_token), { body, files: files.length ? files : undefined });
          deliveryError = null;
          break;
        } catch (err) {
          deliveryError = err;
          const retryable = err.status === 429 || err.status >= 500 || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
          if (!retryable || attempt === 2) break;
          const retryAfter = Math.min(2_000, Math.max(150, Number(err.retryAfter) || (attempt + 1) * 300));
          await sleep(retryAfter);
        }
      }

      if (deliveryError) {
        const err = deliveryError;
        if (err.code === 10015) {
          await Promise.all([
            deleteWebhookById(guildId, wh.webhook_id).catch(() => {}),
            removeEntries(guildId, entry.channel_id, entry.event).catch(() => {}),
          ]);
        } else if (err.status !== 403 && err.code !== 10003) {
          logger.error(`[logEngine] ${event} -> ${entry.channel_id} delivery failed after retries:`, err.message);
        }
      }
    }
  } catch (err) {
    logger.error('[logEngine] sendLog error:', err.message);
  }
}

module.exports = { sendLog, getAvatar, fetchMod, EVENTS, AuditLogEvent };
