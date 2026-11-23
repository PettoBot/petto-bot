"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ownedKeys = ownedKeys;
exports.buyItem = buyItem;
exports.buyPack = buyPack;
exports.wear = wear;
const badges = require('./profileBadges');
const catalog = require('./shopCatalog');
const walletDb = require('../db/ceramos');
const profileDb = require('../db/userProfile');
const shopDb = require('../db/shop');
const registry = require('./badgeRegistry');
const view = require('./profileView');
/** What a person has of banners and fonts, as `kind:id` keys. */
async function ownedKeys(userId) {
    return new Set((await shopDb.getUserItems(userId)).map((row) => `${row.kind}:${row.id}`));
}
/** Buys a banner or a name font once: it is kept for good, and the ceramos are spent only if the person did not have it. */
async function buyItem(userId, kind, id, now = new Date()) {
    await registry.ensure();
    const wallet = await walletDb.getWallet(userId);
    const item = catalog.itemById(kind, id);
    if (!item || !item.hasFile)
        return { ok: false, reason: 'unknown', balance: wallet.balance, price: 0 };
    const price = catalog.priceOf(item);
    if ((await ownedKeys(userId)).has(`${kind}:${id}`))
        return { ok: false, reason: 'owned', balance: wallet.balance, price };
    if (!badges.onSale(item, now))
        return { ok: false, reason: 'closed', balance: wallet.balance, price };
    if (!badges.planAllows(item, await view.planOfUser(userId)))
        return { ok: false, reason: 'plan', balance: wallet.balance, price };
    let balance = wallet.balance;
    if (price > 0) {
        const left = await walletDb.spend(userId, price, kind, id);
        if (left === null)
            return { ok: false, reason: 'poor', balance: wallet.balance, price };
        balance = left;
    }
    const added = await shopDb.addUserItem(userId, kind, id, price > 0 ? 'shop' : 'free');
    if (!added) { // another purchase of the same piece won the race: the ceramos come back
        const back = price > 0 ? await walletDb.give(userId, price, 'refund', `${kind}:${id}`) : balance;
        return { ok: false, reason: 'owned', balance: back, price };
    }
    return { ok: true, balance, price };
}
/** Buys a whole pack: every piece the person does not have yet, for the price of the pack (or the sum of those pieces if that is cheaper). */
async function buyPack(userId, packId, now = new Date()) {
    await registry.ensure();
    const wallet = await walletDb.getWallet(userId);
    const pack = badges.packById(packId);
    if (!pack)
        return { ok: false, reason: 'unknown', balance: wallet.balance, price: 0 };
    if (!badges.onSale(pack, now))
        return { ok: false, reason: 'closed', balance: wallet.balance, price: 0 };
    const plan = await view.planOfUser(userId);
    if (!badges.planAllows(pack, plan))
        return { ok: false, reason: 'plan', balance: wallet.balance, price: 0 };
    const have = new Set([...await ownedKeys(userId), ...(await profileDb.getBadgeRows(userId)).map((row) => row.id)]);
    const summary = catalog.packSummary(packId, have, plan, now);
    if (!summary || !summary.missing.length)
        return { ok: false, reason: 'nothing', balance: wallet.balance, price: summary?.price ?? 0 };
    const price = summary.price;
    let balance = wallet.balance;
    if (price > 0) {
        const left = await walletDb.spend(userId, price, 'pack', packId);
        if (left === null)
            return { ok: false, reason: 'poor', balance: wallet.balance, price };
        balance = left;
    }
    try {
        for (const key of summary.missing) {
            if (pack.kind === 'badge')
                await profileDb.addBadge(userId, key, 'shop');
            else
                await shopDb.addUserItem(userId, pack.kind, key.slice(key.indexOf(':') + 1), 'pack');
        }
    }
    catch (error) { // a piece could not be saved: the ceramos come back and the person can try again
        if (price > 0)
            await walletDb.give(userId, price, 'refund', packId);
        throw error;
    }
    return { ok: true, balance, price, added: summary.missing.length };
}
/** Puts a banner or a name font on (an id), or takes it off (null: the banner of Discord and the font of the profile come back). It has to be the person's own. */
async function wear(userId, kind, id) {
    await registry.ensure();
    if (id !== null) {
        if (!catalog.itemById(kind, id))
            return { ok: false, reason: 'unknown' };
        if (!(await ownedKeys(userId)).has(`${kind}:${id}`))
            return { ok: false, reason: 'notOwned' };
    }
    await shopDb.setActive(userId, kind, id);
    return { ok: true, id };
}
