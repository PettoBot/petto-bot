// XP formula (ported from bli): round((a*level^3 + b*level^2 + c*level) * difficulty / rounding) * rounding.
// All five knobs are per-guild config, so servers can flatten or steepen the curve to taste.
function totalXpForLevel(level, config) {
  if (level <= 0) return 0;

  const a = Number(config?.curve_a ?? 1);
  const b = Number(config?.curve_b ?? 50);
  const c = Number(config?.curve_c ?? 100);
  const difficulty = Number(config?.difficulty ?? 2.5);
  const rounding = Number(config?.rounding ?? 50);

  const raw = (a * level ** 3 + b * level ** 2 + c * level) * difficulty;
  if (rounding <= 0) return Math.round(raw);
  return Math.round(raw / rounding) * rounding;
}

function xpNeeded(level, config) {
  return totalXpForLevel(level + 1, config) - totalXpForLevel(level, config);
}

/** Given a total xp count, returns the level it corresponds to under the current curve (capped at max_level). */
function levelForXp(xp, config) {
  const maxLevel = Number(config?.max_level ?? 1000);
  let level = 0;
  while (level < maxLevel && xp >= totalXpForLevel(level + 1, config)) level++;
  return level;
}

module.exports = { totalXpForLevel, xpNeeded, levelForXp };
