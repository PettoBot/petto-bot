"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asBytes = exports.IMAGE_TYPES = exports.GRANT_RULES = exports.RARITIES = exports.CATEGORIES = exports.MAX_IMAGE_BYTES = void 0;
exports.imageTypeOf = imageTypeOf;
exports.checkBadgeInput = checkBadgeInput;
exports.checkImage = checkImage;
exports.MAX_IMAGE_BYTES = 256 * 1024;
exports.CATEGORIES = ['special', 'status', 'fablo', 'country', 'language'];
exports.RARITIES = ['common', 'rare', 'epic', 'legendary'];
exports.GRANT_RULES = ['voter', 'booster', 'partner', 'server_boost'];
exports.IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const LANGS = ['en', 'es', 'pt-BR'];
/** The ids of the badges of the code: a badge of the editor cannot take one of them or start like a country or a language. */
const RESERVED = /^(country-|lang-|plan-)/;
const BUILT_IN = new Set(['furro', 'boykisser', 'hetero', 'femboy']);
/** The bytes as a Buffer, or null for anything else (a request can send an array or a text where a file is expected). */
const asBytes = (value) => (typeof value === 'object' && value !== null && !Array.isArray(value) && Buffer.isBuffer(value) ? value : null);
exports.asBytes = asBytes;
/** The kind of picture from its first bytes (never from what the name or the sender says). */
function imageTypeOf(input) {
    const bytes = (0, exports.asBytes)(input);
    if (!bytes)
        return null;
    if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
        return 'image/png';
    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return 'image/jpeg';
    if (bytes.length > 6 && bytes.subarray(0, 4).toString('latin1') === 'GIF8')
        return 'image/gif';
    if (bytes.length > 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP')
        return 'image/webp';
    return null;
}
const date = (value) => {
    if (value === null || value === undefined || value === '')
        return null;
    const time = new Date(String(value)).getTime();
    return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
};
/** Checks what the editor sent (the picture comes in its own request: see `checkImage`). */
function checkBadgeInput(body) {
    const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : '';
    if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(id) || RESERVED.test(id) || BUILT_IN.has(id))
        return { ok: false, error: 'bad_id' };
    const rawNames = body.names && typeof body.names === 'object' ? body.names : {};
    const en = typeof rawNames.en === 'string' ? rawNames.en.trim() : '';
    if (!en || en.length > 40)
        return { ok: false, error: 'bad_name' };
    const names = { en };
    for (const lang of LANGS) {
        if (lang === 'en')
            continue;
        const text = typeof rawNames[lang] === 'string' ? rawNames[lang].trim() : '';
        if (text.length > 40)
            return { ok: false, error: 'bad_name' };
        names[lang] = text || en;
    }
    const category = exports.CATEGORIES.includes(String(body.category)) ? String(body.category) : 'special';
    const rarity = exports.RARITIES.includes(String(body.rarity)) ? String(body.rarity) : 'common';
    const price = Number(body.price ?? 0);
    if (!Number.isInteger(price) || price < 0 || price > 100000)
        return { ok: false, error: 'bad_price' };
    const color = typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : '#8f7bd6';
    const saleFrom = date(body.saleFrom), saleUntil = date(body.saleUntil);
    if (saleFrom === undefined || saleUntil === undefined)
        return { ok: false, error: 'bad_date' };
    if (saleFrom && saleUntil && new Date(saleUntil) <= new Date(saleFrom))
        return { ok: false, error: 'bad_dates' };
    const planMin = body.planMin === 'bronze' || body.planMin === 'silver' || body.planMin === 'gold' ? body.planMin : null;
    if (body.planMin && !planMin)
        return { ok: false, error: 'bad_plan' };
    const grantRule = body.grantRule ? String(body.grantRule) : null;
    if (grantRule && !exports.GRANT_RULES.includes(grantRule))
        return { ok: false, error: 'bad_rule' };
    if (grantRule && price > 0)
        return { ok: false, error: 'rule_and_price' };
    const packId = body.packId === null || body.packId === undefined || body.packId === '' ? null : typeof body.packId === 'string' && /^[a-z0-9][a-z0-9-]{2,39}$/.test(body.packId) ? body.packId : undefined;
    if (packId === undefined)
        return { ok: false, error: 'bad_pack' };
    return { ok: true, value: { id, names, category, rarity, price, color, saleFrom, saleUntil, planMin, grantRule, packId } };
}
/** Checks the picture of a badge: not empty, at most 256 KB, and really a PNG, JPEG, GIF or WebP by its first bytes. */
function checkImage(input) {
    const bytes = (0, exports.asBytes)(input);
    if (!bytes || !bytes.length)
        return { ok: false, error: 'image_required' };
    if (bytes.length > exports.MAX_IMAGE_BYTES)
        return { ok: false, error: 'image_too_big' };
    const type = imageTypeOf(bytes);
    return type ? { ok: true, type } : { ok: false, error: 'bad_image' };
}
