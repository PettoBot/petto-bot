"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlan = getPlan;
exports.setPlan = setPlan;
exports.endPlan = endPlan;
exports.listActive = listActive;
const { getPrimaryPool } = require('./postgres');
const iso = (value) => (value ? new Date(String(value)).toISOString() : null);
const toRow = (row) => ({
    userId: String(row.user_id), plan: String(row.plan), endsAt: iso(row.ends_at), renews: Boolean(row.renews), source: String(row.source), grantedBy: row.granted_by ?? null,
    note: row.note ?? null, startedAt: iso(row.started_at) ?? '', active: Boolean(row.active),
});
const COLUMNS = 'user_id, plan, ends_at, renews, source, granted_by, note, started_at, (ends_at is null or ends_at > now()) as active';
/** The plan of a person with whether it is active now, or null when they never had one. */
async function getPlan(userId) {
    const { rows } = await getPrimaryPool().query(`select ${COLUMNS} from user_plans where user_id = $1`, [userId]);
    return rows[0] ? toRow(rows[0]) : null;
}
/** Puts a plan on a person until `endsAt` (null: no end). Replaces the one they had. */
async function setPlan(userId, plan, endsAt, source, by, note) {
    await getPrimaryPool().query(`insert into user_plans (user_id, plan, ends_at, source, granted_by, note) values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id) do update set plan = excluded.plan, ends_at = excluded.ends_at, source = excluded.source, granted_by = excluded.granted_by, note = excluded.note, started_at = now(), updated_at = now()`, [userId, plan, endsAt, source, by, note]);
}
/** Ends the plan of a person now. Returns whether they had one. */
async function endPlan(userId) {
    const { rows } = await getPrimaryPool().query('update user_plans set ends_at = now(), renews = false, updated_at = now() where user_id = $1 and (ends_at is null or ends_at > now()) returning user_id', [userId]);
    return rows.length > 0;
}
/** Every person with an active plan, for the list of the team (up to 200, the newest first). */
async function listActive() {
    const { rows } = await getPrimaryPool().query(`select ${COLUMNS} from user_plans where ends_at is null or ends_at > now() order by updated_at desc limit 200`);
    return rows.map(toRow);
}
