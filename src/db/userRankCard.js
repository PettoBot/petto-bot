"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRankCard = getRankCard;
exports.saveRankCard = saveRankCard;
exports.resetRankCard = resetRankCard;
const { getPrimaryPool } = require('./postgres');
/** What a person saved, or null when they never designed a card. */
async function getRankCard(userId) {
    const { rows } = await getPrimaryPool().query('select settings, gradient_paid from user_rank_card where user_id = $1', [userId]);
    return rows[0] ? { settings: rows[0].settings ?? {}, gradientPaid: Boolean(rows[0].gradient_paid) } : null;
}
/** Saves the settings of a person; `paidGradient` marks the two-color bar as paid (it stays paid). */
async function saveRankCard(userId, settings, paidGradient) {
    await getPrimaryPool().query(`insert into user_rank_card (user_id, settings, gradient_paid) values ($1, $2::jsonb, $3)
     on conflict (user_id) do update set settings = excluded.settings, gradient_paid = user_rank_card.gradient_paid or excluded.gradient_paid, updated_at = now()`, [userId, JSON.stringify(settings), paidGradient]);
}
/** Puts the card back to the default one. A two-color bar that was paid stays paid. */
async function resetRankCard(userId) {
    await getPrimaryPool().query("update user_rank_card set settings = '{}'::jsonb, updated_at = now() where user_id = $1", [userId]);
}
