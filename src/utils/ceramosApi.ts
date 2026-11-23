// i18n-ignore-file: the answers of the API are codes and numbers; the website writes the words.
// What the page of badges of the website asks the bot: the state of a person (wallet, daily, badges, showcase, plan), the catalog, and the actions (claim, buy, upgrade,
// showcase, identity). It is the same code the commands run (ceramosShop.ts, profileActions.ts), so the website and Discord can never disagree.
// Written in TypeScript: `npm run build:ts` compiles it over utils/ceramosApi.js.
import type { BadgeCategory, BadgeUnlock, Rarity } from './profileBadges';
const rules = require('./ceramos') as typeof import('./ceramos');
const badges = require('./profileBadges') as typeof import('./profileBadges');
const shop = require('./ceramosShop') as typeof import('./ceramosShop');
const actions = require('./profileActions') as typeof import('./profileActions');
const view = require('./profileView') as typeof import('./profileView');
const registry = require('./badgeRegistry') as typeof import('./badgeRegistry');
const walletDb = require('../db/ceramos') as typeof import('../db/ceramos');

export interface CatalogBadge {
  id: string;
  category: BadgeCategory;
  unlock: BadgeUnlock;
  rarity: Rarity | null;
  price: number;
  color: string;
  region: string | null;
  language: string | null;
  /** The name of a badge that has no country or language: the website has it in its own catalog by id. */
  pack: string | null;
  /** The ones of the editor: their words in each language, their days of sale, the plan they ask for, the rule that gives them, and whether they can be bought now. */
  custom: boolean;
  names: Record<string, string> | null;
  saleFrom: string | null;
  saleUntil: string | null;
  planMin: string | null;
  grantRule: string | null;
  onSale: boolean;
  retired: boolean;
  hasArt: boolean;
  version: string | null;
}

/** Everything that is for sale or can be shown: the page draws it with its own words (names from the language, flags from the same open package). */
export async function catalog(): Promise<{ badges: CatalogBadge[]; frames: { id: string; cost: number }[]; rarityPrice: Record<string, number>; daily: Record<string, number>; slots: Record<string, number> }> {
  await registry.ensure();
  const now = new Date();
  return {
    badges: badges.allBadges().map((def) => ({
      id: def.id, category: badges.categoryOf(def), unlock: def.unlock, rarity: def.unlock === 'shop' ? (def.rarity ?? 'common') : null, price: badges.priceOf(def),
      color: def.color, region: def.region ?? null, language: def.language ?? null, pack: def.pack ?? null,
      custom: Boolean(def.custom), names: def.names ?? null, saleFrom: def.saleFrom ?? null, saleUntil: def.saleUntil ?? null, planMin: def.planMin ?? null,
      grantRule: def.grantRule ?? null, onSale: def.unlock === 'shop' ? badges.onSale(def, now) : false, retired: Boolean(def.retired), hasArt: Boolean(def.art), version: def.version ?? null,
    })),
    frames: rules.FRAMES.map((frame) => ({ id: frame.id, cost: frame.cost })),
    rarityPrice: { ...badges.RARITY_PRICE },
    daily: { ...rules.DAILY },
    slots: { ...badges.SHOWCASE_SLOTS },
  };
}

export async function state(userId: string, now: Date = new Date()) {
  const [wallet, profile] = await Promise.all([walletDb.getWallet(userId), view.profileState(userId)]);
  const status = rules.claimStatus(wallet.lastDaily, now);
  return {
    balance: wallet.balance,
    plan: profile.plan,
    daily: { canClaim: status.canClaim, nextAt: status.nextAt.toISOString(), amount: rules.dailyAmount(profile.plan) },
    slots: profile.slots,
    owned: profile.owned.map((id) => ({ id, frame: profile.frames[id] ?? 'normal' })),
    showcase: profile.showcase,
  };
}

export const claim = (userId: string) => view.planOfUser(userId).then((plan) => shop.claimToday(userId, plan));
export const buy = (userId: string, badgeId: string) => shop.buyBadge(userId, badgeId);
export const upgrade = (userId: string, badgeId: string) => shop.upgradeFrame(userId, badgeId);
export const saveShowcase = (userId: string, ids: readonly string[]) => actions.saveShowcase(userId, ids);
export const setIdentity = (userId: string, badgeId: string, enabled: boolean) => actions.setIdentity(userId, badgeId, enabled);
