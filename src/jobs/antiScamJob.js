// Forgets what the anti scam remembers of old messages, so the memory does not grow.
const { sweep } = require('../utils/antiScamChecks');

function startAntiScamJob() {
  setInterval(() => sweep(), 5 * 60_000).unref?.();
}

module.exports = { startAntiScamJob };
