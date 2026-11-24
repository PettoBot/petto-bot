"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SETTINGS = void 0;
exports.getSettings = getSettings;
exports.saveSettings = saveSettings;
exports.givenToday = givenToday;
exports.recentGrants = recentGrants;
const { getPrimaryPool } = require('./postgres');
exports.DEFAULT_SETTINGS = { enabled: true, maxPerGrant: 5000, maxPerDay: 20000, people: [] };
async function getSettings() {
    const { rows } = await getPrimaryPool().query(`select enabled, max_per_grant, max_per_day, people from ceramos_grant_settings where id = 1`);
    const row = rows[0];
    if (!row)
        return { ...exports.DEFAULT_SETTINGS };
    return { enabled: Boolean(row.enabled), maxPerGrant: Number(row.max_per_grant), maxPerDay: Number(row.max_per_day), people: Array.isArray(row.people) ? row.people.map(String) : [] };
}
async function saveSettings(settings) {
    await getPrimaryPool().query(`insert into ceramos_grant_settings (id, enabled, max_per_grant, max_per_day, people) values (1, $1, $2, $3, $4)
     on conflict (id) do update set enabled = $1, max_per_grant = $2, max_per_day = $3, people = $4, updated_at = now()`, [settings.enabled, settings.maxPerGrant, settings.maxPerDay, settings.people]);
}
/** What one person of the team gave in the last 24 hours. */
async function givenToday(adminId) {
    const { rows } = await getPrimaryPool().query(`select coalesce(sum(delta), 0) as total from ceramos_ledger where by_user = $1 and reason = 'grant' and delta > 0 and created_at > now() - interval '24 hours'`, [adminId]);
    return Number(rows[0]?.total ?? 0);
}
/** The last gifts of the team. */
async function recentGrants(limit = 15) {
    const { rows } = await getPrimaryPool().query(`select user_id, delta, by_user, ref, created_at from ceramos_ledger where reason = 'grant' and delta > 0 order by id desc limit $1`, [Math.max(1, Math.min(50, limit))]);
    return rows.map((row) => ({ userId: String(row.user_id), amount: Number(row.delta), byUser: row.by_user ? String(row.by_user) : null, note: row.ref ? String(row.ref) : null, createdAt: new Date(row.created_at).toISOString() }));
}
