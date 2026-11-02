// A role that a server chose in a Petto setting (verification, join roles, reaction roles, level rewards...) and then deleted. Discord answers
// "Unknown Role" (10011) when Petto tries to give it. That is the server's setting, not a bug of Petto, so Petto does not fail the whole action:
//   - `addRoles` gives the roles that still exist (one by one when the group was refused) and says which ones are gone;
//   - `reportDeadRoles` tells the staff of the server in its own log channel, once per role per day, and, only when the staff could be told,
//     takes the dead role out of the setting so nothing keeps failing. Nothing is deleted without that note.
// The general triage (utils/errorTriage.js) counts 10011 as expected, so none of this ever reaches the priority channel.
const { t, guildLanguage } = require('../i18n');
const { EMOJI } = require('./emojis');
const { COLORS } = require('./colors');
const logger = require('./logger');

const UNKNOWN_ROLE = 10011;
const NOT_ABOUT_ONE_ROLE = new Set([UNKNOWN_ROLE, 50028, 50035]); // a group that was refused may hold a dead role: try them one by one
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REMEMBERED = 2_000;

const told = new Map(); // `${guildId}:${kind}:${roleId}` -> when the staff was told

const codeOf = (error) => Number(error?.code ?? error?.rawError?.code);
/** Discord said the role does not exist (any more). */
const isUnknownRole = (error) => codeOf(error) === UNKNOWN_ROLE;
const idOf = (role) => String(role?.id ?? role);

/**
 * Gives a member a role, or a list of roles (ids or roles). When the list is refused because one of them is gone, each one is tried on its own, so
 * the others are still given. Returns { added, dead, failed, error }: the ids given, the ids that do not exist, the ids refused for another reason and that error.
 */
async function addRoles(member, roles, reason) {
  const group = Array.isArray(roles);
  const ids = [...new Set((group ? roles : [roles]).filter(Boolean).map(idOf))];
  const result = { added: [], dead: [], failed: [], error: null };
  if (!ids.length) return result;
  const one = async (id) => {
    try {
      await member.roles.add(id, reason);
      result.added.push(id);
    } catch (error) {
      if (isUnknownRole(error)) result.dead.push(id);
      else { result.failed.push(id); result.error ??= error; }
    }
  };
  // One role is given as one role; a list as a list (as the callers always did), and only a list that Discord refuses is split.
  if (!group) { await one(ids[0]); return result; }
  try {
    await member.roles.add(ids, reason);
    result.added.push(...ids);
    return result;
  } catch (error) {
    if (!NOT_ABOUT_ONE_ROLE.has(codeOf(error))) return { ...result, failed: ids, error };
  }
  for (const id of ids) await one(id);
  return result;
}

/** Whether the server has a log channel for that kind of event (a note to the staff has somewhere to go). */
async function canTellStaff(guildId, event) {
  try {
    const { getLogConfig } = require('../db/logConfig');
    const config = await getLogConfig(guildId);
    return (config?.entries ?? []).some((entry) => entry.event === event && (config.webhooks ?? []).some((hook) => hook.channel_id === entry.channel_id));
  } catch {
    return false;
  }
}

// Where each kind of role is chosen, and what the staff should do. `verification` is the only one that also has its own command.
const KINDS = Object.freeze(['verification', 'gate', 'join', 'reaction', 'button', 'level', 'invite', 'milestone']);
const eventOf = (kind) => (kind === 'verification' || kind === 'gate' ? 'verification' : 'roles');

/** The text of the note for the staff. `outcome`: `removed` (Petto took it out of the setting), `pick` (the staff has to pick it again), `made` (Petto made a new one). */
function noteText(lang, { kind, roleId, outcome, name = '' }) {
  const action = outcome === 'removed' && kind === 'verification' ? 'deadroles.action.verification.removed' : `deadroles.action.${outcome}`;
  return `${t(lang, 'deadroles.body', { role: roleId, where: t(lang, `deadroles.where.${kind}`) })} ${t(lang, action, { name })}`;
}

/**
 * Tells the staff of the server, in its log channel, that a chosen role is gone: once per role and kind in 24 hours (`now` is for the checks).
 * Returns true when the note was sent this time, false when it had already been sent today or there is no log channel for it.
 */
async function tellStaff({ client, guild, kind, roleId, outcome, name, now = Date.now() }) {
  const key = `${guild.id}:${kind}:${roleId}:${outcome}`;
  const last = told.get(key);
  if (last !== undefined && now - last < DAY_MS) return false;
  if (!(await canTellStaff(guild.id, eventOf(kind)))) return false;
  told.set(key, now);
  if (told.size > MAX_REMEMBERED) told.delete(told.keys().next().value);
  try {
    const { sendLog } = require('../logging/engine');
    const lang = await guildLanguage(guild.id);
    await sendLog(client ?? guild.client, guild.id, eventOf(kind), {
      title: t(lang, 'deadroles.title', { emoji: EMOJI.ALERT }),
      description: noteText(lang, { kind, roleId, outcome, name }),
      color: COLORS.YELLOW,
      timestamp: new Date(now).toISOString(),
    });
    return true;
  } catch (error) {
    logger.warn(`Could not tell the staff of ${guild.id} about a deleted role: ${error.message}`);
    return false;
  }
}

/**
 * The roles Discord says are gone. For each one the staff is told (once a day); `forget(roleId)` takes it out of the setting, and it is only
 * called when the staff can be told, so nothing is dropped without a note. Never throws. Returns the ids that were taken out of the setting.
 */
async function reportDeadRoles({ client, guild, kind, roleIds, forget = null, now = Date.now() }) {
  const forgotten = [];
  for (const roleId of [...new Set((roleIds ?? []).map(idOf))]) {
    // Said today and nothing to take out: not asked again for every member who joins or levels up.
    if (!forget && ['pick', 'removed'].some((outcome) => now - (told.get(`${guild.id}:${kind}:${roleId}:${outcome}`) ?? -DAY_MS) < DAY_MS)) continue;
    try {
      const reachable = await canTellStaff(guild.id, eventOf(kind));
      let removed = false;
      if (forget && reachable) {
        await forget(roleId);
        removed = true;
        forgotten.push(roleId);
      }
      await tellStaff({ client, guild, kind, roleId, outcome: removed ? 'removed' : 'pick', now });
    } catch (error) {
      logger.warn(`Could not handle a deleted role in ${guild?.id}: ${error.message}`);
    }
  }
  return forgotten;
}

/**
 * Whether a role of a setting is gone from the server: it is not among its roles (the gateway keeps them up to date). A server that is not loaded
 * never counts: nothing is known about its roles then.
 */
function isGone(guild, roleId) {
  return Boolean(guild) && guild.available !== false && (guild.roles?.cache?.size ?? 0) > 0 && !guild.roles.cache.has(roleId);
}

/** For the check: forget what was told. */
const resetNotes = () => told.clear();

module.exports = { UNKNOWN_ROLE, DAY_MS, KINDS, isUnknownRole, addRoles, canTellStaff, noteText, tellStaff, reportDeadRoles, isGone, resetNotes };
