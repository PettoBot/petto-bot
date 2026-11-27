"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ITEM_KINDS = exports.PACK_KINDS = exports.MAX_FONT_BYTES = exports.MAX_BANNER_BYTES = void 0;
exports.checkPackInput = checkPackInput;
exports.checkItemInput = checkItemInput;
exports.checkOverrideInput = checkOverrideInput;
exports.checkBanner = checkBanner;
exports.fontTypeOf = fontTypeOf;
exports.checkFont = checkFont;
const badgeRules = require('./customBadgeRules');
exports.MAX_BANNER_BYTES = 768 * 1024;
exports.MAX_FONT_BYTES = 768 * 1024;
exports.PACK_KINDS = ['badge', 'banner', 'font'];
exports.ITEM_KINDS = ['banner', 'font'];
const LANGS = ['en', 'es', 'pt-BR'];
const ID = /^[a-z0-9][a-z0-9-]{2,39}$/;
/** The badges of the code are named by the ids of the code: countries, languages, the Fablo ones and the plans. A change can reach any of them but the plans. */
const CHANGEABLE = /^(country-[a-z]{2}|lang-[a-z]{2}|furro|boykisser|hetero|femboy)$/;
function namesOf(raw, required) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const en = typeof source.en === 'string' ? source.en.trim() : '';
    if (!en)
        return required ? undefined : null;
    if (en.length > 40)
        return undefined;
    const names = { en };
    for (const lang of LANGS) {
        if (lang === 'en')
            continue;
        const value = typeof source[lang] === 'string' ? source[lang].trim() : '';
        if (value.length > 40)
            return undefined;
        names[lang] = value || en;
    }
    return names;
}
const dateOf = (value) => {
    if (value === null || value === undefined || value === '')
        return null;
    const time = new Date(String(value)).getTime();
    return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
};
const planOf = (value) => (value === 'bronze' || value === 'silver' || value === 'gold' ? value : value ? undefined : null);
const rarityOf = (value) => (badgeRules.RARITIES.includes(String(value)) ? String(value) : value ? undefined : null);
const colorOf = (value) => (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#8f7bd6');
/** A price that may be left empty (the pack or the rarity decides): null for empty, undefined for a bad one. */
const priceOf = (value, max) => {
    if (value === null || value === undefined || value === '')
        return null;
    const price = Number(value);
    return Number.isInteger(price) && price >= 0 && price <= max ? price : undefined;
};
const packIdOf = (value) => {
    if (value === null || value === undefined || value === '')
        return null;
    return typeof value === 'string' && ID.test(value) ? value : undefined;
};
function checkPackInput(body) {
    const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : '';
    if (!ID.test(id))
        return { ok: false, error: 'bad_id' };
    const kind = exports.PACK_KINDS.includes(String(body.kind)) ? String(body.kind) : null;
    if (!kind)
        return { ok: false, error: 'bad_kind' };
    const names = namesOf(body.names, true);
    if (!names)
        return { ok: false, error: 'bad_name' };
    const price = priceOf(body.price, 1_000_000);
    if (price === undefined)
        return { ok: false, error: 'bad_price' };
    const free = body.free === true;
    if (free && price)
        return { ok: false, error: 'free_and_price' };
    const saleFrom = dateOf(body.saleFrom), saleUntil = dateOf(body.saleUntil);
    if (saleFrom === undefined || saleUntil === undefined)
        return { ok: false, error: 'bad_date' };
    if (saleFrom && saleUntil && new Date(saleUntil) <= new Date(saleFrom))
        return { ok: false, error: 'bad_dates' };
    const planMin = planOf(body.planMin);
    if (planMin === undefined)
        return { ok: false, error: 'bad_plan' };
    return { ok: true, value: { id, kind, names, color: colorOf(body.color), price: free ? null : price, free, saleFrom, saleUntil, planMin } };
}
function checkItemInput(body) {
    const kind = exports.ITEM_KINDS.includes(String(body.kind)) ? String(body.kind) : null;
    if (!kind)
        return { ok: false, error: 'bad_kind' };
    const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : '';
    if (!ID.test(id))
        return { ok: false, error: 'bad_id' };
    const names = namesOf(body.names, true);
    if (!names)
        return { ok: false, error: 'bad_name' };
    const rarity = rarityOf(body.rarity) ?? 'common';
    const price = priceOf(body.price, 100_000);
    if (price === undefined)
        return { ok: false, error: 'bad_price' };
    const packId = packIdOf(body.packId);
    if (packId === undefined)
        return { ok: false, error: 'bad_pack' };
    const saleFrom = dateOf(body.saleFrom), saleUntil = dateOf(body.saleUntil);
    if (saleFrom === undefined || saleUntil === undefined)
        return { ok: false, error: 'bad_date' };
    if (saleFrom && saleUntil && new Date(saleUntil) <= new Date(saleFrom))
        return { ok: false, error: 'bad_dates' };
    const planMin = planOf(body.planMin);
    if (planMin === undefined)
        return { ok: false, error: 'bad_plan' };
    return { ok: true, value: { kind, id, packId, names, rarity, price, saleFrom, saleUntil, planMin } };
}
/** What the team changes in a badge of the code. Every field is optional: what is left empty stays as the code has it. */
function checkOverrideInput(body) {
    const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : '';
    if (!CHANGEABLE.test(id))
        return { ok: false, error: 'bad_id' };
    const names = namesOf(body.names, false);
    if (names === undefined)
        return { ok: false, error: 'bad_name' };
    const rarity = rarityOf(body.rarity);
    if (rarity === undefined)
        return { ok: false, error: 'bad_rarity' };
    const price = priceOf(body.price, 100_000);
    if (price === undefined)
        return { ok: false, error: 'bad_price' };
    const packId = packIdOf(body.packId);
    if (packId === undefined)
        return { ok: false, error: 'bad_pack' };
    const rawColor = typeof body.color === 'string' ? body.color.trim().toLowerCase() : '';
    const color = rawColor === 'none' || rawColor === 'transparent' ? 'none' : rawColor ? (/^#[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : undefined) : null;
    if (color === undefined)
        return { ok: false, error: 'bad_color' };
    const active = typeof body.active === 'boolean' ? body.active : null;
    return { ok: true, value: { id, names, color, rarity, price, packId, active } };
}
/** The picture of a banner: not empty, at most 768 KB, a PNG, JPEG or WebP by its first bytes (a GIF is not accepted: the banner of the profile is not animated). */
function checkBanner(bytes) {
    if (!bytes.length)
        return { ok: false, error: 'file_required' };
    if (bytes.length > exports.MAX_BANNER_BYTES)
        return { ok: false, error: 'file_too_big' };
    const type = badgeRules.imageTypeOf(bytes);
    return type && type !== 'image/gif' ? { ok: true, type } : { ok: false, error: 'bad_file' };
}
/** The kind of font file from its first bytes: TrueType (`00 01 00 00` or `true`), OpenType with outlines (`OTTO`) or WOFF2 (`wOF2`). Never from the name the sender gives it. */
function fontTypeOf(bytes) {
    if (bytes.length < 12)
        return null;
    const tag = bytes.subarray(0, 4);
    if (tag.equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) || tag.toString('latin1') === 'true')
        return 'font/ttf';
    if (tag.toString('latin1') === 'OTTO')
        return 'font/otf';
    if (tag.toString('latin1') === 'wOF2')
        return 'font/woff2';
    return null;
}
function checkFont(bytes) {
    if (!bytes.length)
        return { ok: false, error: 'file_required' };
    if (bytes.length > exports.MAX_FONT_BYTES)
        return { ok: false, error: 'file_too_big' };
    const type = fontTypeOf(bytes);
    return type ? { ok: true, type } : { ok: false, error: 'bad_file' };
}
