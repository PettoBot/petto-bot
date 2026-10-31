// The welcome message of a channel (and the second welcome) can wait until the new member has finished the steps the server asks for:
//   - `rules`: the member accepted the rules (Membership Screening: they are `pending` until they do);
//   - `rules_onboarding`: and finished Discord's onboarding too (the CompletedOnboarding flag), but never for longer than a safety limit,
//     because Discord lets members skip the onboarding in some servers and the flag may then never be set: 10 minutes after the rules were
//     accepted, or 30 minutes after the join when the server has no rules to accept.
// `off` (the default) sends the welcome at the join, as it always was. Only the welcome waits: the DM on join, the ping on join, the logs, the
// invites, the join roles and the level bonus never do.
//
// What waits is only a row in join_waiting (guild, member, when, safety limit), so a restart between the join and the end of the steps loses
// nothing. It is taken off the table with a single DELETE, which is also what makes the welcome go out once: whoever gets the row sends. In
// memory there is one number for each server that has someone waiting, so a server where nobody waits costs no query on any event, and one
// timer for the whole bot (jobs/joinGateJob.js) sends the welcomes whose safety limit passed.
const { GuildMemberFlags } = require('discord.js');
const logger = require('./logger');
const { createExpiringCache } = require('./expiringCache');
const memberEvents = require('../db/memberEvents');
const waiting = require('../db/joinWaiting');
const { ensureGuild } = require('../db/guilds');
const { runWithLanguage, peekGuildLanguage } = require('../i18n');

const COMPLETED = GuildMemberFlags.CompletedOnboarding;
const STARTED = GuildMemberFlags.StartedOnboarding;
const BYPASS = GuildMemberFlags.BypassesVerification;
// A member who left and came back, or who is exempt from the verification of the server, is not shown the onboarding again.
const SKIPPED = GuildMemberFlags.DidRejoin | BYPASS;

const AFTER_RULES_MINUTES = 10; // the safety limit once the rules were accepted
const AFTER_JOIN_MINUTES = 30; // and when there were no rules to accept
const ONBOARDING_TTL_MS = 10 * 60_000;
const MAINTENANCE_MS = 60 * 60_000;
const RETRY_LOAD_MS = 30_000;

const flagsOf = (member) => Number(member.flags?.bitfield ?? 0);

// ---- What the server asks of a new member ---------------------------------------------------------------------------------

// Whether Discord's onboarding is on for a server and has something to answer. It is asked of Discord once in a while for each server
// that has a join that waits for it (and forgotten when the audit log says it changed); when Discord does not answer, the server is taken
// as not having it, so nothing is ever held for a step that cannot be seen.
const onboardingCache = createExpiringCache(ONBOARDING_TTL_MS);
async function onboardingOn(guild) {
  try {
    return await onboardingCache.get(guild.id, async () => {
      try {
        const onboarding = await guild.fetchOnboarding();
        return Boolean(onboarding?.enabled) && (onboarding.prompts?.size ?? 0) > 0;
      } catch (error) {
        logger.warn(`Could not read the onboarding of guild ${guild.id}; its welcome does not wait for it: ${error.message}`); // i18n-ignore: a log line for the operator
        return false;
      }
    });
  } catch {
    return false;
  }
}

/** Forgets what is known about the onboarding of a server (it was changed). */
function forgetOnboarding(guildId) {
  onboardingCache.delete(guildId);
}

/** The member has not accepted the rules (Membership Screening). A member the server exempts from verification is not held for it. */
function waitsForRules(member) {
  return member.pending === true && !(flagsOf(member) & BYPASS);
}

/** The member has not finished Discord's onboarding. A member who has started it is shown it; others only when the server has it on. */
async function waitsForOnboarding(member) {
  const flags = flagsOf(member);
  if (flags & COMPLETED) return false;
  if (flags & STARTED) return true;
  if (flags & SKIPPED) return false;
  return onboardingOn(member.guild);
}

/** The member still has a step to finish for this way of waiting. The rules are looked at first, which needs nothing but the member. */
async function stillIncomplete(member, mode) {
  if (waitsForRules(member)) return true;
  return mode === 'rules_onboarding' && waitsForOnboarding(member);
}

/** Whether the server posts a welcome at all. Holding a member for nothing would only fill the table. */
function hasWelcome(settings) {
  return Boolean(settings?.welcome_channel_id || (settings?.welcome_second_enabled && settings?.welcome_second_channel_id));
}

// ---- Who is waiting (in memory: a number for each server) ------------------------------------------------------------------

let counts = null; // guildId -> members waiting; null until read from the table
let loading = null;
let lastTry = 0;
let lastMaintenance = 0;
let addedWhileLoading = null;

function reload() {
  const added = new Set();
  addedWhileLoading = added;
  lastTry = Date.now();
  lastMaintenance = lastTry;
  return (async () => {
    const expired = await waiting.removeExpired();
    const fresh = await waiting.countsByGuild();
    for (const guildId of added) fresh.set(guildId, (fresh.get(guildId) ?? 0) + 1); // members held while the table was being read
    counts = fresh;
    if (expired.length) logger.info(`Welcome: dropped ${expired.length} member(s) who did not finish the steps of their server in ${waiting.WAIT_DAYS} days.`); // i18n-ignore: a log line for the operator
  })()
    .catch((error) => logger.warn(`Welcome: the members who wait could not be read: ${error.message}`)) // i18n-ignore: a log line for the operator
    .finally(() => { loading = null; addedWhileLoading = null; });
}

function startLoad() {
  if (counts !== null || loading || Date.now() - lastTry < RETRY_LOAD_MS) return;
  loading = reload();
}

/** Once an hour: forgets the members past 7 days and puts the numbers right. Called when the table is touched and by the timer. */
function maintain() {
  if (loading || Date.now() - lastMaintenance < MAINTENANCE_MS) return;
  loading = reload();
}

/** Whether somebody may be waiting in this server. True while the table has not been read yet (a restart), so nothing is missed. */
function hasWaiting(guildId) {
  startLoad();
  return counts === null || (counts.get(String(guildId)) ?? 0) > 0;
}

/** Whether somebody may be waiting anywhere. */
function anyWaiting() {
  startLoad();
  return counts === null || counts.size > 0;
}

function bump(guildId, delta) {
  if (delta > 0) addedWhileLoading?.add(guildId);
  if (!counts) return;
  const next = (counts.get(guildId) ?? 0) + delta;
  if (next > 0) counts.set(guildId, next);
  else counts.delete(guildId);
}

// ---- Holding and sending --------------------------------------------------------------------------------------------------

/** Sends the welcomes (the first and the second) of a member, in the language of the server. Each one says nothing when it has no settings. */
async function sendWelcomes(member, { held = false } = {}) {
  const { send } = require('../events/guildMemberAddWelcome');
  await runWithLanguage(peekGuildLanguage(member.guild.id), () => send(member, { held }));
}

/**
 * Sends the welcome of a member who was waiting, when nothing is left to wait for. False when they were not waiting, still have a step,
 * or the welcome is not sent (the server turned the waiting off while they waited: nothing extra is sent, the row is just dropped).
 * `rulesJustAccepted` starts the safety limit of the onboarding when only that is left.
 */
async function releaseIfComplete(member, { rulesJustAccepted = false } = {}) {
  if (member.user?.bot || !member.guild) return false;
  const guildId = member.guild.id;
  if (!hasWaiting(guildId)) return false;
  const settings = await memberEvents.getConfigCached(guildId).catch(() => null);
  const mode = memberEvents.welcomeWait(settings);

  if (mode !== 'off' && await stillIncomplete(member, mode)) {
    if (rulesJustAccepted && !waitsForRules(member)) await waiting.startDue(guildId, member.id, AFTER_RULES_MINUTES);
    return false;
  }
  const row = await waiting.take(guildId, member.id);
  if (!row) return false;
  bump(guildId, -1);
  if (row.expired || mode === 'off') return false;
  await sendWelcomes(member, { held: true });
  return true;
}

/** What to do with a member who has just joined: `send`, `held` or `released` (they finished while being held). Never throws. */
async function decideOnce(member) {
  const guildId = member.guild.id;
  try {
    if (member.user?.bot) return 'send';
    const settings = await memberEvents.getConfigCached(guildId).catch(() => null);
    const mode = memberEvents.welcomeWait(settings);
    if (mode === 'off' || !hasWelcome(settings)) return 'send';
    const rules = waitsForRules(member);
    if (!(rules || (mode === 'rules_onboarding' && await waitsForOnboarding(member)))) return 'send';
    await ensureGuild(guildId);
    // With no rules to accept the safety limit of the onboarding runs from the join; with rules it starts when they are accepted.
    if (await waiting.add(guildId, member.id, rules ? null : AFTER_JOIN_MINUTES)) {
      bump(guildId, 1);
      maintain();
    }
  } catch (error) {
    logger.error(`Welcome: could not hold the welcome of ${member.id} in guild ${guildId}; it is sent now:`, error); // i18n-ignore: a log line for the operator
    return 'send';
  }
  // The member can finish while the row is being written, and no event would come after that: look once more.
  try {
    if (await releaseIfComplete(member)) return 'released';
  } catch (error) {
    logger.warn(`Welcome: ${member.id} in guild ${guildId} is held and could not be looked at again: ${error.message}`); // i18n-ignore: a log line for the operator
  }
  return 'held';
}

// The handlers of a join that ask at the same moment share one answer, and only one row is written.
const deciding = new Map();
function decide(member) {
  const key = `${member.guild.id}:${member.id}`;
  let answer = deciding.get(key);
  if (!answer) {
    answer = decideOnce(member).finally(() => setImmediate(() => deciding.delete(key)));
    deciding.set(key, answer);
  }
  return answer;
}

/** What the welcome handler runs: `send` at once when the member has nothing to finish (or the server does not wait), and nothing now when they are held. */
async function holdOrSend(member, send) {
  if ((await decide(member)) === 'send') return send(member);
  return undefined;
}

// ---- Events and the timer -----------------------------------------------------------------------------------------------------

/** guildMemberUpdate (and guildMemberAvailable, a member Petto did not have in memory, as after a restart): the rules or onboarding may be done. */
async function onMemberChange(oldMember, newMember) {
  if (!newMember?.guild || newMember.user?.bot) return false;
  if (!hasWaiting(newMember.guild.id)) return false;
  // Only a change of the rules or of the onboarding flags can finish a step; a nickname or a role cannot.
  const unknownBefore = !oldMember || oldMember.partial;
  if (!unknownBefore && oldMember.pending === newMember.pending && flagsOf(oldMember) === flagsOf(newMember)) return false;
  return releaseIfComplete(newMember, { rulesJustAccepted: unknownBefore || oldMember.pending === true });
}

/** The member left: whatever waited for them is dropped. */
async function onMemberLeave(member) {
  if (!member?.guild || !hasWaiting(member.guild.id)) return false;
  const row = await waiting.take(member.guild.id, member.id);
  if (row) bump(member.guild.id, -1);
  return Boolean(row);
}

/** The timer: sends the welcomes whose safety limit passed (the onboarding was never finished, or Discord does not set the flag). Answers how many. */
async function sendDue(client) {
  if (!anyWaiting()) return 0;
  const rows = await waiting.takeDue(100);
  let sent = 0;
  for (const { guild_id: guildId, user_id: userId } of rows) {
    bump(guildId, -1);
    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      const settings = await memberEvents.getConfigCached(guildId).catch(() => null);
      if (memberEvents.welcomeWait(settings) === 'off') continue; // the server stopped waiting: nothing extra is sent
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member || member.pending === true) continue; // they left (or have the rules to accept again)
      await sendWelcomes(member, { held: true });
      sent += 1;
    } catch (error) {
      logger.error(`Welcome: could not send the welcome of ${userId} in guild ${guildId} after the safety limit:`, error); // i18n-ignore: a log line for the operator
    }
  }
  return sent;
}

/** For the checks: back to the state of a bot that has just started. */
function resetForTests() {
  counts = null;
  loading = null;
  lastTry = 0;
  lastMaintenance = 0;
  addedWhileLoading = null;
  deciding.clear();
  onboardingCache.clear();
}

module.exports = {
  AFTER_RULES_MINUTES,
  AFTER_JOIN_MINUTES,
  holdOrSend,
  onMemberChange,
  onMemberLeave,
  releaseIfComplete,
  sendDue,
  maintain,
  forgetOnboarding,
  hasWaiting,
  sendWelcomes,
  resetForTests,
};
