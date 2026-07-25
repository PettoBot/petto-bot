const cooldowns = new Map();

/**
 * Simple per-user, per-command cooldown tracker.
 * Returns 0 if the command is usable now, otherwise the remaining ms.
 */
function getRemainingCooldown(commandName, userId, cooldownMs) {
  const key = `${commandName}:${userId}`;
  const last = cooldowns.get(key);
  const now = Date.now();

  if (last && now - last < cooldownMs) {
    return cooldownMs - (now - last);
  }

  cooldowns.set(key, now);
  return 0;
}

module.exports = { getRemainingCooldown };
