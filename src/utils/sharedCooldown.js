// The cooldown of a command for a user: the one in memory (instant) and, when there is a Redis, the shared one that also survives
// a restart. Either can say "wait"; the answer is the longer wait.
const { getRemainingCooldown } = require('./cooldown');
const redis = require('./redis');

async function getRemainingCooldownShared(commandName, userId, cooldownMs) {
  const local = getRemainingCooldown(commandName, userId, cooldownMs);
  if (local > 0) return local;
  return redis.claim(`cooldown:${commandName}:${userId}`, cooldownMs);
}

module.exports = { getRemainingCooldownShared };
