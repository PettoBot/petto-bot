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
const shopCatalog = require('./shopCatalog') as typeof import('./shopCatalog');
const shopBuy = require('./shopBuy') as typeof import('./shopBuy');
const userPlans = require('./userPlans') as typeof import('./userPlans');
const plansDb = require('../db/userPlans') as typeof import('../db/userPlans');
const rankRules = require('./userRankCard') as typeof import('./userRankCard');
const rankDb = require('../db/userRankCard') as typeof import('../db/userRankCard');
const rankActions = require('./rankCardActions') as typeof import('./rankCardActions');
const designs = require('./cardDesigns') as { getDesign: (id: string) => unknown; designCatalog: () => unknown };

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
  /** Its picture is kept in the database (made in the editor, or a badge of the code the team gave another picture): the website asks the bot for it. */
  dbArt: boolean;
  version: string | null;
}

export interface CatalogItem {
  kind: 'banner' | 'font'; id: string; names: Record<string, string>; pack: string | null; rarity: Rarity; price: number; saleFrom: string | null; saleUntil: string | null;
  planMin: string | null; onSale: boolean; retired: boolean; hasFile: boolean; version: string; credit: string | null;
}
export interface CatalogPack {
  id: string; kind: 'badge' | 'banner' | 'font'; names: Record<string, string>; color: string; free: boolean; price: number | null; fullPrice: number; saleFrom: string | null; saleUntil: string | null;
  planMin: string | null; onSale: boolean; retired: boolean; pieces: string[];
}

/** Everything that is for sale or can be shown: the page draws it with its own words (names from the language, flags from the same open package). */
export async function catalog(): Promise<{ badges: CatalogBadge[]; items: CatalogItem[]; packs: CatalogPack[]; frames: { id: string; cost: number }[]; rarityPrice: Record<string, number>; daily: Record<string, number>; slots: Record<string, number>; plans: Record<string, import('./userPlans').PlanPerks> }> {
  await registry.ensure();
  const now = new Date();
  return {
    badges: badges.allBadges().map((def) => ({
      id: def.id, category: badges.categoryOf(def), unlock: def.unlock, rarity: def.unlock === 'shop' ? (def.rarity ?? 'common') : null, price: badges.priceOf(def),
      color: def.color, region: def.region ?? null, language: def.language ?? null, pack: def.pack ?? null,
      custom: Boolean(def.custom), names: def.names ?? null, saleFrom: def.saleFrom ?? null, saleUntil: def.saleUntil ?? null, planMin: def.planMin ?? null,
      grantRule: def.grantRule ?? null, onSale: def.unlock === 'shop' ? badges.onSale(def, now) : false, retired: Boolean(def.retired), hasArt: Boolean(def.art), dbArt: Boolean(def.custom ? def.art : def.dbArt), version: def.version ?? null,
    })),
    items: shopCatalog.allItems().map((item) => ({
      kind: item.kind, id: item.id, names: item.names, pack: item.pack ?? null, rarity: item.rarity, price: shopCatalog.priceOf(item), saleFrom: item.saleFrom ?? null, saleUntil: item.saleUntil ?? null,
      planMin: item.planMin ?? null, onSale: badges.onSale(item, now), retired: Boolean(item.retired), hasFile: item.hasFile, version: item.version, credit: item.credit ?? null,
    })),
    packs: badges.allPacks().map((pack) => {
      const summary = shopCatalog.packSummary(pack.id, new Set(), null, now);
      return {
        id: pack.id, kind: pack.kind, names: pack.names, color: pack.color, free: pack.free, price: pack.price, fullPrice: summary?.fullPrice ?? 0, saleFrom: pack.saleFrom, saleUntil: pack.saleUntil,
        planMin: pack.planMin, onSale: badges.onSale(pack, now), retired: pack.retired, pieces: summary?.pieces ?? [],
      };
    }),
    frames: rules.FRAMES.map((frame) => ({ id: frame.id, cost: frame.cost })),
    rarityPrice: { ...badges.RARITY_PRICE },
    daily: { ...rules.DAILY },
    slots: { ...badges.SHOWCASE_SLOTS },
    plans: { ...userPlans.PLAN_PERKS },
  };
}

export async function state(userId: string, now: Date = new Date()) {
  const [wallet, profile, planRow] = await Promise.all([walletDb.getWallet(userId), view.profileState(userId), plansDb.getPlan(userId).catch(() => null)]);
  const status = rules.claimStatus(wallet.lastDaily, now);
  return {
    balance: wallet.balance,
    plan: profile.plan,
    daily: { canClaim: status.canClaim, nextAt: status.nextAt.toISOString(), amount: rules.dailyAmount(profile.plan) },
    slots: profile.slots,
    owned: profile.owned.map((id) => ({ id, frame: profile.frames[id] ?? 'normal' })),
    showcase: profile.showcase,
    items: profile.items,
    active: profile.active,
    // The plan in detail for the pages of plans: when it ends, whether it renews and who put it there (the past ones are shown as ended).
    planInfo: planRow ? { plan: planRow.plan, active: planRow.active, endsAt: planRow.endsAt, renews: planRow.renews, source: planRow.source } : null,
  };
}

/** The last movements of the wallet of a person (the page of movements): what happened, how many ceramos, about which badge, banner, font or pack, and when. */
export async function ledger(userId: string, limit = 50) {
  const moves = await walletDb.lastMovements(userId, Math.min(100, Math.max(1, limit)));
  return { movements: moves.map((move) => ({ delta: move.delta, reason: move.reason, ref: move.ref, at: move.createdAt.toISOString() })) };
}

export const claim = (userId: string) => view.planOfUser(userId).then((plan) => shop.claimToday(userId, plan));
export const buy = (userId: string, badgeId: string) => shop.buyBadge(userId, badgeId);
export const upgrade = (userId: string, badgeId: string) => shop.upgradeFrame(userId, badgeId);
export const buyItem = (userId: string, kind: 'banner' | 'font', id: string) => shopBuy.buyItem(userId, kind, id);
export const buyPack = (userId: string, id: string) => shopBuy.buyPack(userId, id);
export const wear = (userId: string, kind: 'banner' | 'font', id: string | null) => shopBuy.wear(userId, kind, id);
export const saveShowcase = (userId: string, ids: readonly string[]) => actions.saveShowcase(userId, ids);
export const setIdentity = (userId: string, badgeId: string, enabled: boolean) => actions.setIdentity(userId, badgeId, enabled);

/** The rank card a person designed (the page "Rank card"): what they saved, what costs ceramos, the fonts and the designs of Petto to choose from, and whether they have a banner on. */
export async function rankCardState(userId: string) {
  const [row, wallet, profile] = await Promise.all([rankDb.getRankCard(userId), walletDb.getWallet(userId), view.profileState(userId)]);
  const settings = rankRules.normalize(row?.settings ?? {}, (id) => Boolean(designs.getDesign(id)));
  return {
    settings,
    gradientPaid: row?.gradientPaid ?? false,
    balance: wallet.balance,
    prices: { ...rankRules.PRICES },
    fonts: [...rankRules.FONTS],
    designs: designs.designCatalog(),
    hasBanner: Boolean(profile.active?.banner),
  };
}

export const rankCardSave = rankActions.save;
export const rankCardReset = (userId: string) => rankDb.resetRankCard(userId);
