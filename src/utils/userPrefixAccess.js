// Who may use a prefix of their own right now, and the prefix to read a message with. The answer for a person is kept for a
// few minutes, so a message does not ask Discord or the database each time.
const config = require('../config');
const userPrefixes = require('../db/userPrefixes');
const { accessReasons } = require('./userPrefixRules');

const TTL_MS = 10 * 60_000;
const answers = new Map(); // userId -> { reasons, expiresAt }

async function supportGuildId(client) {
  if (config.supportGuildId) return config.supportGuildId;
  if (config.premiumGuildId) return config.premiumGuildId;
  const joinLog = await client.channels.fetch(config.opsChannels?.joinLog).catch(() => null);
  return joinLog?.guildId ?? null;
}

async function inTeam(userId) {
  if (String(config.ownerId) === userId || (config.developerIds ?? []).includes(userId)) return true;
  try {
    const { getPrimaryPool } = require('../db/postgres');
    const { rowCount } = await getPrimaryPool().query('select 1 from site_team where user_id = $1 limit 1', [userId]);
    return rowCount > 0;
  } catch {
    return false;
  }
}

async function hasPremium(userId) {
  try {
    const premium = require('../db/premium');
    return (await premium.getUserPremium(userId)).active;
  } catch {
    return false;
  }
}

/** The reasons this person may have their own prefix (an empty list means they may not). */
async function userPrefixReasons(client, userId, { force = false } = {}) {
  const id = String(userId);
  const hit = answers.get(id);
  if (!force && hit && hit.expiresAt > Date.now()) return hit.reasons;

  const guildId = await supportGuildId(client);
  const guild = guildId ? client.guilds.cache.get(guildId) : null;
  const found = guild ? await guild.members.fetch(id).catch(() => null) : null;
  const member = found ? { boosting: Boolean(found.premiumSinceTimestamp), roleIds: [...found.roles.cache.keys()] } : null;
  const reasons = accessReasons({ team: await inTeam(id), premium: await hasPremium(id), member }, config);
  answers.set(id, { reasons, expiresAt: Date.now() + TTL_MS });
  return reasons;
}

/** The prefix to read this person's messages with, or null when they have none or no longer meet the requirements. */
async function activeUserPrefix(client, userId) {
  const prefix = await userPrefixes.get(userId).catch(() => null);
  if (!prefix) return null;
  return (await userPrefixReasons(client, userId)).length ? prefix : null;
}

function forget(userId) {
  answers.delete(String(userId));
}

module.exports = { userPrefixReasons, activeUserPrefix, forget };
