"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.itemName = exports.priceOf = exports.itemById = exports.allItems = void 0;
exports.setItems = setItems;
exports.packSummary = packSummary;
const badges = require('./profileBadges');
let items = [];
let byKey = new Map();
/** Sets the banners and fonts (utils/badgeRegistry.ts reads them from the database). `pack` is the id of the pack it is in. */
function setItems(list) {
    items = list;
    byKey = new Map(list.map((item) => [`${item.kind}:${item.id}`, item]));
}
const allItems = (kind) => (kind ? items.filter((item) => item.kind === kind) : items);
exports.allItems = allItems;
const itemById = (kind, id) => byKey.get(`${kind}:${id}`) ?? null;
exports.itemById = itemById;
/** What a piece costs: its own price, or the one of its rarity; nothing when it is in a free pack. */
const priceOf = (item) => (badges.packById(item.pack)?.free ? 0 : (item.price ?? badges.RARITY_PRICE[item.rarity]));
exports.priceOf = priceOf;
/** The name of a piece in a language (the editor keeps it in the three languages). */
const itemName = (lang, item) => item.names[lang] ?? item.names[lang.split('-')[0]] ?? item.names.en ?? item.id;
exports.itemName = itemName;
/** What a pack holds now and what it costs whole: the sum of the pieces, or its own price when the team set one (the whole pack is never dearer than the pieces). */
function packSummary(packId, owned = new Set(), plan = null, now = new Date()) {
    const pack = badges.packById(packId);
    if (!pack)
        return null;
    const pieces = [];
    if (pack.kind === 'badge') {
        for (const def of badges.shopBadges())
            if (def.pack === packId && badges.onSale(def, now) && badges.planAllows(def, plan))
                pieces.push({ key: def.id, price: badges.priceOf(def) });
    }
    else {
        for (const item of items)
            if (item.pack === packId && item.kind === pack.kind && item.hasFile && badges.onSale(item, now) && badges.planAllows(item, plan))
                pieces.push({ key: `${item.kind}:${item.id}`, price: (0, exports.priceOf)(item) });
    }
    const missing = pieces.filter((piece) => !owned.has(piece.key));
    const fullPrice = missing.reduce((sum, piece) => sum + piece.price, 0);
    const price = pack.free ? 0 : pack.price === null ? fullPrice : Math.min(pack.price, fullPrice);
    return { pieces: pieces.map((piece) => piece.key), missing: missing.map((piece) => piece.key), fullPrice, price };
}
