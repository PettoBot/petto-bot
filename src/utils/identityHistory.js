// What a person has shown over time: their names and nicknames. A new value is saved when it differs from the newest one saved,
// each person can turn it off (and clear it), and nothing is saved for bots. Avatars are not kept: a copy of every picture used too much storage.
const history = require('../db/identityHistory');
const logger = require('./logger');

const optOutCache = new Map(); // userId -> { value, until }
const OPT_OUT_TTL_MS = 5 * 60_000;

async function recordingOn(userId, db = history) {
  const hit = optOutCache.get(userId);
  if (hit && hit.until > Date.now()) return !hit.value;
  const out = await db.isOptedOut(userId);
  optOutCache.set(userId, { value: out, until: Date.now() + OPT_OUT_TTL_MS });
  if (optOutCache.size > 5_000) optOutCache.delete(optOutCache.keys().next().value);
  return !out;
}

function forgetOptOut(userId) { optOutCache.delete(userId); }

/** Turns the saving of a person's history on or off. */
async function setRecording(userId, enabled, db = history) {
  await db.setOptOut(userId, !enabled);
  forgetOptOut(userId);
}

/** Deletes what is saved of one kind (or all) for a person. */
function clearHistory(userId, kind = null, db = history) {
  return db.clear(userId, kind);
}

async function save(userId, kind, value, guildId, db) {
  if (!value) return false;
  if ((await db.latest(userId, kind, guildId)) === value) return false;
  await db.add(userId, kind, value, guildId);
  await db.trim(userId, kind, guildId).catch(() => {});
  return true;
}

/** Saves the name a user shows right now (the display name, or the username without one), when it changed. Returns what was saved. */
async function noteUser(user, db = history) {
  if (!user || user.bot || !(await recordingOn(user.id, db))) return [];
  const saved = [];
  try {
    if (await save(user.id, 'name', user.globalName ?? user.username, null, db)) saved.push('name');
  } catch (err) {
    logger.warn(`Could not save the history of ${user.id}: ${err.message}`);
  }
  return saved;
}

/** Saves the nickname a member has in a server, when it changed (a removed nickname is not saved). */
async function noteMember(member, db = history) {
  if (!member?.user || member.user.bot || !member.nickname || !(await recordingOn(member.user.id, db))) return [];
  try {
    return (await save(member.user.id, 'nickname', member.nickname, member.guild.id, db)) ? ['nickname'] : [];
  } catch (err) {
    logger.warn(`Could not save the nickname history of ${member.user.id}: ${err.message}`);
    return [];
  }
}

module.exports = { noteUser, noteMember, recordingOn, forgetOptOut, setRecording, clearHistory };
