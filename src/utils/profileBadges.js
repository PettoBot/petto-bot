"use strict";
// i18n-ignore-file: the catalog of badges; the names a person reads are in the embeds catalog (`profile.badge.<id>`), nothing here is shown as it is.
// The badges of the profile of a person (the image of `/profile`): which exist, how each one is had and how many fit in the showcase.
// Pure rules with no database and no Discord, so scripts/check-profile-card.js tests the same code the command runs.
// Written in TypeScript: `npm run build:ts` compiles it over utils/profileBadges.js.
Object.defineProperty(exports, "__esModule", { value: true });
exports.badgeLabel = exports.priceOf = exports.planBadgeId = exports.slotsFor = exports.MAX_SLOTS = exports.SHOWCASE_SLOTS = exports.isSelfBadge = exports.badgeById = exports.shopBadges = exports.allBadges = exports.SHOP_BADGES = exports.BADGES = exports.PLAN_KEYS = exports.RARITY_PRICE = void 0;
exports.setCustomBadges = setCustomBadges;
exports.onSale = onSale;
exports.planAllows = planAllows;
exports.planOf = planOf;
exports.ownedBadges = ownedBadges;
exports.normalizeShowcase = normalizeShowcase;
exports.categoryOf = categoryOf;
exports.badgeName = badgeName;
/** What each rarity costs in ceramos (a badge of the shop is bought once and kept). */
exports.RARITY_PRICE = { common: 20, rare: 50, epic: 120, legendary: 300 };
exports.PLAN_KEYS = ['bronze', 'silver', 'gold'];
const BASE_BADGES = [
    { id: 'plan-bronze', unlock: 'plan', art: 'plan-bronze.png', color: '#b9792f' },
    { id: 'plan-silver', unlock: 'plan', art: 'plan-silver.png', color: '#b8bcc4' },
    { id: 'plan-gold', unlock: 'plan', art: 'plan-gold.png', color: '#f4cf3a' },
    // The Fablo pack: the free badges everybody can turn on.
    { id: 'furro', unlock: 'self', art: 'furro.png', color: '#8cc7ff', pack: 'fablo' },
    { id: 'boykisser', unlock: 'self', art: 'boykisser.png', color: '#b98cff', pack: 'fablo' },
    { id: 'hetero', unlock: 'self', art: 'hetero.png', color: '#6fb4ff', pack: 'fablo' },
    { id: 'femboy', unlock: 'self', art: 'femboy.png', color: '#ff8fc2', pack: 'fablo' },
];
// The shop: countries (with the flag of each one) and languages, each bought once with ceramos. A language has no art: it is drawn with its code.
const COUNTRY_CODES = ["ad", "ae", "af", "ag", "ai", "al", "am", "ao", "aq", "ar", "as", "at", "au", "aw", "ax", "az", "ba", "bb", "bd", "be", "bf", "bg", "bh", "bi", "bj", "bl", "bm", "bn", "bo", "bq", "br", "bs", "bt", "bv", "bw", "by", "bz", "ca", "cc", "cd", "cf", "cg", "ch", "ci", "ck", "cl", "cm", "cn", "co", "cp", "cr", "cu", "cv", "cw", "cx", "cy", "cz", "de", "dg", "dj", "dk", "dm", "do", "dz", "ec", "ee", "eg", "eh", "er", "es", "et", "fi", "fj", "fk", "fm", "fo", "fr", "ga", "gb", "gd", "ge", "gf", "gg", "gh", "gi", "gl", "gm", "gn", "gp", "gq", "gr", "gs", "gt", "gu", "gw", "gy", "hk", "hm", "hn", "hr", "ht", "hu", "ic", "id", "ie", "il", "im", "in", "io", "iq", "ir", "is", "it", "je", "jm", "jo", "jp", "ke", "kg", "kh", "ki", "km", "kn", "kp", "kr", "kw", "ky", "kz", "la", "lb", "lc", "li", "lk", "lr", "ls", "lt", "lu", "lv", "ly", "ma", "mc", "md", "me", "mf", "mg", "mh", "mk", "ml", "mm", "mn", "mo", "mp", "mq", "mr", "ms", "mt", "mu", "mv", "mw", "mx", "my", "mz", "na", "nc", "ne", "nf", "ng", "ni", "nl", "no", "np", "nr", "nu", "nz", "om", "pa", "pe", "pf", "pg", "ph", "pk", "pl", "pm", "pn", "pr", "ps", "pt", "pw", "py", "qa", "re", "ro", "rs", "ru", "rw", "sa", "sb", "sc", "sd", "se", "sg", "sh", "si", "sj", "sk", "sl", "sm", "sn", "so", "sr", "ss", "st", "sv", "sx", "sy", "sz", "tc", "td", "tf", "tg", "th", "tj", "tk", "tl", "tm", "tn", "to", "tr", "tt", "tv", "tw", "tz", "ua", "ug", "um", "us", "uy", "uz", "va", "vc", "ve", "vg", "vi", "vn", "vu", "wf", "ws", "xk", "ye", "yt", "za", "zm", "zw"];
const LANGUAGE_CODES = ['es', 'en', 'pt', 'fr', 'de', 'it', 'ja', 'ko', 'zh', 'ru', 'ar', 'hi', 'tr', 'nl', 'pl', 'sv', 'uk', 'id', 'vi', 'th'];
const PALETTE = ['#e8794a', '#5a8be0', '#3ea37a', '#c26bd6', '#d9a83a', '#d9483b', '#4fb3c8', '#7a6bd6'];
const colorOf = (code) => PALETTE[(code.charCodeAt(0) * 31 + code.charCodeAt(1)) % PALETTE.length];
const SHOP = [
    ...COUNTRY_CODES.map((code) => ({ id: `country-${code}`, unlock: 'shop', art: null, color: colorOf(code), region: code.toUpperCase(), rarity: 'common' })),
    ...LANGUAGE_CODES.map((code) => ({ id: `lang-${code}`, unlock: 'shop', art: null, color: colorOf(code), language: code, rarity: 'common' })),
];
exports.BADGES = [...BASE_BADGES, ...SHOP];
exports.SHOP_BADGES = SHOP;
const BY_ID = new Map(exports.BADGES.map((badge) => [badge.id, badge]));
let custom = [];
let customById = new Map();
/** Sets the badges made in the editor (utils/badgeRegistry.ts reads them from the database). */
function setCustomBadges(list) {
    custom = list;
    customById = new Map(list.map((badge) => [badge.id, badge]));
}
/** Every badge that exists: the ones of this file and the ones of the editor. */
const allBadges = () => (custom.length ? [...exports.BADGES, ...custom] : exports.BADGES);
exports.allBadges = allBadges;
/** The badges that can be bought: the countries and languages, and the ones of the editor that are for sale (even when the sale is not open now). */
const shopBadges = () => (custom.length ? [...exports.SHOP_BADGES, ...custom.filter((badge) => badge.unlock === 'shop')] : exports.SHOP_BADGES);
exports.shopBadges = shopBadges;
/** Whether the sale is open at a moment (a badge with no dates is always on sale). */
function onSale(def, now = new Date()) {
    if (def.retired)
        return false;
    const at = now.getTime();
    if (def.saleFrom && new Date(def.saleFrom).getTime() > at)
        return false;
    if (def.saleUntil && new Date(def.saleUntil).getTime() <= at)
        return false;
    return true;
}
/** Whether a plan is enough for a badge that asks for one (none asks for none). */
function planAllows(def, plan) {
    if (!def.planMin)
        return true;
    return plan !== null && exports.PLAN_KEYS.indexOf(plan) >= exports.PLAN_KEYS.indexOf(def.planMin);
}
const badgeById = (id) => BY_ID.get(id) ?? customById.get(id) ?? null;
exports.badgeById = badgeById;
const isSelfBadge = (id) => BY_ID.get(id)?.unlock === 'self';
exports.isSelfBadge = isSelfBadge;
/** How many badges the showcase of the profile holds, by plan: one with no plan, then 2, 4 and 6. */
exports.SHOWCASE_SLOTS = { none: 1, bronze: 2, silver: 4, gold: 6 };
exports.MAX_SLOTS = 6;
/** The plan a `plan_key` of the database stands for, or null when it is not one of the three plans of a person (the Premium of a server is another thing). */
function planOf(planKey) {
    const key = String(planKey ?? '').toLowerCase();
    return exports.PLAN_KEYS.includes(key) ? key : null;
}
const slotsFor = (plan) => exports.SHOWCASE_SLOTS[plan ?? 'none'];
exports.slotsFor = slotsFor;
/** The badge of a plan, which is always owned while the plan is active. */
const planBadgeId = (plan) => `plan-${plan}`;
exports.planBadgeId = planBadgeId;
/** What a person owns: what they have saved plus the badge of their plan. */
function ownedBadges(saved, plan) {
    const owned = new Set(saved.filter((id) => (BY_ID.has(id) || customById.has(id)) && (0, exports.badgeById)(id)?.unlock !== 'plan'));
    if (plan)
        owned.add((0, exports.planBadgeId)(plan));
    return [...owned];
}
/** The list a person chose, cut to what they own and what fits: no repeats, no badge they do not have, at most `slots`. */
function normalizeShowcase(chosen, owned, slots) {
    const have = new Set(owned);
    const out = [];
    for (const id of chosen) {
        if (out.length >= Math.max(0, Math.min(slots, exports.MAX_SLOTS)))
            break;
        if (have.has(id) && !out.includes(id))
            out.push(id);
    }
    return out;
}
/** What a badge of the shop costs (0 for a badge that is not for sale). */
const priceOf = (def) => (def.unlock === 'shop' ? (def.price ?? exports.RARITY_PRICE[def.rarity ?? 'common']) : 0);
exports.priceOf = priceOf;
/** The tab a badge belongs to. */
function categoryOf(def) {
    if (def.category)
        return def.category;
    if (def.unlock === 'plan')
        return 'plan';
    if (def.region)
        return 'country';
    if (def.language)
        return 'language';
    return def.pack === 'fablo' ? 'fablo' : 'status';
}
/** The text drawn on a badge that has no art: the code of its country or language. */
const badgeLabel = (def) => (def.region ?? def.language ?? '').toUpperCase();
exports.badgeLabel = badgeLabel;
/** The name of a badge in a language: a country or a language by the name the language gives it, the rest from the catalog (`tr`). */
function badgeName(lang, def, tr) {
    try {
        if (def.region)
            return new Intl.DisplayNames([lang], { type: 'region' }).of(def.region) ?? def.region;
        if (def.language)
            return new Intl.DisplayNames([lang], { type: 'language' }).of(def.language) ?? def.language;
    }
    catch { /* an old runtime without names: the code is shown */ }
    if (def.names)
        return def.names[lang] ?? def.names[lang.split('-')[0]] ?? def.names.en ?? def.id;
    return tr(`profiles.badge.${def.id}`);
}
