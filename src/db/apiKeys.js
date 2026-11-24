"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_KEYS = void 0;
exports.listKeys = listKeys;
exports.addKey = addKey;
exports.removeKey = removeKey;
exports.userOfKey = userOfKey;
const { getPrimaryPool } = require('./postgres');
exports.MAX_KEYS = 3;
async function listKeys(userId) {
    const { rows } = await getPrimaryPool().query(`select id, label, created_at, last_used from api_keys where user_id = $1 order by id`, [userId]);
    return rows.map((row) => ({ id: Number(row.id), label: String(row.label ?? ''), createdAt: new Date(row.created_at).toISOString(), lastUsed: row.last_used ? new Date(row.last_used).toISOString() : null }));
}
/** Saves a key (its hash) unless the person already has the most keys. Returns the id, or null when there is no room. One statement, so two at once cannot pass the limit. */
async function addKey(userId, hash, label) {
    const { rows } = await getPrimaryPool().query(`insert into api_keys (user_id, key_hash, label) select $1, $2, $3 where (select count(*) from api_keys where user_id = $1) < $4 returning id`, [userId, hash, label, exports.MAX_KEYS]);
    return rows[0] ? Number(rows[0].id) : null;
}
async function removeKey(userId, id) {
    const { rows } = await getPrimaryPool().query(`delete from api_keys where user_id = $1 and id = $2 returning id`, [userId, id]);
    return rows.length > 0;
}
/** The person a key belongs to (and the key is marked as used), or null. */
async function userOfKey(hash) {
    const { rows } = await getPrimaryPool().query(`update api_keys set last_used = now() where key_hash = $1 returning user_id`, [hash]);
    return rows[0] ? String(rows[0].user_id) : null;
}
