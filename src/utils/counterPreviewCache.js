// The preview of the counters of a server for the dashboard (counterRoutes.js) is counted from the caches of discord.js and kept a
// short while per server and language, so the counters page and the read it makes of itself right after are answered at once and a
// big server is not counted again on every page. A change made from the dashboard and every rename of the counter job forget it.

const PREVIEW_TTL_MS = 30_000;
const PREVIEW_LIMIT = 500;
/** @type {Map<string, { at: number, payload: Promise<any> }>} */
const previews = new Map();

/**
 * The kept preview of `guildId` in `lang`, or a new one from `build` (callers that ask at the same time share one count).
 * @param {string} guildId
 * @param {string} lang
 * @param {() => Promise<any>} build
 * @param {number} [now]
 */
function keptPreview(guildId, lang, build, now = Date.now()) {
  const key = `${guildId}:${lang}`;
  const hit = previews.get(key);
  if (hit && now - hit.at < PREVIEW_TTL_MS) return hit.payload;
  const payload = build();
  previews.set(key, { at: now, payload });
  // A count that failed is not kept.
  payload.catch(() => { if (previews.get(key)?.payload === payload) previews.delete(key); });
  if (previews.size > PREVIEW_LIMIT) {
    for (const [name, item] of previews) if (now - item.at >= PREVIEW_TTL_MS) previews.delete(name);
    if (previews.size > PREVIEW_LIMIT) previews.delete(previews.keys().next().value ?? '');
  }
  return payload;
}

/** @param {string} guildId */
function forgetPreview(guildId) {
  for (const key of [...previews.keys()]) if (key.startsWith(`${guildId}:`)) previews.delete(key);
}

module.exports = { keptPreview, forgetPreview, PREVIEW_TTL_MS };
