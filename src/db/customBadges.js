"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCustomBadges = listCustomBadges;
exports.getCustomImage = getCustomImage;
exports.saveCustomBadge = saveCustomBadge;
exports.setCustomImage = setCustomImage;
exports.setBadgeActive = setBadgeActive;
exports.votedRecently = votedRecently;
exports.ownerCounts = ownerCounts;
const { getPrimaryPool } = require('./postgres');
const iso = (value) => (value ? new Date(String(value)).toISOString() : null);
const COLUMNS = 'id, names, category, rarity, price, color, (image is not null) as has_image, sale_from, sale_until, plan_min, grant_rule, active, updated_at';
async function listCustomBadges() {
    const { rows } = await getPrimaryPool().query(`select ${COLUMNS} from custom_badges order by created_at`);
    return rows.map((row) => ({
        id: String(row.id), names: row.names, category: String(row.category), rarity: String(row.rarity), price: Number(row.price), color: String(row.color),
        hasImage: Boolean(row.has_image), saleFrom: iso(row.sale_from), saleUntil: iso(row.sale_until), planMin: row.plan_min ?? null,
        grantRule: row.grant_rule ?? null, active: Boolean(row.active), updatedAt: iso(row.updated_at) ?? '',
    }));
}
async function getCustomImage(id) {
    const { rows } = await getPrimaryPool().query('select image, image_type, updated_at from custom_badges where id = $1 and image is not null', [id]);
    if (!rows[0])
        return null;
    return { bytes: rows[0].image, type: String(rows[0].image_type), updatedAt: iso(rows[0].updated_at) ?? '' };
}
/** Creates a badge, or edits it (the picture is another request). Returns whether it was new. */
async function saveCustomBadge(input, by) {
    const pool = getPrimaryPool();
    const params = [input.id, JSON.stringify(input.names), input.category, input.rarity, input.price, input.color, input.saleFrom, input.saleUntil, input.planMin, input.grantRule];
    const updated = await pool.query(`update custom_badges set names = $2::jsonb, category = $3, rarity = $4, price = $5, color = $6, sale_from = $7, sale_until = $8, plan_min = $9, grant_rule = $10, updated_at = now() where id = $1 returning id`, params);
    if (updated.rows.length)
        return false;
    await pool.query(`insert into custom_badges (id, names, category, rarity, price, color, sale_from, sale_until, plan_min, grant_rule, created_by) values ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [...params, by]);
    return true;
}
/** Saves the picture of a badge. Returns whether the badge exists. */
async function setCustomImage(id, bytes, type) {
    const { rows } = await getPrimaryPool().query('update custom_badges set image = $2, image_type = $3, updated_at = now() where id = $1 returning id', [id, bytes, type]);
    return rows.length > 0;
}
/** Puts a badge on sale again or takes it off (whoever has it keeps it). Returns whether it exists. */
async function setBadgeActive(id, active) {
    const { rows } = await getPrimaryPool().query('update custom_badges set active = $2, updated_at = now() where id = $1 returning id', [id, active]);
    return rows.length > 0;
}
/** Whether a person voted for the bot in the last 30 days (the rule `voter`). */
async function votedRecently(userId) {
    const { rows } = await getPrimaryPool().query("select 1 from bot_votes where user_id = $1 and voted_at > now() - interval '30 days' limit 1", [userId]);
    return rows.length > 0;
}
/** How many people have each badge of the editor (the ids of the badges are the keys). */
async function ownerCounts() {
    const { rows } = await getPrimaryPool().query('select badge_id, count(*)::int as owners from user_badges where badge_id in (select id from custom_badges) group by badge_id');
    return Object.fromEntries(rows.map((row) => [String(row.badge_id), Number(row.owners)]));
}
