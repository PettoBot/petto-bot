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

const ACTIONS = Object.freeze(['warn', 'mute', 'jail', 'kick', 'ban', 'remove_role']);
const TRIGGERS = Object.freeze(['role_added', 'onboarding', 'either']);
const DURATION_ACTIONS = Object.freeze(['mute', 'jail', 'ban']);
const MAX_RULES = 25;
const MAX_REASON = 200;
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
const COMPLETED = GuildMemberFlags.CompletedOnboarding;

const DONE_TTL_MS = 5 * 60_000; // a role grant is handled once in this time, whatever the events that repeat it
const BREAKER_LIMIT = 5; // more than this many actions (the default of a small server: see `defaultLimit`)...
const BREAKER_WINDOW_MS = 60_000; // ...in this time in one server...
const BREAKER_PAUSE_MS = 10 * 60_000; // ...stops the rules of that server for this long

/** The default of how many actions a minute a server may have before its rules pause: a bigger server has more going on, and a raid is when the rules are needed. */
function defaultLimit(memberCount) {
  const count = Number(memberCount) || 0;
  if (count >= 25_000) return 40;
  if (count >= 5_000) return 20;
  if (count >= 1_000) return 10;
  return BREAKER_LIMIT;
}
const MIN_LIMIT = 1;
const MAX_LIMIT = 500;
const validLimit = (value) => Number.isInteger(value) && value >= MIN_LIMIT && value <= MAX_LIMIT;

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

/**
 * The circuit breaker: more than `limit` actions in `windowMs` in one server pauses its rules for `pauseMs`. `allow` says whether an action may run now;
 * `tripped` is true once, on the action that stops them (the one to warn the staff about).
 */
function createBreaker({ limit = BREAKER_LIMIT, windowMs = BREAKER_WINDOW_MS, pauseMs = BREAKER_PAUSE_MS, now = Date.now } = {}) {
  const guilds = new Map();
  return {
    allow(guildId, limitOverride, who = null) {
      const time = now();
      const state = guilds.get(guildId) ?? { times: [], pausedUntil: 0, skipped: [] };
      guilds.set(guildId, state);
      const max = validLimit(limitOverride) ? limitOverride : limit;
      if (state.pausedUntil > time) { if (who && state.skipped.length < 50) state.skipped.push(who); state.skippedCount = (state.skippedCount ?? 0) + 1; return { allowed: false, tripped: false }; }
      state.times = state.times.filter((at) => time - at < windowMs);
      if (state.times.length >= max) {
        state.pausedUntil = time + pauseMs;
        state.times = [];
        state.skipped = who ? [who] : [];
        state.skippedCount = 1;
        return { allowed: false, tripped: true };
      }
      state.times.push(time);
      return { allowed: true, tripped: false };
    },
    paused: (guildId) => (guilds.get(guildId)?.pausedUntil ?? 0) > now(),
    /** The members that were left alone during the pause (up to 50 ids, and how many in all); forgets them. */
    takeSkipped(guildId) {
      const state = guilds.get(guildId);
      if (!state) return { ids: [], count: 0 };
      const result = { ids: state.skipped ?? [], count: state.skippedCount ?? 0 };
      state.skipped = [];
      state.skippedCount = 0;
      return result;
    },
    clear: () => guilds.clear(),
  };
}

const done = createDoneMemory();
const breaker = createBreaker();

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
  const embed = { description: t(lang, 'automation.roletrigger.breaker', { limit, minutes: BREAKER_PAUSE_MS / 60_000 }), color: 0xff6b6b, timestamp: new Date().toISOString() };
  await sendAutomodLog(client, guild, embed);
  const timer = setTimeout(() => summarizeSkipped(client, guild).catch((err) => logger.warn(`Role triggers: could not tell what the pause skipped in guild ${guild.id}: ${err.message}`)), BREAKER_PAUSE_MS + 1000); // i18n-ignore: log
  timer.unref?.();
}

/** When the pause is over: who was given a role in the meantime and was not looked at, so the staff can check them by hand. */
async function summarizeSkipped(client, guild) {
  const { ids, count } = breaker.takeSkipped(guild.id);
  if (!count) return;
  const lang = await guildLanguage(guild.id);
  const list = ids.map((id) => `<@${id}>`).join(' ') + (count > ids.length ? ` (+${count - ids.length})` : '');
  const embed = { description: t(lang, 'automation.roletrigger.skipped', { count, minutes: BREAKER_PAUSE_MS / 60_000, list }), color: 0xffa94d, timestamp: new Date().toISOString() };
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
    const gate = breaker.allow(guild.id, limit, newMember.id);
    if (!gate.allowed) {
      if (gate.tripped) {
        logger.warn(`Role triggers: more than ${limit} actions in a minute in guild ${guild.id}; its rules are paused.`); // i18n-ignore: log
        await warnBreaker(newMember.client, guild, limit);
      }
      return;
    }
    const role = guild.roles.cache.get(rule.role_id);
    if (!role) continue;
    try {
      const result = await applyRule(newMember, rule, role);
      logger.info(`Role triggers: ${result} for ${newMember.id} in guild ${guild.id} (role ${rule.role_id}).`); // i18n-ignore: log
    } catch (err) {
      logger.error(`Role triggers: "${rule.action}" failed for ${newMember.id} in guild ${guild.id}:`, err); // i18n-ignore: log
    }
    // One sanction per update is enough: the member may be gone (kick, ban) or already held.
    if (['kick', 'ban', 'jail'].includes(rule.action)) return;
  }
}

module.exports = {
  ACTIONS, TRIGGERS, DURATION_ACTIONS, MAX_RULES, MAX_REASON, BREAKER_LIMIT, BREAKER_WINDOW_MS, BREAKER_PAUSE_MS, DONE_TTL_MS,
  MIN_LIMIT, MAX_LIMIT, defaultLimit, validLimit, limitFor, summarizeSkipped,
  validateRule, matchRules, onboardingJustCompleted, addedRoles, safetySkip, createDoneMemory, createBreaker, applyRule, handleMemberUpdate,
  _state: { done, breaker },
};
