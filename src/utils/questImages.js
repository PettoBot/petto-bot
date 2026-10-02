// The pictures of a quest's reward: the Orbs icon for Orbs, and the avatar decoration for a decoration. The Orbs icon is a
// file Petto serves itself (src/web/public/quest-orbs.png, at VERIFY_BASE_URL/assets). A decoration's picture comes from
// Discord's own public product endpoint, which says which preset the quest gives, and from its CDN. Anything that fails
// only means the reward has no picture, the alert is sent all the same.
const config = require('../config');
const logger = require('./logger');

const PRODUCT_URL = 'https://discord.com/api/v10/collectibles-products';
const PRESET_CDN = 'https://cdn.discordapp.com/avatar-decoration-presets';
const TIMEOUT_MS = 6_000;
const HIT_TTL_MS = 6 * 3_600_000;
const MISS_TTL_MS = 10 * 60_000;

const cache = new Map();

/** The Orbs icon of Petto, or null when the bot does not know its own public address. */
function orbsIcon() {
  return config.verifyBaseUrl ? `${config.verifyBaseUrl}/assets/quest-orbs.png` : null;
}

/** The picture of an avatar decoration by the sku of the reward, or null when it has none (a profile effect, for one). */
async function decorationImage(skuId, fetcher = fetch) {
  const sku = String(skuId ?? '');
  if (!/^\d{15,25}$/.test(sku)) return null;
  const known = cache.get(sku);
  if (known && known.until > Date.now()) return known.url;
  let url = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetcher(`${PRODUCT_URL}/${sku}`, { headers: { accept: 'application/json' }, signal: controller.signal });
      if (response.ok) {
        const product = await response.json();
        const item = Array.isArray(product?.items) ? product.items.find((entry) => entry?.type === 0 && /^[a-z0-9_]{8,64}$/i.test(String(entry.asset ?? ''))) : null;
        if (item) url = `${PRESET_CDN}/${item.asset}.png?size=256&passthrough=true`;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    logger.warn(`The picture of a quest reward could not be read: ${error.message}`);
  }
  cache.set(sku, { url, until: Date.now() + (url ? HIT_TTL_MS : MISS_TTL_MS) });
  return url;
}

/** The quest with the pictures of its rewards filled in where the list of quests has none. */
async function withRewardImages(quest, { fetcher } = {}) {
  const rewards = await Promise.all(quest.rewards.map(async (reward) => {
    if (reward.image) return reward;
    if (reward.kind === 'orbs') return { ...reward, image: orbsIcon() };
    if (reward.kind === 'decoration') return { ...reward, image: await decorationImage(reward.sku, fetcher) };
    return reward;
  }));
  return { ...quest, rewards };
}

function clearCache() { cache.clear(); }

module.exports = { orbsIcon, decorationImage, withRewardImages, clearCache };
