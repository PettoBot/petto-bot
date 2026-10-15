const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, AuditLogEvent } = require('discord.js');
const { getConfig, getRules, createEvent } = require('../db/antinuke');
const { resolveRule, ruleLabel } = require('./antiNukeRules');
const { MAX_ITEMS, describeItem } = require('./antiNukeRestore');
const { textCard } = require('./caseCard');
const { sendLog } = require('../logging/engine');
const { EMOJI } = require('./emojis');
const logger = require('./logger');
const { t, tn, currentLanguage } = require('../i18n');

const RESTORE_PREFIX = 'an_restore';

// In-memory sliding window of destructive actions, per guild per protection per executor. Each one keeps what is needed
// to undo it, so when a protection answers it can say what it can put back.
const actionsByKey = new Map(); // `${guildId}:${counterKey}:${executorId}` -> [{ ts, label, undo }]
const triggeredByKey = new Map(); // same key -> expiresAt

function recordAction(key, windowSeconds, label, undo) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const recent = (actionsByKey.get(key) ?? []).filter((entry) => now - entry.ts < windowMs);
  recent.push({ ts: now, label, undo: undo ?? null });
  actionsByKey.set(key, recent);
  return recent;
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

async function isTrusted(client, guild, executor, eff) {
  if (executor.id === client.user.id) return true;
  if (executor.id === guild.ownerId) return true;
  if (eff.whitelistIds.includes(executor.id)) return true;
  if (eff.whitelistRoleIds.length) {
    const member = guild.members.cache.get(executor.id) ?? (await guild.members.fetch(executor.id).catch(() => null));
    if (member && eff.whitelistRoleIds.some((id) => member.roles.cache.has(id))) return true;
  }
  return false;
}

/** What the protection does to the account, from the action chosen. Answers { text, previousRoles }. */
async function punish(guild, executor, action, lang) {
  if (action === 'alert') return { text: t(lang, 'security.antinuke.punish.alertOnly'), previousRoles: [] };
  try {
    if (executor.bot || action === 'ban') {
      await guild.members.ban(executor.id, { reason: t(lang, 'security.antinuke.audit.response') });
      return { text: t(lang, executor.bot ? 'security.antinuke.punish.bannedBot' : 'security.antinuke.punish.bannedAccount'), previousRoles: [] };
    }
    const member = await guild.members.fetch(executor.id).catch(() => null);
    if (!member) return { text: t(lang, 'security.antinuke.punish.gone'), previousRoles: [] };
    if (action === 'kick') {
      if (!member.kickable) return { text: t(lang, 'security.antinuke.punish.cannotKick'), previousRoles: [] };
      await member.kick(t(lang, 'security.antinuke.audit.response'));
      return { text: t(lang, 'security.antinuke.punish.kicked'), previousRoles: [] };
    }
    if (!member.manageable) return { text: t(lang, 'security.antinuke.punish.cannotQuarantine'), previousRoles: [] };
    const previousRoles = member.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.id);
    await member.roles.set([], t(lang, 'security.antinuke.audit.quarantine'));
    return { text: t(lang, 'security.antinuke.punish.quarantined'), previousRoles };
  } catch (err) {
    logger.error('Anti-nuke: response action failed:', err);
    return { text: t(lang, 'security.antinuke.punish.failed'), previousRoles: [] };
  }
}

/** Undoes right away what must not stay (a bot that was added, a dangerous role that was given). */
async function applyInline(guild, items, lang) {
  const lines = [];
  for (const item of items) {
    try {
      if (item.kind === 'kick_bot') {
        await guild.members.kick(item.id, t(lang, 'security.antinuke.audit.botAdded'));
        lines.push(t(lang, 'security.antinuke.inline.botRemoved'));
      } else if (item.kind === 'remove_roles') {
        const member = await guild.members.fetch(item.userId).catch(() => null);
        if (member) {
          await member.roles.remove(item.roleIds, t(lang, 'security.antinuke.audit.dangerousRole'));
          lines.push(t(lang, 'security.antinuke.inline.rolesTaken', { user: `<@${item.userId}>` }));
        }
      }
    } catch (err) {
      logger.warn(`Anti-nuke inline undo ${item.kind} failed in ${guild.id}: ${err.message}`);
    }
  }
  return lines;
}

async function sendAlert(client, guild, eff, event, lines, canRestore, lang) {
  const text = [
    t(lang, 'security.antinuke.alert.title', { emoji: EMOJI.DENY, rule: ruleLabel(eff.rule, lang) }),
    tn(lang, 'security.antinuke.alert.summary', event.action_count, { count: event.action_count, user: `<@${event.executor_id}>`, detail: event.detail, seconds: eff.windowSeconds }),
    ...lines,
    t(lang, canRestore ? 'security.antinuke.alert.footerRestore' : 'security.antinuke.alert.footer', { id: event.id }),
  ].join('\n');

  const row = canRestore
    ? new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${RESTORE_PREFIX}::${event.id}`).setLabel(t(lang, 'security.antinuke.alert.restore.button')).setStyle(ButtonStyle.Success))
    : null;

  if (eff.alertChannelId) {
    const channel = await guild.channels.fetch(eff.alertChannelId).catch(() => null);
    if (channel?.isTextBased?.()) {
      const sent = await channel
        .send({ components: [textCard(text, 0xff6b6b), ...(row ? [row] : [])], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } })
        .then(() => true)
        .catch((err) => {
          logger.warn(`Anti-nuke: could not send the alert to ${eff.alertChannelId}: ${err.message}`);
          return false;
        });
      if (sent) return;
    }
  }
  await sendLog(client, guild.id, 'automod', { description: text, color: 0xff6b6b, timestamp: new Date().toISOString() }, row ? { components: [row] } : {}).catch((err) => logger.error('Anti-nuke: failed to send alert:', err));
}

/**
 * Tracks one action against its executor. When the same account crosses the threshold of that protection within its
 * window, the protection answers once (alert, quarantine, kick or ban), keeps what can be put back and tells the staff.
 * The owner, Petto and anyone in the whitelists (accounts or roles) are never touched.
 */
async function track(client, guild, { rule, auditLogType, targetId, byRecency = false, actionLabel, undo = null, inline = null, executor: knownExecutor = null, lang = currentLanguage() }) {
  const [config, rows] = await Promise.all([getConfig(guild.id), getRules(guild.id)]);
  const eff = resolveRule(config, rows, rule);
  if (!eff?.enabled) return;

  const executor = knownExecutor ?? (byRecency ? await findExecutorByRecency(guild, auditLogType) : await findExecutorByTarget(guild, auditLogType, targetId));
  if (!executor) return;
  if (await isTrusted(client, guild, executor, eff)) return;

  const key = `${guild.id}:${eff.counterKey}:${executor.id}`;
  const recent = recordAction(key, eff.windowSeconds, actionLabel, undo);
  if (inline) recent[recent.length - 1].inline = inline;
  if (recent.length < eff.threshold) return;

  // Several events arrive together once the threshold is crossed: answer once per window.
  const now = Date.now();
  if ((triggeredByKey.get(key) ?? 0) > now) return;
  triggeredByKey.set(key, now + eff.windowSeconds * 1000);
  for (const [k, expiresAt] of triggeredByKey) if (expiresAt <= now) triggeredByKey.delete(k);

  const restorable = recent.map((entry) => entry.undo).filter(Boolean).slice(-MAX_ITEMS);
  const inlineItems = recent.flatMap((entry) => entry.inline ?? []);

  const response = await punish(guild, executor, eff.action, lang);
  const lines = [response.text, ...(await applyInline(guild, inlineItems, lang))];

  let event = { id: '?', executor_id: executor.id, action_count: recent.length, detail: actionLabel };
  try {
    event = await createEvent({
      guild_id: guild.id,
      rule,
      executor_id: executor.id,
      executor_name: executor.username ?? null,
      action_count: recent.length,
      action: eff.action,
      detail: actionLabel,
      restorable,
      previous_roles: response.previousRoles,
    });
  } catch (err) {
    logger.error('Anti-nuke: could not save the event:', err);
  }

  if (restorable.length) {
    const items = restorable.slice(0, 5).map((item) => describeItem(item, lang)).join(', ');
    lines.push(restorable.length > 5
      ? t(lang, 'security.antinuke.alert.restorableMore', { items, count: restorable.length - 5 })
      : t(lang, 'security.antinuke.alert.restorable', { items }));
  }
  if (response.previousRoles.length) lines.push(t(lang, 'security.antinuke.alert.rolesSaved', { count: response.previousRoles.length }));
  await sendAlert(client, guild, eff, event, lines, event.id !== '?' && (restorable.length > 0 || response.previousRoles.length > 0), lang);
}

/** Tracks a destructive action that has a clean target id to correlate against the audit log (ban, channel/role/emoji delete). */
function trackDestructiveAction(client, guild, options) {
  return track(client, guild, { rule: options.rule ?? 'ban', ...options });
}

/** Tracks a destructive action with no clean target id (e.g. webhook creation, only known via the channel it fired on). */
function trackDestructiveActionByRecency(client, guild, options) {
  return track(client, guild, { rule: options.rule ?? 'webhook', byRecency: true, ...options });
}

module.exports = { RESTORE_PREFIX, track, trackDestructiveAction, trackDestructiveActionByRecency, AuditLogEvent };
