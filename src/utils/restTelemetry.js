const logger = require('./logger');

const LOG_COOLDOWN_MS = 60_000;
const ATTACHED = Symbol('pettoRestRateLimitTelemetry');
const lastLoggedAt = new Map();
const suppressedCounts = new Map();

function safeRoute(route) {
  return String(route || 'unknown')
    .replace(/\d{15,25}/g, ':id')
    .slice(0, 160);
}

function routeKey(info) {
  return `${info?.global ? 'global' : info?.scope || 'route'}:${info?.method || 'UNKNOWN'}:${safeRoute(info?.route)}`;
}

function attachRestRateLimitTelemetry(client) {
  if (!client?.rest?.on || client.rest[ATTACHED]) return;
  client.rest[ATTACHED] = true;

  client.rest.on('rateLimited', (info = {}) => {
    const key = routeKey(info);
    const now = Date.now();
    const lastLogged = lastLoggedAt.get(key) || 0;

    if (now - lastLogged < LOG_COOLDOWN_MS) {
      suppressedCounts.set(key, (suppressedCounts.get(key) || 0) + 1);
      return;
    }

    const suppressed = suppressedCounts.get(key) || 0;
    suppressedCounts.delete(key);
    lastLoggedAt.set(key, now);

    const retryAfter = Math.max(0, Number(info.retryAfter) || 0);
    const retrySeconds = (Math.ceil(retryAfter / 100) / 10).toFixed(1);
    const scope = info.global ? 'global' : (info.scope || 'route');
    const suffix = suppressed ? `; ${suppressed} similar event(s) suppressed` : '';

    logger.warn(
      `[Discord REST] ${scope} rate limit on ${String(info.method || 'UNKNOWN').toUpperCase()} ${safeRoute(info.route)}; `
      + `retry after ${retrySeconds}s; bucket limit ${info.limit ?? 'unknown'}${suffix}.`,
    );
  });
}

module.exports = { attachRestRateLimitTelemetry };
