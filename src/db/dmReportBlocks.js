"use strict";
// i18n-ignore-file: database layer, nothing here is shown to anyone.
// The people the Petto team blocked from sending DM reports (table `dm_report_blocks`): a report of a direct message that Petto sent goes to the Petto team only, and a person who sends false
// or abusive ones can be blocked. A blocked person is told, when they press the report button, that they cannot send reports right now (no reason, and not who decided); nothing reaches the team.
// It does not touch the reports of the servers: it is only the reports to the Petto team.
// Written in TypeScript: `npm run build:ts` compiles it over src/db/dmReportBlocks.js, which is what the bot loads.
Object.defineProperty(exports, "__esModule", { value: true });
exports.count = exports.list = exports.get = exports.remove = exports.add = exports.isBlocked = exports.isBlockedCached = exports.load = exports.SQL = exports.DEFAULT_REASON = exports.LIMITS = void 0;
exports.createStore = createStore;
/** The reason is for the team (the blocked person never reads it). `DEFAULT_REASON` is what the form of the card suggests. */
exports.LIMITS = Object.freeze({ reasonMin: 3, reasonMax: 300, perPage: 10 });
exports.DEFAULT_REASON = 'False or abusive DM reports';
/** The statements, exported so the checks can assert what they say. */
exports.SQL = Object.freeze({
    insert: 'insert into dm_report_blocks (user_id, user_tag, reason, blocked_by, report_id) values ($1, $2, $3, $4, $5) on conflict (user_id) do nothing returning *',
    remove: 'delete from dm_report_blocks where user_id = $1 returning *',
    get: 'select * from dm_report_blocks where user_id = $1',
    list: 'select * from dm_report_blocks order by created_at desc, user_id limit $1 offset $2',
    count: 'select count(*)::int as total from dm_report_blocks',
    ids: 'select user_id from dm_report_blocks',
});
/**
 * The store over a `query(sql, params)` function (the pool of the bot, or a fake in the checks).
 * - `load()`: reads who is blocked into memory (when the bot starts), so the button can answer without asking the database.
 * - `isBlockedCached(id)`: from memory (false until loaded); `isBlocked(id)`: from the database, the one that decides (it also keeps the memory right).
 * - `add(input)`: the new row, or null when that person was already blocked. `remove(id)`: the row that was taken away, or null.
 */
function createStore(query) {
    let known = null;
    const remember = (id, blocked) => {
        if (!known)
            return;
        if (blocked)
            known.add(id);
        else
            known.delete(id);
    };
    return {
        async load() {
            const { rows } = await query(exports.SQL.ids);
            known = new Set(rows.map((row) => String(row.user_id)));
            return known.size;
        },
        isBlockedCached(userId) {
            return known?.has(String(userId)) ?? false;
        },
        async isBlocked(userId) {
            const id = String(userId);
            const { rows } = await query(exports.SQL.get, [id]);
            const blocked = rows.length > 0;
            remember(id, blocked);
            return blocked;
        },
        async add(input) {
            const id = String(input.userId);
            const { rows } = await query(exports.SQL.insert, [id, input.userTag ?? null, String(input.reason), String(input.by), input.reportId ?? null]);
            remember(id, true);
            return rows[0] ?? null;
        },
        async remove(userId) {
            const id = String(userId);
            const { rows } = await query(exports.SQL.remove, [id]);
            remember(id, false);
            return rows[0] ?? null;
        },
        async get(userId) {
            const { rows } = await query(exports.SQL.get, [String(userId)]);
            return rows[0] ?? null;
        },
        async list({ limit = exports.LIMITS.perPage, offset = 0 } = {}) {
            const { rows } = await query(exports.SQL.list, [Math.max(1, Math.min(100, Math.floor(limit) || exports.LIMITS.perPage)), Math.max(0, Math.floor(offset) || 0)]);
            return rows;
        },
        async count() {
            const { rows } = await query(exports.SQL.count);
            return Number(rows[0]?.total ?? 0) || 0;
        },
    };
}
// The project is JavaScript: its modules are read with `require` and given the shape that is used here.
const { getPrimaryPool } = require('./postgres');
const store = createStore((sql, params) => getPrimaryPool().query(sql, params));
exports.load = store.load;
exports.isBlockedCached = store.isBlockedCached;
exports.isBlocked = store.isBlocked;
exports.add = store.add;
exports.remove = store.remove;
exports.get = store.get;
exports.list = store.list;
exports.count = store.count;
