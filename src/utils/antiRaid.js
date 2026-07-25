// In-memory sliding window of recent joins per guild — no DB writes on the
// hot path (every member join), matching automodChecks.js's local-only approach.
const joinsByGuild = new Map(); // guildId -> [timestamp, ...]

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
  return recent.length >= thresholdCount ? recent.length : null;
}

module.exports = { recordJoinAndCheckRaid };
