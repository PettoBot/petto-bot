"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TARGETS = exports.MAX_RULES = void 0;
exports.rulesOf = rulesOf;
exports.addRule = addRule;
exports.removeRule = removeRule;
const { getPrimaryPool } = require('./postgres');
const { createExpiringCache } = require('../utils/expiringCache');
exports.MAX_RULES = 25;
exports.TARGETS = ['humans', 'all', 'bots'];
const rowToRule = (row) => ({
    id: Number(row.id), roleId: String(row.role_id), days: Number(row.days), removeRoleId: row.remove_role_id ?? null,
    target: exports.TARGETS.includes(row.target) ? row.target : 'humans', enabled: row.enabled !== false,
});
const cache = createExpiringCache(15_000, { invalidateOn: ['aged_roles'] });
/** Every rule of a server (also the ones that are off: the commands and the dashboard list them). */
function rulesOf(guildId) {
    return cache.get(String(guildId), async () => {
        const { rows } = await getPrimaryPool().query('select id, role_id, days, remove_role_id, target, enabled from aged_roles where guild_id = $1 order by days, id', [guildId]);
        return rows.map(rowToRule);
    });
}
async function addRule(guildId, rule) {
    if (!Number.isInteger(rule.days) || rule.days < 1 || rule.days > 3650)
        return { ok: false, reason: 'days' };
    if (rule.removeRoleId && rule.removeRoleId === rule.roleId)
        return { ok: false, reason: 'same' };
    const pool = getPrimaryPool();
    const have = Number((await pool.query('select count(*)::int as n from aged_roles where guild_id = $1', [guildId])).rows[0]?.n ?? 0);
    const exists = (await pool.query('select 1 from aged_roles where guild_id = $1 and role_id = $2 and days = $3', [guildId, rule.roleId, rule.days])).rows.length > 0;
    if (!exists && have >= exports.MAX_RULES)
        return { ok: false, reason: 'full' };
    await pool.query(`insert into aged_roles (guild_id, role_id, days, remove_role_id, target) values ($1, $2, $3, $4, $5)
     on conflict (guild_id, role_id, days) do update set remove_role_id = excluded.remove_role_id, target = excluded.target, enabled = true`, [guildId, rule.roleId, rule.days, rule.removeRoleId ?? null, rule.target ?? 'humans']);
    cache.delete(String(guildId));
    return { ok: true };
}
/** Removes the rules of a role (the one with that number of days, or all of them when `days` is left out). How many were removed. */
async function removeRule(guildId, roleId, days) {
    const pool = getPrimaryPool();
    const result = days ? await pool.query('delete from aged_roles where guild_id = $1 and role_id = $2 and days = $3 returning id', [guildId, roleId, days])
        : await pool.query('delete from aged_roles where guild_id = $1 and role_id = $2 returning id', [guildId, roleId]);
    cache.delete(String(guildId));
    return result.rows.length;
}
