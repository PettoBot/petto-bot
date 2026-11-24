"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ownId = void 0;
exports.setPending = setPending;
exports.pendingOf = pendingOf;
exports.listPending = listPending;
exports.pendingImage = pendingImage;
exports.take = take;
exports.removePending = removePending;
exports.approvedOf = approvedOf;
exports.approve = approve;
exports.removeApproved = removeApproved;
const { getPrimaryPool } = require('./postgres');
const iso = (value) => (value ? new Date(value).toISOString() : null);
const ownId = (userId, slot) => `own-${userId}-${slot}`;
exports.ownId = ownId;
async function setPending(userId, slot, name, image, screened) {
    await getPrimaryPool().query(`insert into user_own_badges (user_id, slot, name, image, screened, submitted_at) values ($1, $2, $3, $4, $5, now())
     on conflict (user_id, slot) do update set name = $3, image = $4, screened = $5, submitted_at = now()`, [userId, slot, name, image, screened]);
}
async function pendingOf(userId) {
    const { rows } = await getPrimaryPool().query(`select user_id, slot, name, screened, submitted_at from user_own_badges where user_id = $1 order by slot`, [userId]);
    return rows.map((row) => ({ userId: String(row.user_id), slot: Number(row.slot), name: String(row.name), screened: Boolean(row.screened), submittedAt: iso(row.submitted_at) }));
}
async function listPending(limit = 30) {
    const { rows } = await getPrimaryPool().query(`select user_id, slot, name, screened, submitted_at from user_own_badges order by submitted_at limit $1`, [limit]);
    return rows.map((row) => ({ userId: String(row.user_id), slot: Number(row.slot), name: String(row.name), screened: Boolean(row.screened), submittedAt: iso(row.submitted_at) }));
}
async function pendingImage(userId, slot) {
    const { rows } = await getPrimaryPool().query(`select image from user_own_badges where user_id = $1 and slot = $2`, [userId, slot]);
    return rows[0]?.image ?? null;
}
/** Takes the waiting badge out (it was approved or rejected) and gives it back, or null when there was none. */
async function take(userId, slot) {
    const { rows } = await getPrimaryPool().query(`delete from user_own_badges where user_id = $1 and slot = $2 returning name, image`, [userId, slot]);
    return rows[0] ? { name: String(rows[0].name), image: rows[0].image } : null;
}
async function removePending(userId, slot) {
    const { rows } = await getPrimaryPool().query(`delete from user_own_badges where user_id = $1 and slot = $2 returning slot`, [userId, slot]);
    return rows.length > 0;
}
/** The approved badges of a person: the ones of the editor with their id. */
async function approvedOf(userId) {
    const { rows } = await getPrimaryPool().query(`select id, names from custom_badges where id like $1 order by id`, [`own-${userId}-%`]);
    return rows.map((row) => ({ id: String(row.id), slot: Number(String(row.id).split('-').pop()), name: String(row.names.en ?? '') }));
}
/** Makes (or replaces) the approved badge of a slot: off sale, with its picture, and the person gets it. */
async function approve(userId, slot, name, image) {
    const pool = getPrimaryPool();
    const id = (0, exports.ownId)(userId, slot);
    await pool.query(`insert into custom_badges (id, names, category, rarity, price, color, image, image_type, active, created_by) values ($1, $2::jsonb, 'special', 'common', 0, '#8f7bd6', $3, 'image/png', false, $4)
     on conflict (id) do update set names = $2::jsonb, image = $3, image_type = 'image/png', active = false, updated_at = now()`, [id, JSON.stringify({ en: name }), image, userId]);
    await pool.query(`insert into user_badges (user_id, badge_id, source) values ($1, $2, 'team') on conflict (user_id, badge_id) do nothing`, [userId, id]);
}
/** Takes an approved badge away (the person removes it, or the team takes it down). */
async function removeApproved(userId, slot) {
    const pool = getPrimaryPool();
    const id = (0, exports.ownId)(userId, slot);
    await pool.query(`delete from user_badges where badge_id = $1`, [id]);
    await pool.query(`update user_profile set showcase = array_remove(showcase, $1) where user_id = $2`, [id, userId]);
    const { rows } = await pool.query(`delete from custom_badges where id = $1 returning id`, [id]);
    return rows.length > 0;
}
