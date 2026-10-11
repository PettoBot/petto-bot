/**
 * Small in-process cache for configuration that changes rarely.
 * The in-flight map is as important as the TTL: when several events for the
 * same guild arrive together, they share one database request.
 */
function createExpiringCache(ttlMs, { name = null } = {}) {
  // With a `name` and a Redis, a second level keeps the values there too, so a restart starts with the caches warm instead of asking
  // the database for every server at once. Without them it is exactly the cache that was here before.
  const shared = name ? require('./redis') : null;
  const sharedKey = (cacheKey) => `cache:${name}:${cacheKey}`;
  const values = new Map();
  const pending = new Map();
  const versions = new Map();

  async function get(key, loader, { force = false, staleIfError = false } = {}) {
    const cacheKey = String(key);
    const now = Date.now();
    const cached = values.get(cacheKey);
    if (!force && cached && cached.expiresAt > now) return cached.value;

    if (!force && pending.has(cacheKey)) return pending.get(cacheKey);

    const version = versions.get(cacheKey) ?? 0;
    const request = Promise.resolve()
      .then(async () => {
        if (!shared || force) return { value: await loader(), fromShared: false };
        const found = await shared.getJson(sharedKey(cacheKey));
        return found.hit ? { value: found.value, fromShared: true } : { value: await loader(), fromShared: false };
      })
      .then(({ value, fromShared }) => {
        if (shared && !fromShared && (versions.get(cacheKey) ?? 0) === version) shared.setJson(sharedKey(cacheKey), value, ttlMs).catch(() => {});
        // An update can finish while an older read is still in flight. Do not
        // let that stale response overwrite the value written by the update.
        if ((versions.get(cacheKey) ?? 0) === version) {
          values.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
        }
        return value;
      })
      .catch((error) => {
        // During a short database outage, an expired configuration is much safer
        // than making every message/voice tick fail. Force reads still surface
        // the error because callers explicitly asked for fresh data.
        if (!force && staleIfError && cached) {
          cached.expiresAt = Date.now() + Math.min(ttlMs, 5_000);
          return cached.value;
        }
        throw error;
      })
      .finally(() => {
        if (pending.get(cacheKey) === request) pending.delete(cacheKey);
      });

    pending.set(cacheKey, request);
    return request;
  }

  function set(key, value) {
    const cacheKey = String(key);
    versions.set(cacheKey, (versions.get(cacheKey) ?? 0) + 1);
    values.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
    pending.delete(cacheKey);
    if (shared) shared.setJson(sharedKey(cacheKey), value, ttlMs).catch(() => {});
    return value;
  }

  function deleteKey(key) {
    const cacheKey = String(key);
    versions.set(cacheKey, (versions.get(cacheKey) ?? 0) + 1);
    values.delete(cacheKey);
    pending.delete(cacheKey);
    if (shared) shared.del(sharedKey(cacheKey)).catch(() => {});
  }

  function clear() {
    values.clear();
    pending.clear();
    versions.clear();
  }

  return { get, set, delete: deleteKey, clear };
}

module.exports = { createExpiringCache };
