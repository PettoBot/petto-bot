"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setIdentity = exports.saveShowcase = exports.upgrade = exports.buy = exports.claim = void 0;
exports.catalog = catalog;
exports.state = state;
const rules = require('./ceramos');
const badges = require('./profileBadges');
const shop = require('./ceramosShop');
const actions = require('./profileActions');
const view = require('./profileView');
const walletDb = require('../db/ceramos');
/** Everything that is for sale or can be shown: the page draws it with its own words (names from the language, flags from the same open package). */
function catalog() {
    return {
        badges: badges.BADGES.map((def) => ({
            id: def.id, category: badges.categoryOf(def), unlock: def.unlock, rarity: def.unlock === 'shop' ? (def.rarity ?? 'common') : null, price: badges.priceOf(def),
            color: def.color, region: def.region ?? null, language: def.language ?? null, pack: def.pack ?? null,
        })),
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
    };
}
const claim = (userId) => view.planOfUser(userId).then((plan) => shop.claimToday(userId, plan));
exports.claim = claim;
const buy = (userId, badgeId) => shop.buyBadge(userId, badgeId);
exports.buy = buy;
const upgrade = (userId, badgeId) => shop.upgradeFrame(userId, badgeId);
exports.upgrade = upgrade;
const saveShowcase = (userId, ids) => actions.saveShowcase(userId, ids);
exports.saveShowcase = saveShowcase;
const setIdentity = (userId, badgeId, enabled) => actions.setIdentity(userId, badgeId, enabled);
exports.setIdentity = setIdentity;
