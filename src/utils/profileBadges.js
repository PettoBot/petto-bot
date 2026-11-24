"use strict";
// i18n-ignore-file: the catalog of badges; the names a person reads are in the embeds catalog (`profile.badge.<id>`), nothing here is shown as it is.
// The badges of the profile of a person (the image of `/profile`): which exist, how each one is had and how many fit in the showcase.
// Pure rules with no database and no Discord, so scripts/check-profile-card.js tests the same code the command runs.
// Written in TypeScript: `npm run build:ts` compiles it over utils/profileBadges.js.
Object.defineProperty(exports, "__esModule", { value: true });
exports.badgeLabel = exports.priceOf = exports.planBadgeId = exports.slotsFor = exports.MAX_SLOTS = exports.SHOWCASE_SLOTS = exports.isSelfBadge = exports.badgeById = exports.shopBadges = exports.allBadges = exports.packById = exports.allPacks = exports.SHOP_BADGES = exports.BADGES = exports.LANGUAGE_FLAGS = exports.PLAN_KEYS = exports.RARITY_PRICE = void 0;
exports.setCustomBadges = setCustomBadges;
exports.setBadgeChanges = setBadgeChanges;
exports.setPacks = setPacks;
exports.onSale = onSale;
exports.planNeeded = planNeeded;
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
// The shop: countries (with the flag of each one) and languages (with the flag of the country that stands for each), each bought once with ceramos.
const COUNTRY_CODES = ["ad", "ae", "af", "ag", "ai", "al", "am", "ao", "aq", "ar", "as", "at", "au", "aw", "ax", "az", "ba", "bb", "bd", "be", "bf", "bg", "bh", "bi", "bj", "bl", "bm", "bn", "bo", "bq", "br", "bs", "bt", "bv", "bw", "by", "bz", "ca", "cc", "cd", "cf", "cg", "ch", "ci", "ck", "cl", "cm", "cn", "co", "cp", "cr", "cu", "cv", "cw", "cx", "cy", "cz", "de", "dg", "dj", "dk", "dm", "do", "dz", "ec", "ee", "eg", "eh", "er", "es", "et", "fi", "fj", "fk", "fm", "fo", "fr", "ga", "gb", "gd", "ge", "gf", "gg", "gh", "gi", "gl", "gm", "gn", "gp", "gq", "gr", "gs", "gt", "gu", "gw", "gy", "hk", "hm", "hn", "hr", "ht", "hu", "ic", "id", "ie", "il", "im", "in", "io", "iq", "ir", "is", "it", "je", "jm", "jo", "jp", "ke", "kg", "kh", "ki", "km", "kn", "kp", "kr", "kw", "ky", "kz", "la", "lb", "lc", "li", "lk", "lr", "ls", "lt", "lu", "lv", "ly", "ma", "mc", "md", "me", "mf", "mg", "mh", "mk", "ml", "mm", "mn", "mo", "mp", "mq", "mr", "ms", "mt", "mu", "mv", "mw", "mx", "my", "mz", "na", "nc", "ne", "nf", "ng", "ni", "nl", "no", "np", "nr", "nu", "nz", "om", "pa", "pe", "pf", "pg", "ph", "pk", "pl", "pm", "pn", "pr", "ps", "pt", "pw", "py", "qa", "re", "ro", "rs", "ru", "rw", "sa", "sb", "sc", "sd", "se", "sg", "sh", "si", "sj", "sk", "sl", "sm", "sn", "so", "sr", "ss", "st", "sv", "sx", "sy", "sz", "tc", "td", "tf", "tg", "th", "tj", "tk", "tl", "tm", "tn", "to", "tr", "tt", "tv", "tw", "tz", "ua", "ug", "um", "us", "uy", "uz", "va", "vc", "ve", "vg", "vi", "vn", "vu", "wf", "ws", "xk", "ye", "yt", "za", "zm", "zw"];
// The flag drawn on the badge of each language (a country code). A language has no flag of its own, so one country stands for it; changing a pick is a line here.
exports.LANGUAGE_FLAGS = {
    es: 'ES', en: 'GB', pt: 'BR', fr: 'FR', de: 'DE', it: 'IT', ja: 'JP', ko: 'KR', zh: 'CN', ru: 'RU', ar: 'SA', hi: 'IN', tr: 'TR', nl: 'NL', pl: 'PL', sv: 'SE', uk: 'UA', id: 'ID', vi: 'VN', th: 'TH',
};
const LANGUAGE_CODES = ['es', 'en', 'pt', 'fr', 'de', 'it', 'ja', 'ko', 'zh', 'ru', 'ar', 'hi', 'tr', 'nl', 'pl', 'sv', 'uk', 'id', 'vi', 'th'];
const PALETTE = ['#e8794a', '#5a8be0', '#3ea37a', '#c26bd6', '#d9a83a', '#d9483b', '#4fb3c8', '#7a6bd6'];
const colorOf = (code) => PALETTE[(code.charCodeAt(0) * 31 + code.charCodeAt(1)) % PALETTE.length];
const SHOP = [
    ...COUNTRY_CODES.map((code) => ({ id: `country-${code}`, unlock: 'shop', art: null, color: colorOf(code), region: code.toUpperCase(), rarity: 'common' })),
    ...LANGUAGE_CODES.map((code) => ({ id: `lang-${code}`, unlock: 'shop', art: null, color: colorOf(code), language: code, flag: exports.LANGUAGE_FLAGS[code], rarity: 'common' })),
];
// The Bufis: six collectible badges of the shop (their pictures are not made yet: each is drawn as a plain hexagon of its color until the team gives it a picture in the editor of
// badges). Black Friday is only on sale for a few days; whoever buys it keeps it for good.
const BUFIS = [
    { id: 'bufi-normal', unlock: 'shop', art: 'bufi-normal.png', color: '#8a8f98', rarity: 'common', category: 'special' },
    { id: 'bufi-silver', unlock: 'shop', art: 'bufi-silver.png', color: '#b8bcc4', rarity: 'rare', category: 'special' },
    { id: 'bufi-girl', unlock: 'shop', art: 'bufi-girl.png', color: '#ff3d8f', rarity: 'rare', category: 'special' },
    { id: 'bufi-boy', unlock: 'shop', art: 'bufi-boy.png', color: '#1e90ff', rarity: 'rare', category: 'special' },
    { id: 'bufi-bu', unlock: 'shop', art: 'bufi-bu.png', color: '#f4cf3a', rarity: 'epic', category: 'special' },
    { id: 'bufi-black-friday', unlock: 'shop', art: 'bufi-black-friday.png', color: '#2b2b30', rarity: 'epic', category: 'special', saleFrom: '2026-11-20T00:00:00Z', saleUntil: '2026-12-02T00:00:00Z' },
];
exports.BADGES = [...BASE_BADGES, ...SHOP, ...BUFIS];
exports.SHOP_BADGES = SHOP;
// What the team changes while the bot runs: the badges of the editor, the changes to the badges of the code, and the packs. Everything below reads the merged list.
let custom = [];
let changes = new Map();
let packs = new Map();
let merged = exports.BADGES;
let mergedById = new Map(exports.BADGES.map((badge) => [badge.id, badge]));
/** A badge of the code with the changes of the team put over it. The plans never change: their icons are the official ones. */
function withChange(def) {
    const change = def.unlock === 'plan' ? undefined : changes.get(def.id);
    if (!change)
        return def;
    const out = { ...def };
    if (change.names)
        out.names = change.names;
    if (change.color)
        out.color = change.color;
    if (change.rarity)
        out.rarity = change.rarity;
    if (change.price !== undefined && change.price !== null)
        out.price = change.price;
    if (change.pack !== undefined && change.pack !== null)
        out.pack = change.pack;
    if (change.dbArt) {
        out.dbArt = true;
        out.art = 'custom';
    }
    if (change.retired)
        out.retired = true;
    if (change.version)
        out.version = change.version;
    return out;
}
function rebuild() {
    merged = [...exports.BADGES.map(withChange), ...custom];
    mergedById = new Map(merged.map((badge) => [badge.id, badge]));
}
/** Sets the badges made in the editor (utils/badgeRegistry.ts reads them from the database). */
function setCustomBadges(list) {
    custom = list;
    rebuild();
}
/** Sets the changes of the team to the badges of the code, keyed by id. */
function setBadgeChanges(map) {
    changes = map;
    rebuild();
}
/** Sets the packs (the Fablo pack and the ones of the editor). */
function setPacks(list) { packs = new Map(list.map((pack) => [pack.id, pack])); }
const allPacks = () => [...packs.values()];
exports.allPacks = allPacks;
const packById = (id) => (id ? packs.get(id) ?? null : null);
exports.packById = packById;
/** Every badge that exists: the ones of this file (with the changes of the team) and the ones of the editor. */
const allBadges = () => merged;
exports.allBadges = allBadges;
/** The badges that can be bought: the countries and languages, and the ones of the editor that are for sale (even when the sale is not open now). */
const shopBadges = () => merged.filter((badge) => badge.unlock === 'shop');
exports.shopBadges = shopBadges;
/** Whether the sale is open at a moment: not taken off sale, inside its days, and inside the days and the active state of its pack (nothing set is always on sale). */
function onSale(def, now = new Date()) {
    if (def.retired)
        return false;
    const pack = (0, exports.packById)(def.pack);
    if (pack?.retired)
        return false;
    const at = now.getTime();
    for (const part of [def, pack]) {
        if (part?.saleFrom && new Date(part.saleFrom).getTime() > at)
            return false;
        if (part?.saleUntil && new Date(part.saleUntil).getTime() <= at)
            return false;
    }
    return true;
}
/** The plan a piece asks for: the stricter of its own and the one of its pack (null asks for none). */
function planNeeded(def) {
    const own = def.planMin ?? null, fromPack = (0, exports.packById)(def.pack)?.planMin ?? null;
    if (!own || !fromPack)
        return own ?? fromPack;
    return exports.PLAN_KEYS.indexOf(own) >= exports.PLAN_KEYS.indexOf(fromPack) ? own : fromPack;
}
/** Whether a plan is enough for a piece that asks for one (none asks for none). */
function planAllows(def, plan) {
    const needed = planNeeded(def);
    if (!needed)
        return true;
    return plan !== null && exports.PLAN_KEYS.indexOf(plan) >= exports.PLAN_KEYS.indexOf(needed);
}
const badgeById = (id) => mergedById.get(id) ?? null;
exports.badgeById = badgeById;
const isSelfBadge = (id) => mergedById.get(id)?.unlock === 'self';
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
    const owned = new Set(saved.filter((id) => mergedById.has(id) && (0, exports.badgeById)(id)?.unlock !== 'plan'));
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
const priceOf = (def) => (def.unlock === 'shop' && !(0, exports.packById)(def.pack)?.free ? (def.price ?? exports.RARITY_PRICE[def.rarity ?? 'common']) : 0);
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
    if (def.names)
        return def.names[lang] ?? def.names[lang.split('-')[0]] ?? def.names.en ?? def.id;
    try {
        if (def.region)
            return new Intl.DisplayNames([lang], { type: 'region' }).of(def.region) ?? def.region;
        if (def.language)
            return new Intl.DisplayNames([lang], { type: 'language' }).of(def.language) ?? def.language;
    }
    catch { /* an old runtime without names: the code is shown */ }
    return tr(`profiles.badge.${def.id}`);
}
