"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.creditPack = exports.rankCardReset = exports.rankCardSave = exports.setIdentity = exports.saveShowcase = exports.wear = exports.buyPack = exports.buyItem = exports.upgrade = exports.buy = exports.claim = void 0;
exports.catalog = catalog;
exports.state = state;
exports.ledger = ledger;
exports.rankCardState = rankCardState;
const rules = require('./ceramos');
const badges = require('./profileBadges');
const shop = require('./ceramosShop');
const actions = require('./profileActions');
const view = require('./profileView');
const registry = require('./badgeRegistry');
const walletDb = require('../db/ceramos');
const shopCatalog = require('./shopCatalog');
const shopBuy = require('./shopBuy');
const userPlans = require('./userPlans');
const plansDb = require('../db/userPlans');
const rankRules = require('./userRankCard');
const rankDb = require('../db/userRankCard');
const rankActions = require('./rankCardActions');
const coinPacks = require('./coinPacks');
const coinActions = require('./coinPackActions');
const designs = require('./cardDesigns');
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
        // The packs of ceramos that are sold.
        coinPacks: coinPacks.COIN_PACKS.map((pack) => ({ ...pack })),
    };
}
async function state(userId, now = new Date()) {
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
async function ledger(userId, limit = 50) {
    const moves = await walletDb.lastMovements(userId, Math.min(100, Math.max(1, limit)));
    return { movements: moves.map((move) => ({ delta: move.delta, reason: move.reason, ref: move.ref, at: move.createdAt.toISOString() })) };
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
/** The rank card a person designed (the page "Rank card"): what they saved, what costs ceramos, the fonts and the designs of Petto to choose from, and whether they have a banner on. */
async function rankCardState(userId) {
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
exports.rankCardSave = rankActions.save;
const rankCardReset = (userId) => rankDb.resetRankCard(userId);
exports.rankCardReset = rankCardReset;
exports.creditPack = coinActions.credit;
