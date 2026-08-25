// @ts-check

const ms = require('ms');

/** Parses strings like "10m", "2h", "7d" into milliseconds. Returns null if invalid or non-positive. */
function parseDuration(str) {
  const value = ms(str);
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function formatDuration(msValue) {
  return ms(msValue, { long: true });
}

module.exports = { parseDuration, formatDuration };
