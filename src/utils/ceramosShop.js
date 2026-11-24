"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimToday = claimToday;
exports.buyBadge = buyBadge;
exports.upgradeFrame = upgradeFrame;
exports.chooseFrame = chooseFrame;
const rules = require('./ceramos');
const badges = require('./profileBadges');
const walletDb = require('../db/ceramos');
const profileDb = require('../db/userProfile');
const registry = require('./badgeRegistry');
const view = require('./profileView');
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
async function buyBadge(userId, badgeId, now = new Date()) {
    await registry.ensure();
    const def = badges.badgeById(badgeId);
    const price = def ? (def.custom ? badges.priceOf(def) : badges.priceOf(def) || rules.BADGE_PRICE) : rules.BADGE_PRICE;
    const wallet = await walletDb.getWallet(userId);
    if (!def || def.unlock !== 'shop')
        return { ok: false, reason: 'unknown', balance: wallet.balance, price };
    const rows = await profileDb.getBadgeRows(userId);
    if (rows.some((row) => row.id === def.id))
        return { ok: false, reason: 'owned', balance: wallet.balance, price };
    // After the sale nobody can get it any more (the ones who have it keep it), and one that asks for a plan is for the people with that plan.
    if (!badges.onSale(def, now))
        return { ok: false, reason: 'closed', balance: wallet.balance, price };
    if (!badges.planAllows(def, await view.planOfUser(userId)))
        return { ok: false, reason: 'plan', balance: wallet.balance, price };
    let balance = wallet.balance;
    if (price > 0) {
        const left = await walletDb.spend(userId, price, 'badge', def.id);
        if (left === null)
            return { ok: false, reason: 'poor', balance: wallet.balance, price };
        balance = left;
    }
    const added = await profileDb.addBadge(userId, def.id, 'shop');
    if (!added) { // another purchase of the same badge won the race: the ceramos come back
        const back = price > 0 ? await walletDb.give(userId, price, 'refund', def.id) : balance;
        return { ok: false, reason: 'owned', balance: back, price };
    }
    return { ok: true, balance, price };
}
/** Gives an owned badge the next frame, one step at a time (normal, bright, divine). The badge of a plan has no frames. */
async function upgradeFrame(userId, badgeId) {
    await registry.ensure();
    const wallet = await walletDb.getWallet(userId);
    const def = badges.badgeById(badgeId);
    if (def?.unlock === 'plan')
        return { ok: false, reason: 'noFrame', balance: wallet.balance, cost: 0 };
    if (def?.grantRule)
        await view.profileState(userId); // a badge given by itself is saved the first time it is looked at, so it can have a frame
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
/**
 * Chooses which frame an owned badge shows, among the ones the person has (the best one it has, and the ones below it): a frame they do not have yet is refused. The
 * best frame stays what it is, so the next purchase still builds on it; buying a new frame shows it. The badge of a plan has no frames.
 */
async function chooseFrame(userId, badgeId, frame) {
    await registry.ensure();
    if (!rules.FRAMES.some((each) => each.id === frame))
        return { ok: false, reason: 'bad_request' };
    const def = badges.badgeById(badgeId);
    if (def?.unlock === 'plan')
        return { ok: false, reason: 'noFrame' };
    if (def?.grantRule)
        await view.profileState(userId); // a badge given by itself is saved the first time it is looked at
    const row = (await profileDb.getBadgeRows(userId)).find((each) => each.id === badgeId);
    if (!def || !row)
        return { ok: false, reason: 'notOwned' };
    if (rules.frameById(frame).level > rules.frameById(row.frame).level)
        return { ok: false, reason: 'notYet' };
    // Choosing the best frame is the same as choosing nothing: it follows the best one the badge gets.
    const changed = await profileDb.setShownFrame(userId, badgeId, row.frame, frame === row.frame ? null : frame);
    return changed ? { ok: true, frame } : { ok: false, reason: 'notOwned' };
}
