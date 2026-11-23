// i18n-ignore-file: the words come from the catalog (`ceramos.*`) in the commands; this holds the rules of buying, upgrading and claiming.
// What happens when a person claims their daily ceramos, buys a badge of the shop or gives a badge a better frame. The balance only ever changes through
// db/ceramos.ts (one statement each); here a purchase that cannot be finished gives the ceramos back.
// Written in TypeScript: `npm run build:ts` compiles it over utils/ceramosShop.js.
import type { PlanKey } from './profileBadges';
const rules = require('./ceramos') as typeof import('./ceramos');
const badges = require('./profileBadges') as typeof import('./profileBadges');
const walletDb = require('../db/ceramos') as typeof import('../db/ceramos');
const profileDb = require('../db/userProfile') as typeof import('../db/userProfile');

export type ClaimResult = { ok: true; amount: number; balance: number } | { ok: false; nextAt: Date };

/** The daily claim: once for each UTC day, the amount of the plan. Two claims at once give it once (the database decides). */
export async function claimToday(userId: string, plan: PlanKey | null, now: Date = new Date()): Promise<ClaimResult> {
  const wallet = await walletDb.getWallet(userId);
  const status = rules.claimStatus(wallet.lastDaily, now);
  if (!status.canClaim) return { ok: false, nextAt: status.nextAt };
  const amount = rules.dailyAmount(plan);
  const balance = await walletDb.claimDaily(userId, amount, rules.dayOf(now));
  if (balance === null) return { ok: false, nextAt: rules.claimStatus(rules.dayOf(now), now).nextAt };
  return { ok: true, amount, balance };
}

export type BuyResult = { ok: true; balance: number; price: number } | { ok: false; reason: 'unknown' | 'owned' | 'poor'; balance: number; price: number };

/** Buys a badge of the shop once: it is kept for good, and the ceramos are spent only if the person did not have it. */
export async function buyBadge(userId: string, badgeId: string): Promise<BuyResult> {
  const price = rules.BADGE_PRICE;
  const def = badges.badgeById(badgeId);
  const wallet = await walletDb.getWallet(userId);
  if (!def || def.unlock !== 'shop') return { ok: false, reason: 'unknown', balance: wallet.balance, price };
  const rows = await profileDb.getBadgeRows(userId);
  if (rows.some((row) => row.id === def.id)) return { ok: false, reason: 'owned', balance: wallet.balance, price };
  const balance = await walletDb.spend(userId, price, 'badge', def.id);
  if (balance === null) return { ok: false, reason: 'poor', balance: wallet.balance, price };
  const added = await profileDb.addBadge(userId, def.id, 'shop');
  if (!added) { // another purchase of the same badge won the race: the ceramos come back
    const back = await walletDb.give(userId, price, 'refund', def.id);
    return { ok: false, reason: 'owned', balance: back, price };
  }
  return { ok: true, balance, price };
}

export type UpgradeResult =
  | { ok: true; balance: number; frame: string; cost: number }
  | { ok: false; reason: 'notOwned' | 'noFrame' | 'max' | 'poor'; balance: number; cost: number };

/** Gives an owned badge the next frame, one step at a time (normal, bright, divine). The badge of a plan has no frames. */
export async function upgradeFrame(userId: string, badgeId: string): Promise<UpgradeResult> {
  const wallet = await walletDb.getWallet(userId);
  const def = badges.badgeById(badgeId);
  if (def?.unlock === 'plan') return { ok: false, reason: 'noFrame', balance: wallet.balance, cost: 0 };
  const row = (await profileDb.getBadgeRows(userId)).find((each) => each.id === badgeId);
  if (!def || !row) return { ok: false, reason: 'notOwned', balance: wallet.balance, cost: 0 };
  const next = rules.nextFrame(row.frame);
  if (!next) return { ok: false, reason: 'max', balance: wallet.balance, cost: 0 };
  const balance = await walletDb.spend(userId, next.cost, 'frame', `${def.id}:${next.id}`);
  if (balance === null) return { ok: false, reason: 'poor', balance: wallet.balance, cost: next.cost };
  const changed = await profileDb.setFrame(userId, def.id, row.frame, next.id);
  if (!changed) {
    const back = await walletDb.give(userId, next.cost, 'refund', `${def.id}:${next.id}`);
    return { ok: false, reason: 'max', balance: back, cost: next.cost };
  }
  return { ok: true, balance, frame: next.id, cost: next.cost };
}
