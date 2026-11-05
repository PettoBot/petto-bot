// Role triggers: an action (warn, mute, jail, kick, ban or taking the role away) for a member who is given a role, or who holds it when they finish
// Discord's onboarding. Everything that decides is plain functions here (matching, who is never touched, the memory of what was done, the circuit breaker,
// the validation of a rule), so they are checked without Discord; `handleMemberUpdate` is the one that reads a member update and `applyRule` runs the action
// through the same case, DM and log steps as a manual sanction, with Petto as the moderator.
const { GuildMemberFlags, PermissionFlagsBits } = require('discord.js');
const roleTriggersDb = require('../db/roleTriggers');
const { createCase } = require('../db/modActions');
const { addWarn } = require('../db/warns');
const { ensureGuild } = require('../db/guilds');
const { getEffectiveLevel } = require('../db/permissions');
const { logSanction } = require('./caseLog');
const { sanctionDM } = require('./sanctionTemplates');
const { checkAndApplyEscalation } = require('./escalation');
const { ensureMuteRole } = require('./muteRole');
const { jailMember, JailError } = require('./jail');
const { formatDuration, parseDuration } = require('./duration');
const { sendDm } = require('./dmOrigin');
const { displayReason } = require('./caseFormat');
const logger = require('./logger');
const { t, guildLanguage } = require('../i18n');
const { BREAKER_LIMIT, BREAKER_WINDOW_MS, BREAKER_PAUSE_MS, QUEUE_MINUTES, MIN_LIMIT, MAX_LIMIT, defaultLimit, validLimit, queueCap, createBreaker } = require('./roleTriggerBreaker'); // typed source: roleTriggerBreaker.ts

const ACTIONS = Object.freeze(['warn', 'mute', 'jail', 'kick', 'ban', 'remove_role']);
const TRIGGERS = Object.freeze(['role_added', 'onboarding', 'either']);
const DURATION_ACTIONS = Object.freeze(['mute', 'jail', 'ban']);
const MAX_RULES = 25;
const MAX_REASON = 200;
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
const COMPLETED = GuildMemberFlags.CompletedOnboarding;

const DONE_TTL_MS = 5 * 60_000; // a role grant is handled once in this time, whatever the events that repeat it
const DRAIN_GAP_MS = 1000; // at least this long between two members who waited in line

// ---- Rules -----------------------------------------------------------------------------------------------------------------------

/**
 * Validates what `add` was given. `role` has `id`, `managed` and the id of the server (`guildId`); `existingRoleIds` are the roles that already have a rule.
 * Returns `{ ok: true, rule }` or `{ ok: false, error }` (the last part of `automation.roletrigger.error.<error>`).
 */
function validateRule({ role, guildId, action, duration = null, reason = null, on = 'role_added', existingRoleIds = [] }) {
  if (!role) return { ok: false, error: 'noRole' };
  if (role.id === guildId) return { ok: false, error: 'everyone' };
  if (role.managed) return { ok: false, error: 'managed' };
  if (!ACTIONS.includes(action)) return { ok: false, error: 'badAction' };
  if (!TRIGGERS.includes(on)) return { ok: false, error: 'badOn' };
  if (!existingRoleIds.includes(role.id) && existingRoleIds.length >= MAX_RULES) return { ok: false, error: 'tooMany' };
  let durationMs = null;
  if (duration) {
    if (!DURATION_ACTIONS.includes(action)) return { ok: false, error: 'noDuration' };
    durationMs = parseDuration(duration);
    if (!durationMs) return { ok: false, error: 'badDuration' };
    if (action === 'mute' && durationMs > MAX_TIMEOUT_MS) return { ok: false, error: 'timeoutCap' };
  }
  const text = reason ? String(reason).trim() : '';
  if (text.length > MAX_REASON) return { ok: false, error: 'reasonLong' };
  return { ok: true, rule: { roleId: role.id, action, durationMs, reason: text || null, on } };
}

/** The rules that a member update fires. `addedRoleIds` and `heldRoleIds` are Sets; `onboardingCompleted` is true when the flag just turned on. */
function matchRules(rules, { addedRoleIds, heldRoleIds, onboardingCompleted = false }) {
  return rules.filter((rule) => {
    const added = addedRoleIds.has(rule.role_id);
    const onboarded = onboardingCompleted && heldRoleIds.has(rule.role_id);
    if (rule.on_event === 'role_added') return added;
    if (rule.on_event === 'onboarding') return onboarded;
    return added || onboarded;
  });
}

/** Whether the onboarding flag went from off to on. Without the old copy of the member it cannot be known, so it is not. */
function onboardingJustCompleted(oldMember, newMember) {
  if (!oldMember || oldMember.partial || oldMember.flags == null || newMember.flags == null) return false;
  return !oldMember.flags.has(COMPLETED) && newMember.flags.has(COMPLETED);
}

/** The roles that the member update gave. Empty when the old copy is not known. */
function addedRoles(oldMember, newMember) {
  const added = new Set();
  if (!oldMember || oldMember.partial || !oldMember.roles?.cache) return added;
  for (const id of newMember.roles.cache.keys()) if (id !== newMember.guild.id && !oldMember.roles.cache.has(id)) added.add(id);
  return added;
}

// ---- Who is never touched --------------------------------------------------------------------------------------------------------

/**
 * Why a member is left alone, or null. Bots, Petto, the owner, the staff (Administrator, Manage Server or a level of the permission groups) and
 * whoever is not below Petto in the roles. `modLevel` is the highest level of the permission groups of the member (0 when none).
 */
function safetySkip(member, me, { modLevel = 0 } = {}) {
  if (member.user?.bot) return 'bot';
  if (me && member.id === me.id) return 'self';
  if (member.guild?.ownerId === member.id) return 'owner';
  if (member.permissions?.has(PermissionFlagsBits.Administrator) || member.permissions?.has(PermissionFlagsBits.ManageGuild)) return 'staff';
  if (modLevel > 0) return 'modRole';
  if (!me) return 'noBot';
  if ((member.roles?.highest?.position ?? 0) >= (me.roles?.highest?.position ?? 0)) return 'hierarchy';
  return null;
}

// ---- What was done (in memory) ---------------------------------------------------------------------------------------------------

/** Remembers `key` for `ttlMs`: `seen` is true when it was already there, and remembers it anyway. */
function createDoneMemory({ ttlMs = DONE_TTL_MS, now = Date.now } = {}) {
  const entries = new Map();
  return {
    seen(key) {
      const time = now();
      if (entries.size > 500) for (const [k, until] of entries) if (until <= time) entries.delete(k);
      const until = entries.get(key);
      if (until && until > time) return true;
      entries.set(key, time + ttlMs);
      return false;
    },
    clear: () => entries.clear(),
    get size() { return entries.size; },
  };
}

const done = createDoneMemory();
const clock = { now: () => Date.now() }; // a check can move the time
const breaker = createBreaker({ now: () => clock.now() });

// ---- The actions -----------------------------------------------------------------------------------------------------------------

// i18n-ignore: saved as the reason of the case in English, like the other automatic reasons; caseFormat.displayReason translates it when shown
const reasonOf = (roleName, rule) => `Role trigger: ${roleName}${rule.reason ? ` - ${rule.reason}` : ''}`;

/** Runs the action of a rule on a member. Returns a short word for the log: the action done, or why nothing happened. */
async function applyRule(member, rule, role) {
  const { guild, client } = member;
  const lang = await guildLanguage(guild.id);
  const reason = reasonOf(role?.name ?? rule.role_id, rule);
  const auditReason = displayReason(reason, lang).slice(0, 512);
  const source = 'roletrigger';
  const record = async (type, { expiresAt = null, duration } = {}) => {
    const modCase = await createCase({ guildId: guild.id, userId: member.id, moderatorId: client.user.id, type, reason, expiresAt, source });
    await logSanction(client, guild, { modCase, target: member.user, moderator: client.user, reason, duration, source });
    return modCase;
  };
  const durationMs = Number(rule.duration_ms) || null;
  const duration = durationMs ? formatDuration(durationMs, lang) : undefined;
  await ensureGuild(guild.id);

  switch (rule.action) {
    case 'warn': {
      const { modCase, warnCount } = await addWarn({ guildId: guild.id, userId: member.id, moderatorId: client.user.id, reason, source });
      await logSanction(client, guild, { modCase, target: member.user, moderator: client.user, reason, source });
      await sendDm(member, await sanctionDM({ type: 'warn', guild, client, reason, member, source, caseNumber: modCase.case_number })).catch(() => {});
      await checkAndApplyEscalation(client, guild, member, warnCount).catch((err) => logger.error('Role trigger: escalation check failed:', err)); // i18n-ignore: log
      return 'warn';
    }
    case 'kick': {
      await sendDm(member, await sanctionDM({ type: 'kick', guild, client, reason, member, source })).catch(() => {});
      await member.kick(auditReason);
      await record('kick');
      return 'kick';
    }
    case 'ban': {
      const type = durationMs ? 'tempban' : 'ban';
      await sendDm(member, await sanctionDM({ type, guild, client, reason, duration, member, source })).catch(() => {});
      await guild.members.ban(member.id, { reason: auditReason });
      await record(type, { expiresAt: durationMs ? new Date(Date.now() + durationMs).toISOString() : null, duration });
      return type;
    }
    case 'mute': {
      if (durationMs) {
        await member.timeout(durationMs, auditReason);
        const modCase = await record('tempmute', { expiresAt: new Date(Date.now() + durationMs).toISOString(), duration });
        await sendDm(member, await sanctionDM({ type: 'tempmute', guild, client, reason, duration, member, source, caseNumber: modCase.case_number })).catch(() => {});
        return 'tempmute';
      }
      const muteRole = await ensureMuteRole(guild, await ensureGuild(guild.id));
      await member.roles.add(muteRole, auditReason);
      const modCase = await record('mute');
      await sendDm(member, await sanctionDM({ type: 'mute', guild, client, reason, member, source, caseNumber: modCase.case_number })).catch(() => {});
      return 'mute';
    }
    case 'jail': {
      try {
        const { modCase } = await jailMember({ guild, member, moderator: client.user, reason, durationMs });
        await logSanction(client, guild, { modCase, target: member.user, moderator: client.user, reason, duration, source });
        await sendDm(member, await sanctionDM({ type: 'jail', guild, client, reason, duration, member, source, caseNumber: modCase.case_number })).catch(() => {});
        return 'jail';
      } catch (err) {
        if (err instanceof JailError) return `jail skipped: ${err.message}`; // i18n-ignore: log word
        throw err;
      }
    }
    case 'remove_role': {
      if (role && !role.editable) return 'remove_role skipped: the role is above Petto'; // i18n-ignore: log word
      await member.roles.remove(rule.role_id, auditReason);
      return 'remove_role';
    }
    default:
      return `unknown action ${rule.action}`; // i18n-ignore: log word
  }
}

/** The limit of a server: the one its admins chose, or the default for its size. */
async function limitFor(guild) {
  const chosen = await roleTriggersDb.getLimit(guild.id).catch(() => null);
  return validLimit(chosen) ? chosen : defaultLimit(guild.memberCount);
}

const sendAutomodLog = (client, guild, embed) => require('../logging/engine').sendLog(client, guild.id, 'automod', embed).catch((err) => logger.warn(`Role triggers: could not warn the log of guild ${guild.id}: ${err.message}`)); // i18n-ignore: log

/** Tells the staff once, in the log of the server, that the rules stopped (and, when the pause ends, whom they did not look at). */
async function warnBreaker(client, guild, limit) {
  const lang = await guildLanguage(guild.id);
  const minutes = BREAKER_PAUSE_MS / 60_000;
  const embed = {
    title: t(lang, 'automation.roletrigger.alert.breaker.title'),
    description: t(lang, 'automation.roletrigger.alert.breaker.description', { minutes }),
    color: 0xff6b6b,
    fields: [
      { name: t(lang, 'automation.roletrigger.alert.limit'), value: t(lang, 'automation.roletrigger.alert.limitValue', { limit }), inline: true },
      { name: t(lang, 'automation.roletrigger.alert.breaker.next'), value: t(lang, 'automation.roletrigger.alert.breaker.nextValue'), inline: true },
      { name: t(lang, 'automation.roletrigger.alert.raid'), value: t(lang, 'automation.roletrigger.alert.raidValue') },
      { name: t(lang, 'automation.roletrigger.alert.breaker.mistake'), value: t(lang, 'automation.roletrigger.alert.breaker.mistakeValue') },
    ],
    timestamp: new Date().toISOString(),
  };
  await sendAutomodLog(client, guild, embed);
  const timer = setTimeout(() => summarizeSkipped(client, guild).catch((err) => logger.warn(`Role triggers: could not tell what the pause skipped in guild ${guild.id}: ${err.message}`)), BREAKER_PAUSE_MS + 1000); // i18n-ignore: log
  timer.unref?.();
}

/** Tells the staff once that the limit was passed and that the rest of the members wait in line. */
async function warnQueue(client, guild, limit) {
  const lang = await guildLanguage(guild.id);
  const embed = {
    title: t(lang, 'automation.roletrigger.alert.queued.title'),
    description: t(lang, 'automation.roletrigger.alert.queued.description', { limit }),
    color: 0xffa94d,
    fields: [
      { name: t(lang, 'automation.roletrigger.alert.limit'), value: t(lang, 'automation.roletrigger.alert.limitValue', { limit }), inline: true },
      { name: t(lang, 'automation.roletrigger.alert.queued.waiting'), value: t(lang, 'automation.roletrigger.alert.queued.waitingValue', { queue: queueCap(limit) }), inline: true },
      { name: t(lang, 'automation.roletrigger.alert.queued.full'), value: t(lang, 'automation.roletrigger.alert.queued.fullValue', { minutes: BREAKER_PAUSE_MS / 60_000 }), inline: true },
      { name: t(lang, 'automation.roletrigger.alert.queued.stop'), value: t(lang, 'automation.roletrigger.alert.queued.stopValue') },
      { name: t(lang, 'automation.roletrigger.alert.raid'), value: t(lang, 'automation.roletrigger.alert.raidValue') },
    ],
    timestamp: new Date().toISOString(),
  };
  await sendAutomodLog(client, guild, embed);
}

/** When the pause is over: who was given a role in the meantime and was not looked at, so the staff can check them by hand. */
async function summarizeSkipped(client, guild) {
  const { ids, count } = breaker.takeSkipped(guild.id);
  if (!count) return;
  const lang = await guildLanguage(guild.id);
  // The mentions go in one field (1024 characters at most): as many whole mentions as fit, then how many more there are.
  let list = '';
  let shown = 0;
  for (const id of ids) {
    const next = `${list}${shown ? ' ' : ''}<@${id}>`;
    if (next.length > 940) break;
    list = next;
    shown += 1;
  }
  if (count > shown) list += ` (+${count - shown})`;
  const embed = {
    title: t(lang, 'automation.roletrigger.alert.skipped.title'),
    description: t(lang, 'automation.roletrigger.alert.skipped.description', { count }),
    color: 0xffa94d,
    fields: [{ name: t(lang, 'automation.roletrigger.alert.skipped.members'), value: list }],
    footer: { text: t(lang, 'automation.roletrigger.alert.skipped.footer') },
    timestamp: new Date().toISOString(),
  };
  await sendAutomodLog(client, guild, embed);
}

// ---- The event -------------------------------------------------------------------------------------------------------------------

/** One member update. Costs nothing (no query) when no role was given and the onboarding did not just finish. */
async function handleMemberUpdate(oldMember, newMember) {
  if (!newMember?.guild || newMember.user?.bot) return;
  const added = addedRoles(oldMember, newMember);
  const onboarded = onboardingJustCompleted(oldMember, newMember);
  if (!added.size && !onboarded) return;

  const { guild } = newMember;
  const rules = await roleTriggersDb.listRules(guild.id);
  if (!rules.length) return;
  const matched = matchRules(rules, { addedRoleIds: added, heldRoleIds: new Set(newMember.roles.cache.keys()), onboardingCompleted: onboarded });
  if (!matched.length) return;

  const me = guild.members.me;
  const level = await getEffectiveLevel(guild.id, newMember).catch(() => 0);
  const skip = safetySkip(newMember, me, { modLevel: level });
  if (skip) {
    logger.info(`Role triggers: skipped ${newMember.id} in guild ${guild.id} (${skip}).`); // i18n-ignore: log
    return;
  }

  const limit = await limitFor(guild);
  for (const rule of matched) {
    if (done.seen(`${guild.id}:${newMember.id}:${rule.role_id}`)) continue;
    const gate = breaker.allow(guild.id, limit, newMember.id, rule.role_id);
    if (gate.queued) {
      // Over the limit: the member waits in line and is handled at the pace of the limit (`drainOne`), checked again first.
      if (gate.startedQueue) await warnQueue(newMember.client, guild, limit);
      scheduleDrain(newMember.client, guild, DRAIN_GAP_MS);
      return;
    }
    if (!gate.allowed) {
      if (gate.tripped) {
        logger.warn(`Role triggers: the line of waiting members is full in guild ${guild.id}; its rules are paused.`); // i18n-ignore: log
        await warnBreaker(newMember.client, guild, limit);
      }
      return;
    }
    const role = guild.roles.cache.get(rule.role_id);
    if (!role) continue;
    await runAction(newMember, rule, role);
    // One sanction per update is enough: the member may be gone (kick, ban) or already held.
    if (['kick', 'ban', 'jail'].includes(rule.action)) return;
  }
}

/** Runs one rule on one member and says so in the log of the process; a failing action never stops the others. */
async function runAction(member, rule, role) {
  try {
    const result = await applyRule(member, rule, role);
    logger.info(`Role triggers: ${result} for ${member.id} in guild ${member.guild.id} (role ${rule.role_id}).`); // i18n-ignore: log
  } catch (err) {
    logger.error(`Role triggers: "${rule.action}" failed for ${member.id} in guild ${member.guild.id}:`, err); // i18n-ignore: log
  }
}

// ---- The line of members over the limit ------------------------------------------------------------------------------------------

const drains = new Map(); // guild id -> the timer that hands out the next member of the line

function scheduleDrain(client, guild, delayMs) {
  if (drains.has(guild.id)) return;
  const timer = setTimeout(() => {
    drains.delete(guild.id);
    drainOne(client, guild).catch((err) => logger.error(`Role triggers: could not handle the line of waiting members in guild ${guild.id}:`, err)); // i18n-ignore: log
  }, delayMs);
  timer.unref?.();
  drains.set(guild.id, timer);
}

/** Hands out the next member of the line when the limit has room, and comes back for the next one; tells the staff whom it left alone when the line is over. */
async function drainOne(client, guildRef) {
  const guild = client?.guilds?.cache?.get?.(guildRef.id) ?? guildRef;
  const limit = await limitFor(guild);
  const { job, waitMs } = breaker.next(guild.id, limit);
  if (job) await runQueued(guild, job);
  if (breaker.queued(guild.id) > 0) scheduleDrain(client, guild, job ? DRAIN_GAP_MS : Math.max(waitMs, DRAIN_GAP_MS));
  else if (!breaker.paused(guild.id) && breaker.pendingSkipped(guild.id) > 0) await summarizeSkipped(client, guild);
}

/**
 * A member who waited in line is looked at again before anything happens: still in the server, still holding the role, the rule still there and not
 * someone who is never touched. Taking the role away or removing the rule stops the line.
 */
async function runQueued(guild, job) {
  const member = await guild.members.fetch(job.who).catch(() => null);
  if (!member || member.user?.bot) return;
  const rules = await roleTriggersDb.listRules(guild.id);
  const rule = rules.find((candidate) => candidate.role_id === job.roleId);
  if (!rule || !member.roles.cache.has(job.roleId)) return;
  const role = guild.roles.cache.get(job.roleId);
  if (!role) return;
  const level = await getEffectiveLevel(guild.id, member).catch(() => 0);
  const skip = safetySkip(member, guild.members.me, { modLevel: level });
  if (skip) {
    logger.info(`Role triggers: skipped ${member.id} in guild ${guild.id} (${skip}).`); // i18n-ignore: log
    return;
  }
  await runAction(member, rule, role);
}

module.exports = {
  ACTIONS, TRIGGERS, DURATION_ACTIONS, MAX_RULES, MAX_REASON, BREAKER_LIMIT, BREAKER_WINDOW_MS, BREAKER_PAUSE_MS, DONE_TTL_MS,
  MIN_LIMIT, MAX_LIMIT, QUEUE_MINUTES, defaultLimit, validLimit, queueCap, limitFor, summarizeSkipped, drainOne,
  validateRule, matchRules, onboardingJustCompleted, addedRoles, safetySkip, createDoneMemory, createBreaker, applyRule, handleMemberUpdate,
  _state: { done, breaker, clock, drains },
};
