"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refresh = refresh;
exports.ensure = ensure;
exports.invalidate = invalidate;
exports.customArt = customArt;
exports.setGrantChecker = setGrantChecker;
exports.grantedFor = grantedFor;
exports.useDiscord = useDiscord;
const { loadImage } = require('@napi-rs/canvas');
const rules = require('./profileBadges');
const customDb = require('../db/customBadges');
const FRESH_MS = 60_000;
let loadedAt = 0;
let loading = null;
const art = new Map();
function toDef(row) {
    return {
        id: row.id, custom: true, unlock: row.grantRule ? 'status' : 'shop', art: row.hasImage ? 'custom' : null, color: row.color, names: row.names, category: row.category,
        rarity: row.rarity, price: row.grantRule ? 0 : row.price, saleFrom: row.saleFrom, saleUntil: row.saleUntil, planMin: row.planMin ?? null,
        grantRule: row.grantRule, retired: !row.active, version: row.updatedAt,
    };
}
/** Reads the badges of the editor now. A failed read leaves the ones that were there. */
async function refresh() {
    try {
        rules.setCustomBadges((await customDb.listCustomBadges()).map(toDef));
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
    if (!def.custom)
        return null;
    const known = art.get(def.id);
    try {
        const stored = await customDb.getCustomImage(def.id);
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
