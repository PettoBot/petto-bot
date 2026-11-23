// i18n-ignore-file: the words come from the catalog (`ceramos.*`) in the commands and from the website; this holds the rules of buying and wearing banners and name fonts, and of buying a pack.
// What happens when a person buys a banner or a name font, buys a whole pack, or puts a banner or a font on. The balance only ever changes through db/ceramos.ts (one
// statement each); a purchase that cannot be finished gives the ceramos back.
// Written in TypeScript: `npm run build:ts` compiles it over utils/shopBuy.js.
import type { ItemKind } from './shopCatalog';
const badges = require('./profileBadges') as typeof import('./profileBadges');
const catalog = require('./shopCatalog') as typeof import('./shopCatalog');
const walletDb = require('../db/ceramos') as typeof import('../db/ceramos');
const profileDb = require('../db/userProfile') as typeof import('../db/userProfile');
const shopDb = require('../db/shop') as typeof import('../db/shop');
const registry = require('./badgeRegistry') as typeof import('./badgeRegistry');
const view = require('./profileView') as typeof import('./profileView');

type Reason = 'unknown' | 'owned' | 'poor' | 'closed' | 'plan';
export type BuyItemResult = { ok: true; balance: number; price: number } | { ok: false; reason: Reason; balance: number; price: number };

/** What a person has of banners and fonts, as `kind:id` keys. */
export async function ownedKeys(userId: string): Promise<Set<string>> {
  return new Set((await shopDb.getUserItems(userId)).map((row) => `${row.kind}:${row.id}`));
}

/** Buys a banner or a name font once: it is kept for good, and the ceramos are spent only if the person did not have it. */
export async function buyItem(userId: string, kind: ItemKind, id: string, now: Date = new Date()): Promise<BuyItemResult> {
  await registry.ensure();
  const wallet = await walletDb.getWallet(userId);
  const item = catalog.itemById(kind, id);
  if (!item || !item.hasFile) return { ok: false, reason: 'unknown', balance: wallet.balance, price: 0 };
  const price = catalog.priceOf(item);
  if ((await ownedKeys(userId)).has(`${kind}:${id}`)) return { ok: false, reason: 'owned', balance: wallet.balance, price };
  if (!badges.onSale(item, now)) return { ok: false, reason: 'closed', balance: wallet.balance, price };
  if (!badges.planAllows(item, await view.planOfUser(userId))) return { ok: false, reason: 'plan', balance: wallet.balance, price };
  let balance = wallet.balance;
  if (price > 0) {
    const left = await walletDb.spend(userId, price, kind, id);
    if (left === null) return { ok: false, reason: 'poor', balance: wallet.balance, price };
    balance = left;
  }
  const added = await shopDb.addUserItem(userId, kind, id, price > 0 ? 'shop' : 'free');
  if (!added) { // another purchase of the same piece won the race: the ceramos come back
    const back = price > 0 ? await walletDb.give(userId, price, 'refund', `${kind}:${id}`) : balance;
    return { ok: false, reason: 'owned', balance: back, price };
  }
  return { ok: true, balance, price };
}

export type BuyPackResult = { ok: true; balance: number; price: number; added: number } | { ok: false; reason: Reason | 'nothing'; balance: number; price: number };

/** Buys a whole pack: every piece the person does not have yet, for the price of the pack (or the sum of those pieces if that is cheaper). */
export async function buyPack(userId: string, packId: string, now: Date = new Date()): Promise<BuyPackResult> {
  await registry.ensure();
  const wallet = await walletDb.getWallet(userId);
  const pack = badges.packById(packId);
  if (!pack) return { ok: false, reason: 'unknown', balance: wallet.balance, price: 0 };
  if (!badges.onSale(pack, now)) return { ok: false, reason: 'closed', balance: wallet.balance, price: 0 };
  const plan = await view.planOfUser(userId);
  if (!badges.planAllows(pack, plan)) return { ok: false, reason: 'plan', balance: wallet.balance, price: 0 };
  const have = new Set<string>([...await ownedKeys(userId), ...(await profileDb.getBadgeRows(userId)).map((row) => row.id)]);
  const summary = catalog.packSummary(packId, have, plan, now);
  if (!summary || !summary.missing.length) return { ok: false, reason: 'nothing', balance: wallet.balance, price: summary?.price ?? 0 };
  const price = summary.price;
  let balance = wallet.balance;
  if (price > 0) {
    const left = await walletDb.spend(userId, price, 'pack', packId);
    if (left === null) return { ok: false, reason: 'poor', balance: wallet.balance, price };
    balance = left;
  }
  try {
    for (const key of summary.missing) {
      if (pack.kind === 'badge') await profileDb.addBadge(userId, key, 'shop');
      else await shopDb.addUserItem(userId, pack.kind as ItemKind, key.slice(key.indexOf(':') + 1), 'pack');
    }
  } catch (error) { // a piece could not be saved: the ceramos come back and the person can try again
    if (price > 0) await walletDb.give(userId, price, 'refund', packId);
    throw error;
  }
  return { ok: true, balance, price, added: summary.missing.length };
}

export type WearResult = { ok: true; id: string | null } | { ok: false; reason: 'unknown' | 'notOwned' };

/** Puts a banner or a name font on (an id), or takes it off (null: the banner of Discord and the font of the profile come back). It has to be the person's own. */
export async function wear(userId: string, kind: ItemKind, id: string | null): Promise<WearResult> {
  await registry.ensure();
  if (id !== null) {
    if (!catalog.itemById(kind, id)) return { ok: false, reason: 'unknown' };
    if (!(await ownedKeys(userId)).has(`${kind}:${id}`)) return { ok: false, reason: 'notOwned' };
  }
  await shopDb.setActive(userId, kind, id);
  return { ok: true, id };
}
