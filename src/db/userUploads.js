"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.policyVersionOf = policyVersionOf;
exports.acceptPolicy = acceptPolicy;
exports.getState = getState;
exports.setPending = setPending;
exports.approvedBytes = approvedBytes;
exports.pendingBytes = pendingBytes;
exports.approve = approve;
exports.reject = reject;
exports.takedown = takedown;
exports.listPending = listPending;
exports.isBlocked = isBlocked;
exports.block = block;
exports.unblock = unblock;
exports.listBlocked = listBlocked;
const { getPrimaryPool } = require('./postgres');
const iso = (value) => (value ? new Date(value).toISOString() : null);
async function policyVersionOf(userId) {
    const { rows } = await getPrimaryPool().query(`select version from user_policy where user_id = $1`, [userId]);
    return Number(rows[0]?.version ?? 0);
}
async function acceptPolicy(userId, version) {
    await getPrimaryPool().query(`insert into user_policy (user_id, version) values ($1, $2) on conflict (user_id) do update set version = $2, accepted_at = now()`, [userId, version]);
}
async function getState(userId) {
    const { rows } = await getPrimaryPool().query(`select approved is not null as has_approved, pending is not null as has_pending, pending_at, approved_at, last_reject_reason, last_reject_at, removed_reason from user_uploads where user_id = $1`, [userId]);
    const row = rows[0];
    return { hasApproved: Boolean(row?.has_approved), hasPending: Boolean(row?.has_pending), pendingAt: iso(row?.pending_at), approvedAt: iso(row?.approved_at), lastRejectReason: row?.last_reject_reason ?? null, lastRejectAt: iso(row?.last_reject_at), removedReason: row?.removed_reason ?? null };
}
async function setPending(userId, bytes, screened = false) {
    await getPrimaryPool().query(`insert into user_uploads (user_id, pending, pending_at, screened) values ($1, $2, now(), $3)
     on conflict (user_id) do update set pending = $2, pending_at = now(), screened = $3, last_reject_reason = null, last_reject_at = null, removed_reason = null`, [userId, bytes, screened]);
}
async function approvedBytes(userId) {
    const { rows } = await getPrimaryPool().query(`select approved from user_uploads where user_id = $1`, [userId]);
    return rows[0]?.approved ?? null;
}
async function pendingBytes(userId) {
    const { rows } = await getPrimaryPool().query(`select pending from user_uploads where user_id = $1`, [userId]);
    return rows[0]?.pending ?? null;
}
/** The pending picture becomes the approved one. False when there was none. */
async function approve(userId) {
    const { rows } = await getPrimaryPool().query(`update user_uploads set approved = pending, approved_at = now(), pending = null, pending_at = null where user_id = $1 and pending is not null returning user_id`, [userId]);
    return rows.length > 0;
}
async function reject(userId, reason) {
    const { rows } = await getPrimaryPool().query(`update user_uploads set pending = null, pending_at = null, last_reject_reason = $2, last_reject_at = now() where user_id = $1 and pending is not null returning user_id`, [userId, reason]);
    return rows.length > 0;
}
/** Removes both pictures (a copyright claim, a report, the rules). */
async function takedown(userId, reason) {
    const { rows } = await getPrimaryPool().query(`update user_uploads set approved = null, approved_at = null, pending = null, pending_at = null, removed_reason = $2 where user_id = $1 returning user_id`, [userId, reason]);
    return rows.length > 0;
}
async function listPending(limit = 30) {
    const { rows } = await getPrimaryPool().query(`select user_id, pending_at, screened from user_uploads where pending is not null order by pending_at limit $1`, [Math.max(1, Math.min(100, limit))]);
    return rows.map((row) => ({ userId: String(row.user_id), pendingAt: iso(row.pending_at), screened: Boolean(row.screened) }));
}
async function isBlocked(userId) {
    const { rows } = await getPrimaryPool().query(`select 1 from upload_blocks where user_id = $1`, [userId]);
    return rows.length > 0;
}
async function block(userId, reason, byUser) {
    await getPrimaryPool().query(`insert into upload_blocks (user_id, reason, by_user) values ($1, $2, $3) on conflict (user_id) do update set reason = $2, by_user = $3`, [userId, reason, byUser]);
}
async function unblock(userId) {
    const { rows } = await getPrimaryPool().query(`delete from upload_blocks where user_id = $1 returning user_id`, [userId]);
    return rows.length > 0;
}
async function listBlocked(limit = 50) {
    const { rows } = await getPrimaryPool().query(`select user_id, reason, created_at from upload_blocks order by created_at desc limit $1`, [Math.max(1, Math.min(100, limit))]);
    return rows.map((row) => ({ userId: String(row.user_id), reason: String(row.reason ?? ''), createdAt: iso(row.created_at) }));
}
