"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSavedBadges = getSavedBadges;
exports.addBadge = addBadge;
exports.removeBadge = removeBadge;
exports.getShowcase = getShowcase;
exports.setShowcase = setShowcase;
exports.deleteProfile = deleteProfile;
const { getPrimaryPool } = require('./postgres');
/** The ids of the badges saved for a person (the badge of a plan is not saved: it follows the plan). */
async function getSavedBadges(userId) {
    const { rows } = await getPrimaryPool().query('select badge_id from user_badges where user_id = $1 order by granted_at', [userId]);
    return rows.map((row) => String(row.badge_id));
}
/** Saves a badge for a person. Returns whether it was new. */
async function addBadge(userId, badgeId, source) {
    const { rows } = await getPrimaryPool().query('insert into user_badges (user_id, badge_id, source) values ($1, $2, $3) on conflict (user_id, badge_id) do nothing returning badge_id', [userId, badgeId, source]);
    return rows.length > 0;
}
/** Takes a badge away (and out of the showcase). Returns whether they had it. */
async function removeBadge(userId, badgeId) {
    const pool = getPrimaryPool();
    const { rows } = await pool.query('delete from user_badges where user_id = $1 and badge_id = $2 returning badge_id', [userId, badgeId]);
    await pool.query('update user_profile set showcase = array_remove(showcase, $2), updated_at = now() where user_id = $1', [userId, badgeId]);
    return rows.length > 0;
}
async function getShowcase(userId) {
    const { rows } = await getPrimaryPool().query('select showcase from user_profile where user_id = $1', [userId]);
    const list = rows[0]?.showcase;
    return Array.isArray(list) ? list.map(String) : [];
}
async function setShowcase(userId, showcase) {
    const { rows } = await getPrimaryPool().query(`insert into user_profile (user_id, showcase) values ($1, $2::text[])
     on conflict (user_id) do update set showcase = excluded.showcase, updated_at = now()
     returning showcase`, [userId, showcase]);
    return Array.isArray(rows[0]?.showcase) ? (rows[0]?.showcase).map(String) : showcase;
}
/** Forgets everything saved for a person (what they ask for when they want their profile data deleted). */
async function deleteProfile(userId) {
    const pool = getPrimaryPool();
    await pool.query('delete from user_badges where user_id = $1', [userId]);
    await pool.query('delete from user_profile where user_id = $1', [userId]);
}
