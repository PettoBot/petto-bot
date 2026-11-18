"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_EXTRA = exports.MAX_MESSAGES = exports.KINDS = void 0;
exports.variantsOf = variantsOf;
exports.addVariant = addVariant;
exports.removeVariant = removeVariant;
const { getPrimaryPool } = require('./postgres');
const { createExpiringCache } = require('../utils/expiringCache');
exports.KINDS = ['welcome', 'leave', 'boost'];
/** The first message counts too: 25 in all for each kind. */
exports.MAX_MESSAGES = 25;
exports.MAX_EXTRA = exports.MAX_MESSAGES - 1;
const isKind = (value) => exports.KINDS.includes(value);
const filled = (m) => Boolean(m && ((m.message && m.message.trim()) || (m.template && m.template.trim())));
const cache = createExpiringCache(15_000, { invalidateOn: ['member_event_variants'] });
async function loadAll(guildId) {
    const { rows } = await getPrimaryPool().query('select id, kind, position, message, embed_template from member_event_variants where guild_id = $1 order by position, id', [guildId]);
    const all = { welcome: [], leave: [], boost: [] };
    for (const row of rows) {
        if (!isKind(row.kind))
            continue;
        all[row.kind].push({ id: Number(row.id), position: Number(row.position), message: row.message ?? null, template: row.embed_template ?? null });
    }
    return all;
}
/** The other messages of a kind, in order (not the first one, which is in the settings). A server with none costs one cached read. */
async function variantsOf(guildId, kind) {
    return (await cache.get(String(guildId), () => loadAll(String(guildId))))[kind];
}
// ---- What the commands do (the dashboard writes the same table) ----
/** Adds a message to a kind. `full` when there is no room (25 in all, the first included). */
async function addVariant(guildId, kind, message) {
    if (!filled(message))
        return { ok: false, reason: 'empty' };
    const pool = getPrimaryPool();
    const { rows } = await pool.query('select count(*)::int as n, coalesce(max(position), 0)::int as last from member_event_variants where guild_id = $1 and kind = $2', [guildId, kind]);
    const have = Number(rows[0]?.n ?? 0);
    if (have >= exports.MAX_EXTRA)
        return { ok: false, reason: 'full' };
    await pool.query('insert into member_event_variants (guild_id, kind, position, message, embed_template) values ($1, $2, $3, $4, $5)', [guildId, kind, Number(rows[0]?.last ?? 0) + 1, message.message?.trim() ? message.message : null, message.template?.trim() ? message.template : null]);
    cache.delete(String(guildId));
    return { ok: true, total: have + 2 };
}
/** Takes away the other message that is number `number` in the list (2 is the first of the others: number 1 is the first message and it is changed with setup). */
async function removeVariant(guildId, kind, number) {
    const list = await variantsOf(guildId, kind);
    const row = list[number - 2];
    if (!row)
        return false;
    await getPrimaryPool().query('delete from member_event_variants where guild_id = $1 and kind = $2 and id = $3', [guildId, kind, row.id]);
    cache.delete(String(guildId));
    return true;
}
