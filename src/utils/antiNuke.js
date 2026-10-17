const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, AuditLogEvent } = require('discord.js');
const { getConfig, getRules, createEvent } = require('../db/antinuke');
const { resolveRule, ruleLabel } = require('./antiNukeRules');
const { MAX_ITEMS, describeItem } = require('./antiNukeRestore');
const { noteIncident } = require('./antiNukePanic');
const { textCard } = require('./caseCard');
const { sendLog } = require('../logging/engine');
const { EMOJI } = require('./emojis');
const logger = require('./logger');
const { t, tn, currentLanguage } = require('../i18n');

const RESTORE_PREFIX = 'an_restore';

// In-memory sliding window of destructive actions, per guild per protection per executor. Each one keeps what is needed
// to undo it, so when a protection answers it can say what it can put back.
const actionsByKey = new Map(); // `${guildId}:${counterKey}:${executorId}` -> [{ ts, label, undo, inline }]
const triggeredByKey = new Map(); // same key -> expiresAt
// Audit log entries already blamed on somebody, so one entry is never counted twice (a webhook created fires several
// WebhooksUpdate events, a channel edit can fire more than one ChannelUpdate).
const consumedEntries = new Map(); // `${guildId}:${entryId}` -> expiresAt
const ownerDmAt = new Map(); // guildId -> last DM to the owner

// The audit log entry of an action can arrive after the gateway event: it is read again a moment later before giving up.
const AUDIT_RETRY_DELAYS_MS = [0, 900, 2200];
const AUDIT_MAX_AGE_MS = 15_000;
const OWNER_DM_COOLDOWN_MS = 60_000;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function recordAction(key, windowSeconds, label, undo, inline) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const recent = (actionsByKey.get(key) ?? []).filter((entry) => now - entry.ts < windowMs);
  recent.push({ ts: now, label, undo: undo ?? null, inline: inline ?? null });
  actionsByKey.set(key, recent);
  return recent;
}

function entriesOf(logs) {
  const entries = logs?.entries;
  if (!entries) return [];
  return typeof entries.values === 'function' ? [...entries.values()] : [];
}

/**
 * Finds the audit log entry of an action: of one of `types`, recent, not blamed yet, and matching `match` (usually the target).
 * Reads the log again a moment later when the entry is not there yet. Answers the entry or null.
 */
async function findAuditEntry(guild, types, match, { retries = AUDIT_RETRY_DELAYS_MS.length - 1 } = {}) {
  const list = Array.isArray(types) ? types : [types];
  const delays = AUDIT_RETRY_DELAYS_MS.slice(0, Math.max(1, retries + 1));
  for (const delay of delays) {
    if (delay) await wait(delay);
    let logs;
    try {
      logs = await guild.fetchAuditLogs(list.length === 1 ? { type: list[0], limit: 10 } : { limit: 25 });
    } catch {
      return null;
    }
    const now = Date.now();
    const entry = entriesOf(logs).find((e) =>
      (list.length === 1 || e.action === undefined || list.includes(e.action))
      && now - (e.createdTimestamp ?? 0) < AUDIT_MAX_AGE_MS
      && !consumedEntries.has(`${guild.id}:${e.id}`)
      && match(e));
    if (entry) {
      consumedEntries.set(`${guild.id}:${entry.id}`, now + AUDIT_MAX_AGE_MS * 2);
      for (const [key, expiresAt] of consumedEntries) if (expiresAt <= now) consumedEntries.delete(key);
      return entry;
    }
  }
  return null;
}

async function executorOf(guild, entry) {
  if (!entry) return null;
  if (entry.executor) return entry.executor;
  if (!entry.executorId) return null;
  return guild.client?.users?.fetch?.(entry.executorId).catch(() => null) ?? null;
}

/** Who performed the action on `targetId` (ban, deletion, edit...), from the audit log. */
async function findExecutorByTarget(guild, auditLogType, targetId, options) {
  return executorOf(guild, await findAuditEntry(guild, auditLogType, (e) => String(e.targetId ?? e.target?.id) === String(targetId), options));
}

/** For events with no clean target (a webhook created only tells the channel): the most recent entry not blamed yet. */
async function findExecutorByRecency(guild, auditLogType, matchEntry, options) {
  return executorOf(guild, await findAuditEntry(guild, auditLogType, matchEntry ?? (() => true), options));
}

/** The owner, Petto, the trusted admins of the anti-nuke and the whitelists (accounts or roles) are never touched. */
async function isTrusted(client, guild, executor, eff, config) {
  if (executor.id === client.user.id) return true;
  if (executor.id === guild.ownerId) return true;
  if ((config?.admin_ids ?? []).includes(executor.id)) return true;
  if (eff.whitelistIds.includes(executor.id)) return true;
  if (eff.whitelistRoleIds.length) {
    const member = guild.members.cache.get(executor.id) ?? (await guild.members.fetch(executor.id).catch(() => null));
    if (member && eff.whitelistRoleIds.some((id) => member.roles.cache.has(id))) return true;
  }
  return false;
}

/** Whether the member's highest role is at or above Petto's: Discord would refuse, and Petto never tries. */
function aboveMe(guild, member) {
  const mine = guild.members?.me?.roles?.highest?.position;
  const theirs = member?.roles?.highest?.position;
  return Number.isFinite(mine) && Number.isFinite(theirs) && theirs >= mine;
}

/** What the protection does to the account, from the action chosen. Answers { text, previousRoles }. */
async function punish(guild, executor, action, lang) {
  if (action === 'alert') return { text: t(lang, 'security.antinuke.punish.alertOnly'), previousRoles: [] };
  if (executor.webhookOnly) return { text: t(lang, 'security.antinuke.punish.webhookOnly'), previousRoles: [] };
  try {
    const member = await guild.members.fetch(executor.id).catch(() => null);
    if (member && aboveMe(guild, member)) return { text: t(lang, 'security.antinuke.punish.aboveMe'), previousRoles: [] };
    if (executor.bot || action === 'ban') {
      if (member && member.bannable === false) return { text: t(lang, 'security.antinuke.punish.cannotBan'), previousRoles: [] };
      await guild.members.ban(executor.id, { reason: t(lang, 'security.antinuke.audit.response') });
      return { text: t(lang, executor.bot ? 'security.antinuke.punish.bannedBot' : 'security.antinuke.punish.bannedAccount'), previousRoles: [] };
    }
    if (!member) return { text: t(lang, 'security.antinuke.punish.gone'), previousRoles: [] };
    if (action === 'kick') {
      if (!member.kickable) return { text: t(lang, 'security.antinuke.punish.cannotKick'), previousRoles: [] };
      await member.kick(t(lang, 'security.antinuke.audit.response'));
      return { text: t(lang, 'security.antinuke.punish.kicked'), previousRoles: [] };
    }
    if (!member.manageable) return { text: t(lang, 'security.antinuke.punish.cannotQuarantine'), previousRoles: [] };
    // Managed roles (a booster or an integration role) cannot be taken by a bot: they stay, everything else goes.
    const previousRoles = member.roles.cache.filter((r) => r.id !== guild.id && !r.managed).map((r) => r.id);
    const kept = member.roles.cache.filter((r) => r.id !== guild.id && r.managed).map((r) => r.id);
    await member.roles.set(kept, t(lang, 'security.antinuke.audit.quarantine'));
    return { text: t(lang, 'security.antinuke.punish.quarantined'), previousRoles };
  } catch (err) {
    logger.error('Anti-nuke: response action failed:', err);
    return { text: t(lang, 'security.antinuke.punish.failed'), previousRoles: [] };
  }
}

/**
 * Only the oldest saved state of one role, channel or of the server is put back (several edits in a row go back to how it
 * was before the first one), and each message is deleted once.
 */
function dedupeInline(items) {
  const seen = new Set();
  const out = [];
  let guildRevert = null;
  for (const item of items) {
    if (item.kind === 'revert_guild') {
      // One revert of the server, with the oldest name, icon and vanity of the burst (each edit may have changed only one).
      if (!guildRevert) { guildRevert = { kind: 'revert_guild' }; out.push(guildRevert); }
      for (const field of ['name', 'iconUrl', 'vanity']) if (item[field] !== undefined && guildRevert[field] === undefined) guildRevert[field] = item[field];
      continue;
    }
    const key = ['revert_role', 'revert_channel', 'delete_webhook', 'kick_bot'].includes(item.kind) ? `${item.kind}:${item.id ?? ''}` : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(item);
  }
  return out;
}

/** Undoes right away what must not stay (a bot added, a dangerous role given, a role or channel edited, a flood). */
async function applyInline(client, guild, items, lang) {
  const lines = [];
  for (const item of dedupeInline(items)) {
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
      } else if (item.kind === 'revert_role') {
        const role = guild.roles?.cache?.get(item.id);
        if (role && role.editable !== false) {
          await role.edit({ name: item.name, permissions: BigInt(item.permissions), color: item.color, hoist: item.hoist, mentionable: item.mentionable, reason: t(lang, 'security.antinuke.audit.revertRole') });
          lines.push(t(lang, 'security.antinuke.inline.roleReverted', { name: item.name }));
        }
      } else if (item.kind === 'revert_channel') {
        const channel = guild.channels?.cache?.get(item.id);
        if (channel) {
          const reason = t(lang, 'security.antinuke.audit.revertChannel');
          const overwrites = (item.overwrites ?? [])
            .filter((o) => (o.type === 0 ? guild.roles?.cache?.has(o.id) : true))
            .map((o) => ({ id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) }));
          await channel.edit({ name: item.name, ...(item.topic !== undefined ? { topic: item.topic } : {}), nsfw: item.nsfw, reason });
          await channel.permissionOverwrites?.set?.(overwrites, reason);
          lines.push(t(lang, 'security.antinuke.inline.channelReverted', { name: item.name }));
        }
      } else if (item.kind === 'revert_guild') {
        const patch = {};
        if (item.name) patch.name = item.name;
        if (item.iconUrl !== undefined) patch.icon = item.iconUrl;
        if (Object.keys(patch).length) {
          await guild.edit({ ...patch, reason: t(lang, 'security.antinuke.audit.revertGuild') });
          lines.push(t(lang, 'security.antinuke.inline.guildReverted'));
        }
        if (item.vanity) lines.push(t(lang, 'security.antinuke.inline.vanityManual', { code: item.vanity }));
      } else if (item.kind === 'delete_webhook') {
        await client.deleteWebhook(item.id, { reason: t(lang, 'security.antinuke.audit.webhookSpam') });
        lines.push(t(lang, 'security.antinuke.inline.webhookDeleted', { name: item.name ?? item.id }));
      } else if (item.kind === 'delete_message') {
        const channel = guild.channels?.cache?.get(item.channelId);
        await channel?.messages?.delete?.(item.id);
      }
    } catch (err) {
      logger.warn(`Anti-nuke inline undo ${item.kind} failed in ${guild.id}: ${err.message}`);
    }
  }
  const deleted = items.filter((item) => item.kind === 'delete_message').length;
  if (deleted) lines.push(tn(lang, 'security.antinuke.inline.messagesDeleted', deleted, { count: deleted }));
  return lines;
}

/** The report of an incident: in the alert channel (or the automod log) with the restore button, and in the owner's DMs. */
async function sendAlert(client, guild, eff, config, event, lines, canRestore, lang) {
  const text = [
    t(lang, 'security.antinuke.alert.title', { emoji: EMOJI.DENY, rule: ruleLabel(eff.rule, lang) }),
    tn(lang, 'security.antinuke.alert.summary', event.action_count, { count: event.action_count, user: `<@${event.executor_id}>`, detail: event.detail, seconds: eff.windowSeconds }),
    t(lang, 'security.antinuke.alert.who', { name: event.executor_name ?? event.executor_id, id: event.executor_id }),
    ...lines,
    t(lang, canRestore ? 'security.antinuke.alert.footerRestore' : 'security.antinuke.alert.footer', { id: event.id }),
  ].join('\n');

  const row = canRestore
    ? new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${RESTORE_PREFIX}::${event.id}`).setLabel(t(lang, 'security.antinuke.alert.restore.button')).setStyle(ButtonStyle.Success))
    : null;

  await dmOwner(guild, config, text, lang);

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

/** The owner hears about it in DMs (on by default, once a minute at most per server). */
async function dmOwner(guild, config, text, lang) {
  if (config && config.dm_owner === false) return;
  if (!guild.ownerId || typeof guild.fetchOwner !== 'function') return;
  const now = Date.now();
  if ((ownerDmAt.get(guild.id) ?? 0) + OWNER_DM_COOLDOWN_MS > now) return;
  ownerDmAt.set(guild.id, now);
  const owner = await guild.fetchOwner().catch(() => null);
  if (!owner?.send) return;
  const body = [t(lang, 'security.antinuke.dm.title', { server: guild.name ?? guild.id }), text].join('\n');
  await owner.send({ components: [textCard(body, 0xff6b6b)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } })
    .catch((err) => logger.warn(`Anti-nuke: the owner of ${guild.id} could not be told in DMs: ${err.message}`));
}

/**
 * Tracks one action against its executor. When the same account crosses the threshold of that protection within its
 * window (or the action is `immediate`, like a role given Administrator), the protection answers once: it undoes what must
 * not stay, punishes (alert, quarantine, kick or ban), keeps what can be put back and tells the staff and the owner.
 * Later actions of the same account inside that window are undone too, without a second alert.
 */
async function track(client, guild, { rule, auditLogType, targetId, byRecency = false, matchEntry = null, retries, actionLabel, undo = null, inline = null, immediate = false, executor: knownExecutor = null, lang = currentLanguage() }) {
  const [config, rows] = await Promise.all([getConfig(guild.id), getRules(guild.id)]);
  const eff = resolveRule(config, rows, rule);
  if (!eff?.enabled) return;

  const options = retries === undefined ? undefined : { retries };
  const executor = knownExecutor ?? (byRecency ? await findExecutorByRecency(guild, auditLogType, matchEntry, options) : await findExecutorByTarget(guild, auditLogType, targetId, options));
  if (!executor) return;
  if (await isTrusted(client, guild, executor, eff, config)) return;

  const key = `${guild.id}:${eff.counterKey}:${executor.id}`;
  const recent = recordAction(key, eff.windowSeconds, actionLabel, undo, inline);
  if (recent.length < eff.threshold && !immediate) return;

  // Several events arrive together once the threshold is crossed: answer once per window, but still undo what comes after.
  const now = Date.now();
  if ((triggeredByKey.get(key) ?? 0) > now) {
    if (inline?.length) await applyInline(client, guild, inline, lang);
    return;
  }
  triggeredByKey.set(key, now + eff.windowSeconds * 1000);
  for (const [k, expiresAt] of triggeredByKey) if (expiresAt <= now) triggeredByKey.delete(k);

  const restorable = recent.map((entry) => entry.undo).filter(Boolean).slice(-MAX_ITEMS);
  const inlineItems = recent.flatMap((entry) => entry.inline ?? []);

  // What must not stay goes first (a role with Administrator is taken back before anything else), then the account answers.
  const inlineLines = await applyInline(client, guild, inlineItems, lang);
  const response = await punish(guild, executor, eff.action, lang);
  const lines = [response.text, ...inlineLines];

  let event = { id: '?', executor_id: executor.id, executor_name: executor.username ?? null, action_count: recent.length, detail: actionLabel };
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
  if (await noteIncident(client, guild, config).catch(() => false)) lines.push(t(lang, 'security.antinuke.panic.started'));
  await sendAlert(client, guild, eff, config, event, lines, event.id !== '?' && (restorable.length > 0 || response.previousRoles.length > 0), lang);
}

/** Tracks a destructive action that has a clean target id to correlate against the audit log (ban, channel/role/emoji delete). */
function trackDestructiveAction(client, guild, options) {
  return track(client, guild, { rule: options.rule ?? 'ban', ...options });
}

/** Tracks a destructive action with no clean target id (e.g. webhook creation, only known via the channel it fired on). */
function trackDestructiveActionByRecency(client, guild, options) {
  return track(client, guild, { rule: options.rule ?? 'webhook', byRecency: true, ...options });
}

/** Whether a protection is on for this server, so an event can skip extra work (a webhook lookup) when it is off. */
async function ruleEnabled(guildId, rule) {
  const [config, rows] = await Promise.all([getConfig(guildId), getRules(guildId)]);
  return Boolean(resolveRule(config, rows, rule)?.enabled);
}

/** For the checks: forget every window, trigger and blamed entry. */
function resetAntiNuke() {
  actionsByKey.clear();
  triggeredByKey.clear();
  consumedEntries.clear();
  ownerDmAt.clear();
}

module.exports = { RESTORE_PREFIX, track, trackDestructiveAction, trackDestructiveActionByRecency, ruleEnabled, findAuditEntry, aboveMe, resetAntiNuke, AuditLogEvent };
