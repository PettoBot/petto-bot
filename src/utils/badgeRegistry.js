"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refresh = refresh;
exports.ensure = ensure;
exports.invalidate = invalidate;
exports.customArt = customArt;
exports.bannerImage = bannerImage;
exports.fontFamily = fontFamily;
exports.setGrantChecker = setGrantChecker;
exports.grantedFor = grantedFor;
exports.useDiscord = useDiscord;
const { loadImage, GlobalFonts } = require('@napi-rs/canvas');
const rules = require('./profileBadges');
const customDb = require('../db/customBadges');
const shopDb = require('../db/shop');
const catalog = require('./shopCatalog');
const FRESH_MS = 60_000;
let loadedAt = 0;
let loading = null;
const art = new Map();
function toDef(row) {
    return {
        id: row.id, custom: true, unlock: row.grantRule ? 'status' : 'shop', art: row.hasImage ? 'custom' : null, color: row.color, names: row.names, category: row.category,
        rarity: row.rarity, price: row.grantRule ? 0 : row.price, saleFrom: row.saleFrom, saleUntil: row.saleUntil, planMin: row.planMin ?? null,
        grantRule: row.grantRule, retired: !row.active, version: row.updatedAt, pack: row.packId ?? undefined, dbArt: row.hasImage,
    };
}
/** Reads the badges of the editor now. A failed read leaves the ones that were there. */
async function refresh() {
    try {
        const [badgeRows, overrides, packRows, itemRows] = await Promise.all([customDb.listCustomBadges(), shopDb.listOverrides(), shopDb.listPacks(), shopDb.listItems()]);
        rules.setPacks(packRows.map((pack) => ({
            id: pack.id, kind: pack.kind, names: pack.names, color: pack.color, price: pack.price, free: pack.free, saleFrom: pack.saleFrom, saleUntil: pack.saleUntil,
            planMin: pack.planMin ?? null, retired: !pack.active,
        })));
        rules.setBadgeChanges(new Map(overrides.map((row) => [row.id, {
                names: row.names, color: row.color, rarity: row.rarity, price: row.price, pack: row.packId, dbArt: row.hasImage, retired: row.active === false ? true : null, version: row.updatedAt,
            }])));
        rules.setCustomBadges(badgeRows.map(toDef));
        catalog.setItems(itemRows.map((row) => ({
            kind: row.kind, id: row.id, names: row.names, rarity: row.rarity, price: row.price, hasFile: row.hasFile, version: row.updatedAt, credit: row.credit,
            saleFrom: row.saleFrom, saleUntil: row.saleUntil, planMin: row.planMin ?? null, retired: !row.active, pack: row.packId ?? undefined,
        })));
        loadedAt = Date.now();
    }
    catch { /* the database could not be read: the badges of the code and the last ones read stay */ }
}
/** Makes sure the badges of the editor are not older than a minute. Many calls at once share one read. */
async function ensure() {
    if (Date.now() - loadedAt < FRESH_MS)
        return;
    loading ??= refresh().finally(() => { loading = null; });
    await loading;
}
/** Forgets what was read: the next call reads again (the team just saved a badge). */
function invalidate() { loadedAt = 0; }
/** The picture of a badge of the editor, or null. Kept until the badge changes. */
async function customArt(def) {
    if (!def.custom && !def.dbArt)
        return null;
    const known = art.get(def.id);
    try {
        const stored = def.custom ? await customDb.getCustomImage(def.id) : await shopDb.getOverrideImage(def.id);
        if (!stored)
            return null;
        if (known && known.updatedAt === stored.updatedAt)
            return known.image;
        const image = await loadImage(stored.bytes);
        if (art.size >= 200)
            art.delete(art.keys().next().value);
        art.set(def.id, { updatedAt: stored.updatedAt, image });
        return image;
    }
    catch {
        return known?.image ?? null;
    }
}
const pictures = new Map();
const fonts = new Map();
/** The picture of a banner of the shop, or null. Kept until the banner changes. */
async function bannerImage(id) {
    const known = pictures.get(id);
    try {
        const stored = await shopDb.getItemFile('banner', id);
        if (!stored)
            return null;
        if (known && known.updatedAt === stored.updatedAt)
            return known.image;
        const image = await loadImage(stored.bytes);
        if (pictures.size >= 30)
            pictures.delete(pictures.keys().next().value);
        pictures.set(id, { updatedAt: stored.updatedAt, image });
        return image;
    }
    catch {
        return known?.image ?? null;
    }
}
/** Makes a name font of the shop ready to draw with and gives the name of its family, or null when the file cannot be used. Registered once until the font changes. */
async function fontFamily(id) {
    const known = fonts.get(id);
    try {
        const stored = await shopDb.getItemFile('font', id);
        if (!stored)
            return null;
        if (known && known.updatedAt === stored.updatedAt)
            return known.family;
        if (known?.key)
            GlobalFonts.remove(known.key);
        const family = `petto-shop-${id}`;
        const key = GlobalFonts.register(stored.bytes, family);
        if (fonts.size >= 60)
            fonts.delete(fonts.keys().next().value);
        fonts.set(id, { updatedAt: stored.updatedAt, family: key ? family : null, key });
        return key ? family : null;
    }
    catch {
        return known?.family ?? null;
    }
}
let checker = null;
function setGrantChecker(fn) { checker = fn; }
async function qualifies(rule, userId) {
    try {
        if (rule === 'voter')
            return await customDb.votedRecently(userId);
        return checker ? await checker(rule, userId) : false;
    }
    catch {
        return false;
    }
}
/** The badges of the editor that a person has by what they are right now (the ids). */
async function grantedFor(userId) {
    const ruled = rules.allBadges().filter((def) => def.custom && def.grantRule && !def.retired);
    const out = [];
    for (const def of ruled)
        if (await qualifies(def.grantRule, userId))
            out.push(def.id);
    return out;
}
/** Tells the registry how to ask Discord: a `booster` is somebody who boosts the support server. (`partner` and `server_boost` have no source yet: nobody qualifies.) */
function useDiscord(client, supportGuildId) {
    setGrantChecker(async (rule, userId) => {
        if (rule !== 'booster' || !supportGuildId)
            return false;
        const guild = client.guilds.cache.get(supportGuildId);
        const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
        return Boolean(member?.premiumSinceTimestamp);
    });
}
