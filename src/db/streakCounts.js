"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waiting = exports.filtering = void 0;
exports.filtersOf = filtersOf;
exports.loadFilters = loadFilters;
exports.queueDay = queueDay;
exports.flush = flush;
const { getPrimaryPool } = require('./postgres');
const logger = require('../utils/logger');
const MODES = ['all', 'only', 'except'];
const mode = (value) => (MODES.includes(value) ? value : 'all');
const ids = (value) => (Array.isArray(value) ? value.map(String).filter((id) => /^\d{15,25}$/.test(id)).slice(0, 100) : []);
/** The rules of a row of streak_config. A list that is empty is no rule at all (only "nothing"? would count nothing: it means everywhere). */
function filtersOf(row) {
    const channelIds = ids(row.channel_ids), roleIds = ids(row.role_ids);
    return {
        minLength: Math.max(0, Math.min(500, Math.floor(Number(row.min_length ?? 0)) || 0)), cooldownSeconds: Math.max(0, Math.min(3600, Math.floor(Number(row.cooldown_seconds ?? 0)) || 0)),
        channelMode: channelIds.length ? mode(row.channel_mode) : 'all', channelIds, roleMode: roleIds.length ? mode(row.role_mode) : 'all', roleIds, reactions: Boolean(row.reactions_count),
    };
}
/** True when any rule is on (a server with none keeps reading activity_members and needs nothing here). */
const filtering = (f) => f.minLength > 0 || f.cooldownSeconds > 0 || f.channelMode !== 'all' || f.roleMode !== 'all' || f.reactions;
exports.filtering = filtering;
/** The servers that filter their streaks now: guild id -> rules. */
async function loadFilters() {
    const { rows } = await getPrimaryPool().query(`select guild_id, min_length, cooldown_seconds, channel_mode, channel_ids, role_mode, role_ids, reactions_count from streak_config
     where enabled and counting_since is not null and (min_length > 0 or cooldown_seconds > 0 or channel_mode <> 'all' or role_mode <> 'all' or reactions_count)`);
    const out = new Map();
    for (const row of rows) {
        const filters = filtersOf(row);
        if ((0, exports.filtering)(filters))
            out.set(String(row.guild_id), filters);
    }
    return out;
}
// ---- the counted days, written in batches
const FLUSH_MS = 3_000;
const MAX_KEYS = 50_000;
const pending = new Map();
let timer = null;
let flushing = false;
/** One counted message of a person on a day (YYYY-MM-DD). */
function queueDay(guildId, userId, day) {
    const key = `${guildId}:${userId}:${day}`;
    const known = pending.get(key);
    if (known)
        known.count += 1;
    else if (pending.size < MAX_KEYS)
        pending.set(key, { guildId, userId, day, count: 1 });
    else
        return;
    if (!timer && !flushing) {
        timer = setTimeout(() => { timer = null; flush().catch((error) => logger.warn('[Streak counts] Flush failed:', error.message)); }, FLUSH_MS);
        timer.unref?.();
    }
}
/** Writes what is waiting. What fails stays for the next time. */
async function flush() {
    if (flushing || !pending.size)
        return;
    flushing = true;
    const batch = [...pending.values()];
    pending.clear();
    try {
        await getPrimaryPool().query(`insert into streak_days (guild_id, user_id, day, messages) select * from unnest($1::text[], $2::text[], $3::date[], $4::int[])
       on conflict (guild_id, user_id, day) do update set messages = streak_days.messages + excluded.messages`, [batch.map((r) => r.guildId), batch.map((r) => r.userId), batch.map((r) => r.day), batch.map((r) => r.count)]);
    }
    catch (error) {
        logger.warn(`[Streak counts] ${error.message}; kept for the next time`);
        for (const row of batch) {
            const again = pending.get(`${row.guildId}:${row.userId}:${row.day}`);
            if (again)
                again.count += row.count;
            else
                pending.set(`${row.guildId}:${row.userId}:${row.day}`, row);
        }
    }
    finally {
        flushing = false;
        if (pending.size && !timer) {
            timer = setTimeout(() => { timer = null; flush().catch(() => undefined); }, FLUSH_MS);
            timer.unref?.();
        }
    }
}
/** Only for the checks: how many keys wait. */
const waiting = () => pending.size;
exports.waiting = waiting;
