"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setIdentity = exports.saveShowcase = exports.wear = exports.buyPack = exports.buyItem = exports.upgrade = exports.buy = exports.claim = void 0;
exports.catalog = catalog;
exports.state = state;
const rules = require('./ceramos');
const badges = require('./profileBadges');
const shop = require('./ceramosShop');
const actions = require('./profileActions');
const view = require('./profileView');
const registry = require('./badgeRegistry');
const walletDb = require('../db/ceramos');
const shopCatalog = require('./shopCatalog');
const shopBuy = require('./shopBuy');
/** Everything that is for sale or can be shown: the page draws it with its own words (names from the language, flags from the same open package). */
async function catalog() {
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
            planMin: item.planMin ?? null, onSale: badges.onSale(item, now), retired: Boolean(item.retired), hasFile: item.hasFile, version: item.version,
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
    };
}
async function state(userId, now = new Date()) {
    const [wallet, profile] = await Promise.all([walletDb.getWallet(userId), view.profileState(userId)]);
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
    };
}
const claim = (userId) => view.planOfUser(userId).then((plan) => shop.claimToday(userId, plan));
exports.claim = claim;
const buy = (userId, badgeId) => shop.buyBadge(userId, badgeId);
exports.buy = buy;
const upgrade = (userId, badgeId) => shop.upgradeFrame(userId, badgeId);
exports.upgrade = upgrade;
const buyItem = (userId, kind, id) => shopBuy.buyItem(userId, kind, id);
exports.buyItem = buyItem;
const buyPack = (userId, id) => shopBuy.buyPack(userId, id);
exports.buyPack = buyPack;
const wear = (userId, kind, id) => shopBuy.wear(userId, kind, id);
exports.wear = wear;
const saveShowcase = (userId, ids) => actions.saveShowcase(userId, ids);
exports.saveShowcase = saveShowcase;
const setIdentity = (userId, badgeId, enabled) => actions.setIdentity(userId, badgeId, enabled);
exports.setIdentity = setIdentity;
