// Typed source for the per-user, per-command cooldown tracker.

type CooldownKey = `${string}:${string}`;

const cooldowns = new Map<CooldownKey, number>();

export function getRemainingCooldown(commandName: string, userId: string, cooldownMs: number): number {
  const key: CooldownKey = `${commandName}:${userId}`;
  const last = cooldowns.get(key);
  const now = Date.now();

  if (last && now - last < cooldownMs) {
    return cooldownMs - (now - last);
  }

  cooldowns.set(key, now);
  return 0;
}
