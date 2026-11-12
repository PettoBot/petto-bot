"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETRY_MINUTES = void 0;
exports.listRoles = listRoles;
exports.upsertRole = upsertRole;
exports.removeRole = removeRole;
exports.markAwarded = markAwarded;
exports.markError = markError;
exports.listDue = listDue;
// The project is JavaScript: its modules are read with `require` and given the shape that is used here.
const { getPrimaryPool } = require('./postgres');
const { ensureGuild } = require('./guilds');
/** A role that could not be given waits this long before it is tried again. */
exports.RETRY_MINUTES = 55;
const pool = () => getPrimaryPool();
const asRow = (row) => (row ? row : null);
async function listRoles(guildId) {
    const { rows } = await pool().query('select * from activity_top_roles where guild_id = $1 order by kind', [guildId]);
    return rows;
}
/**
 * Chooses the role of a kind. The holder is kept when it is the same role (Petto takes it from them when the week changes) and forgotten when it changes
 * (the caller takes the old role from the holder first); either way it is due now, so the winner of last week gets it at the next look.
 */
async function upsertRole(guildId, kind, roleId) {
    await ensureGuild(guildId);
    const { rows } = await pool().query(`insert into activity_top_roles (guild_id, kind, role_id) values ($1, $2, $3)
     on conflict (guild_id, kind) do update set
       role_id = excluded.role_id,
       holder_id = case when activity_top_roles.role_id = excluded.role_id then activity_top_roles.holder_id end,
       awarded_week = null, last_checked_at = null, last_error = null
     returning *`, [guildId, kind, roleId]);
    return rows[0];
}
/** Takes a role away and answers the row it had (to take the role from who has it), or null when there was none. */
async function removeRole(guildId, kind) {
    const { rows } = await pool().query('delete from activity_top_roles where guild_id = $1 and kind = $2 returning *', [guildId, kind]);
    return asRow(rows[0]);
}
/** The week is done: remembers who has the role now (null when nobody) and that this week (`YYYY-MM-DD`) was given. */
async function markAwarded(guildId, kind, week, holderId) {
    await pool().query('update activity_top_roles set holder_id = $4, awarded_week = $3, last_checked_at = now(), last_error = null where guild_id = $1 and kind = $2', [guildId, kind, week, holderId]);
}
/** Saves why the role could not be given (a short code) and counts it as looked at, so it is tried again in an hour and not at every round. */
async function markError(guildId, kind, code) {
    await pool().query('update activity_top_roles set last_error = $3, last_checked_at = now() where guild_id = $1 and kind = $2', [guildId, kind, code]);
}
/** The roles not given yet for the week that just ended (`week` is its first day) and not tried in the last hour, the oldest first. */
async function listDue(week, limit = 50) {
    const { rows } = await pool().query(`select * from activity_top_roles
      where awarded_week is distinct from $1
        and (last_checked_at is null or last_checked_at <= now() - make_interval(mins => $3))
      order by last_checked_at asc nulls first limit $2`, [week, Math.max(1, Math.min(200, limit)), exports.RETRY_MINUTES]);
    return rows;
}
