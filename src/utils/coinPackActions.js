"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.credit = credit;
// i18n-ignore-file: the answers are codes and numbers; the website writes the words.
// Giving the ceramos of a pack that was paid. Kept apart from the API of the pages so the checks can run it without the rest of the profile.
// Written in TypeScript: `npm run build:ts` compiles it over utils/coinPackActions.js.
const packs = require('./coinPacks');
const walletDb = require('../db/ceramos');
/** Gives the ceramos of a pack that was paid (the website calls it when the payment service says the order is paid). Once for each order id. */
async function credit(userId, packId, orderId) {
    const pack = packs.packById(packId);
    if (!pack || !/^[A-Za-z0-9_-]{6,80}$/.test(orderId))
        return { ok: false, reason: 'bad_request' };
    const done = await walletDb.giveOnce(userId, pack.coins, pack.id, orderId);
    return { ok: true, coins: pack.coins, balance: done.balance, applied: done.applied };
}
