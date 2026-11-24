"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.save = save;
// i18n-ignore-file: the answers are codes and numbers; the website writes the words.
// Saving the rank card of a person (the page "Rank card"): the checking, the price of the two-color bar (once) and the save. Kept apart from the API of the page so the checks can run it
// without the rest of the profile. Written in TypeScript: `npm run build:ts` compiles it over utils/rankCardActions.js.
const rankRules = require('./userRankCard');
const rankDb = require('../db/userRankCard');
const walletDb = require('../db/ceramos');
const designs = require('./cardDesigns');
/** Saves the card of a person. The two-color bar is paid the first time (and kept); the check and the charge are one step so a double click cannot charge twice. */
async function save(userId, raw) {
    const settings = rankRules.normalize(raw, (id) => Boolean(designs.getDesign(id)));
    const row = await rankDb.getRankCard(userId);
    const price = rankRules.costOf(settings, row?.gradientPaid ?? false);
    let balance = (await walletDb.getWallet(userId)).balance;
    if (price > 0) {
        const left = await walletDb.spend(userId, price, 'rank-card', 'gradient');
        if (left === null)
            return { ok: false, reason: 'noCeramos', price, balance };
        balance = left;
    }
    await rankDb.saveRankCard(userId, settings, price > 0 || Boolean(row?.gradientPaid));
    return { ok: true, settings, charged: price, balance };
}
