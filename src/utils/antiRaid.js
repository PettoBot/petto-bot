// In-memory sliding window of recent joins per guild — no DB writes on the
// hot path (every member join), matching automodChecks.js's local-only approach.
const joinsByGuild = new Map(); // guildId -> [timestamp, ...]
const burstsByGuild = new Map(); // guildId -> { expiresAt }

/**
 * Records a join and returns the number of joins within the trailing window if
 * that count has reached the threshold (a possible raid), or null otherwise.
 */
function recordJoinAndCheckRaid(guildId, thresholdCount, windowSeconds) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const recent = (joinsByGuild.get(guildId) ?? []).filter((ts) => now - ts < windowMs);
  recent.push(now);
  joinsByGuild.set(guildId, recent);
  if (recent.length < thresholdCount) return null;

  const previous = burstsByGuild.get(guildId);
  const newBurst = !previous || previous.expiresAt <= now;
  burstsByGuild.set(guildId, { expiresAt: now + windowMs });
  return { count: recent.length, newBurst };
}

module.exports = { recordJoinAndCheckRaid };
