const { Routes, AuditLogEvent } = require('discord.js');
const { EVENTS, getLogConfig, deleteWebhookById, removeEntries } = require('../db/logConfig');
const logger = require('../utils/logger');
const missingWebhookWarnings = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function truncate(value, max) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return `${text.slice(0, max - 1)}…`;
}

function embedLength(embed) {
  return [
    embed.title,
    embed.description,
    embed.author?.name,
    embed.footer?.text,
    ...(embed.fields ?? []).flatMap((field) => [field.name, field.value]),
  ].reduce((total, value) => total + String(value ?? '').length, 0);
}

/**
 * Discord rejects the entire webhook payload when one log field is too long.
 * Logs are best-effort, so clamp every user/server-controlled embed value at
 * the Discord limit and keep the total embed below its 6,000-character limit.
 */
function sanitizeEmbed(embed) {
  if (!embed || typeof embed !== 'object') return null;

  const safe = { ...embed };
  if (safe.title != null) safe.title = truncate(safe.title, 256);
  if (safe.description != null) safe.description = truncate(safe.description, 4096);
  if (safe.author) safe.author = { ...safe.author, name: truncate(safe.author.name || 'Petto', 256) };
  if (safe.footer) safe.footer = { ...safe.footer, text: truncate(safe.footer.text || 'Petto log', 2048) };
  if (Array.isArray(safe.fields)) {
    safe.fields = safe.fields.slice(0, 25).map((field) => ({
      ...field,
      name: truncate(field?.name || '\u200b', 256),
      value: truncate(field?.value || '\u200b', 1024),
      inline: Boolean(field?.inline),
    }));
  }

  while (embedLength(safe) > 6000 && safe.fields?.length) safe.fields.pop();

  if (embedLength(safe) > 6000 && safe.description) {
    const excess = embedLength(safe) - 6000;
    safe.description = truncate(safe.description, Math.max(1, safe.description.length - excess));
  }
  if (embedLength(safe) > 6000 && safe.footer?.text) {
    const excess = embedLength(safe) - 6000;
    safe.footer.text = truncate(safe.footer.text, Math.max(1, safe.footer.text.length - excess));
  }

  return safe;
}

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
    const safeEmbed = sanitizeEmbed(embed);
    if (!safeEmbed) {
      logger.warn({ guildId, event, action: 'log-embed-sanitize' }, '[logEngine] Skipping invalid log embed.');
      return;
    }

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
        embeds: [entry.color != null ? { ...safeEmbed, color: entry.color } : safeEmbed],
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

module.exports = { sendLog, getAvatar, fetchMod, sanitizeEmbed, EVENTS, AuditLogEvent };
