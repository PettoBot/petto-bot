"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimToday = claimToday;
exports.buyBadge = buyBadge;
exports.upgradeFrame = upgradeFrame;
const rules = require('./ceramos');
const badges = require('./profileBadges');
const walletDb = require('../db/ceramos');
const profileDb = require('../db/userProfile');
/** The daily claim: once for each UTC day, the amount of the plan. Two claims at once give it once (the database decides). */
async function claimToday(userId, plan, now = new Date()) {
    const wallet = await walletDb.getWallet(userId);
    const status = rules.claimStatus(wallet.lastDaily, now);
    if (!status.canClaim)
        return { ok: false, nextAt: status.nextAt };
    const amount = rules.dailyAmount(plan);
    const balance = await walletDb.claimDaily(userId, amount, rules.dayOf(now));
    if (balance === null)
        return { ok: false, nextAt: rules.claimStatus(rules.dayOf(now), now).nextAt };
    return { ok: true, amount, balance };
}
/** Buys a badge of the shop once: it is kept for good, and the ceramos are spent only if the person did not have it. */
async function buyBadge(userId, badgeId) {
    const price = rules.BADGE_PRICE;
    const def = badges.badgeById(badgeId);
    const wallet = await walletDb.getWallet(userId);
    if (!def || def.unlock !== 'shop')
        return { ok: false, reason: 'unknown', balance: wallet.balance, price };
    const rows = await profileDb.getBadgeRows(userId);
    if (rows.some((row) => row.id === def.id))
        return { ok: false, reason: 'owned', balance: wallet.balance, price };
    const balance = await walletDb.spend(userId, price, 'badge', def.id);
    if (balance === null)
        return { ok: false, reason: 'poor', balance: wallet.balance, price };
    const added = await profileDb.addBadge(userId, def.id, 'shop');
    if (!added) { // another purchase of the same badge won the race: the ceramos come back
        const back = await walletDb.give(userId, price, 'refund', def.id);
        return { ok: false, reason: 'owned', balance: back, price };
    }
    return { ok: true, balance, price };
}
/** Gives an owned badge the next frame, one step at a time (normal, bright, divine). The badge of a plan has no frames. */
async function upgradeFrame(userId, badgeId) {
    const wallet = await walletDb.getWallet(userId);
    const def = badges.badgeById(badgeId);
    if (def?.unlock === 'plan')
        return { ok: false, reason: 'noFrame', balance: wallet.balance, cost: 0 };
    const row = (await profileDb.getBadgeRows(userId)).find((each) => each.id === badgeId);
    if (!def || !row)
        return { ok: false, reason: 'notOwned', balance: wallet.balance, cost: 0 };
    const next = rules.nextFrame(row.frame);
    if (!next)
        return { ok: false, reason: 'max', balance: wallet.balance, cost: 0 };
    const balance = await walletDb.spend(userId, next.cost, 'frame', `${def.id}:${next.id}`);
    if (balance === null)
        return { ok: false, reason: 'poor', balance: wallet.balance, cost: next.cost };
    const changed = await profileDb.setFrame(userId, def.id, row.frame, next.id);
    if (!changed) {
        const back = await walletDb.give(userId, next.cost, 'refund', `${def.id}:${next.id}`);
        return { ok: false, reason: 'max', balance: back, cost: next.cost };
    }
    return { ok: true, balance, frame: next.id, cost: next.cost };
}
