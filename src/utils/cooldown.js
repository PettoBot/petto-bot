"use strict";
// Typed source for the per-user, per-command cooldown tracker.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRemainingCooldown = getRemainingCooldown;
const cooldowns = new Map();
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
