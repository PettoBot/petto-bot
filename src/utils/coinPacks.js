"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.packById = exports.COIN_PACKS = void 0;
exports.COIN_PACKS = [
    { id: 'pile', coins: 500, price: 2.99 },
    { id: 'small-bag', coins: 850, price: 4.99 },
    { id: 'big-bag', coins: 1200, price: 7.99 },
    { id: 'chest', coins: 2000, price: 11.99 },
];
const packById = (id) => exports.COIN_PACKS.find((pack) => pack.id === id) ?? null;
exports.packById = packById;
