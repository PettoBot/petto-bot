// What a member's progress looks like in one leveling system (messages or voice), in the shape the variables, the rank
// card and the level-up message read: `ctx.levelData`.
const { totalXpForLevel, xpNeeded } = require('./levelCurve');

/**
 * `userData` is the member's level_users row (or null), `config` the settings of that source (the message settings or
 * `getVoiceConfig(...)`), `rank` and `total` the position and the number of ranked members, `voteBoost` the vote boost
 * the member has in this server (`{ percent, endsAt }`, from `boostFor` in voteBoost.ts) or null. `voteBoostEnabled` says whether the
 * server has the vote boost on: `voteBoost` is null both when the member has none and when the server turned it off, so
 * `voteBoostAvailable` (true only when the boost is on and the member has no active one) is what tells "vote to get it" apart.
 */
function buildLevelData({ config, userData, source = 'messages', rank = null, total = null, voteBoost = null, voteBoostEnabled = false }) {
  const voice = source === 'voice';
  const xp = Number(voice ? userData?.voice_xp ?? 0 : userData?.xp ?? 0);
  const level = Number(voice ? userData?.voice_level ?? 0 : userData?.level ?? 0);
  const needed = xpNeeded(level, config);
  const current = Math.max(0, xp - totalXpForLevel(level, config));
  const progress = needed > 0 ? Math.max(0, Math.min(100, Math.round((current / needed) * 100))) : 100;
  const activeBoost = voteBoost && Number(voteBoost.endsAt) > Date.now() ? { percent: Number(voteBoost.percent), endsAt: Number(voteBoost.endsAt) } : null;
  return {
    source: voice ? 'voice' : 'text',
    level,
    xp,
    xpNeeded: needed,
    xpCurrent: current,
    xpToNext: Math.max(0, needed - current),
    progress,
    rank,
    total,
    streak: Number(userData?.streak ?? 0),
    bestStreak: Number(userData?.best_streak ?? 0),
    messages: Number(userData?.messages ?? 0),
    voiceMinutes: Number(userData?.vc_minutes ?? 0),
    voteBoost: activeBoost,
    voteBoostAvailable: Boolean(voteBoostEnabled) && !activeBoost,
  };
}

module.exports = { buildLevelData };
