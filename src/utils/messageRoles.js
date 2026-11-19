"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SQL = exports.forgetPending = exports.pendingCount = void 0;
exports.qualifies = qualifies;
exports.changesFor = changesFor;
exports.countMessage = countMessage;
exports.countsOf = countsOf;
exports.applyToMember = applyToMember;
exports.flush = flush;
exports.runGuild = runGuild;
exports.runRemovals = runRemovals;
exports.prune = prune;
const messageRoles_1 = require("../db/messageRoles");
__exportStar(require("../db/messageRoles"), exports);
const { getPrimaryPool } = require('../db/postgres');
const logger = require('./logger');
const { notePermissionProblem } = require('./permissionErrors');
/** Whether the count of a member reaches the rule (pure). */
function qualifies(rule, counts) {
    const n = rule.mode === 'total' ? counts.total : counts.periods.get(rule.periodDays) ?? 0;
    return n >= rule.messages;
}
/**
 * The roles to give and to take away for a member (pure: no Discord here). A role is given when a rule of it is reached. It is taken away only by a `period` rule with `remove_below`,
 * and only when no other rule of the same role is reached (a role of two rules stays while one of them holds).
 */
function changesFor(roleIds, rules, counts) {
    const add = [];
    const remove = [];
    const active = rules.filter((rule) => rule.enabled);
    const held = new Set(active.filter((rule) => qualifies(rule, counts)).map((rule) => rule.roleId));
    for (const rule of active) {
        if (qualifies(rule, counts)) {
            if (!roleIds.has(rule.roleId) && !add.some((a) => a.roleId === rule.roleId))
                add.push(rule);
        }
        else if (rule.removeBelow && rule.mode === 'period' && roleIds.has(rule.roleId) && !held.has(rule.roleId) && !remove.some((r) => r.roleId === rule.roleId)) {
            remove.push(rule);
        }
    }
    return { add, remove };
}
// ---- Counting ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const dayOf = (now) => now.toISOString().slice(0, 10);
const pending = new Map();
const MAX_PENDING = 20_000; // a bound on the memory: a burst that big is flushed at once
/** One message of a member (call it only for a server that has rules). */
function countMessage(guildId, userId, now = new Date()) {
    const day = dayOf(now);
    const key = `${guildId}:${userId}:${day}`;
    const row = pending.get(key);
    if (row)
        row.n += 1;
    else
        pending.set(key, { guildId, userId, day, n: 1 });
    return pending.size >= MAX_PENDING;
}
const pendingCount = () => pending.size;
exports.pendingCount = pendingCount;
const forgetPending = () => pending.clear();
exports.forgetPending = forgetPending;
exports.SQL = Object.freeze({
    totals: `insert into message_role_totals (guild_id, user_id, messages) select * from unnest($1::text[], $2::text[], $3::bigint[])
           on conflict (guild_id, user_id) do update set messages = message_role_totals.messages + excluded.messages, updated_at = now()
           returning guild_id, user_id, messages`,
    days: `insert into message_role_days (guild_id, user_id, day, messages) select * from unnest($1::text[], $2::text[], $3::date[], $4::int[])
         on conflict (guild_id, user_id, day) do update set messages = message_role_days.messages + excluded.messages`,
    period: `select user_id, sum(messages)::int as n from message_role_days where guild_id = $1 and user_id = any($2::text[]) and day > (now() at time zone 'utc')::date - $3::int group by user_id`,
    total: 'select user_id, messages from message_role_totals where guild_id = $1 and user_id = any($2::text[])',
    prune: "delete from message_role_days where day < (now() at time zone 'utc')::date - 366",
});
const PER_GUILD_PER_FLUSH = 200; // members looked at in one server in one flush: the others are looked at with their next message
const PER_GUILD_PER_RUN = 200; // role changes in one server in one look of the job
const GAP_MS = Number(process.env.PETTO_MESSAGE_ROLES_GAP_MS ?? 400); // the pause between two changes (a test sets it to 0)
const MAX_MEMBERS = 100_000;
const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());
const complained = new Map();
function complainOnce(key, text) {
    if (Date.now() - (complained.get(key) ?? 0) < 6 * 3_600_000)
        return;
    if (complained.size > 500)
        complained.clear();
    complained.set(key, Date.now());
    logger.warn(text);
}
/** The counts of some members of a server, for the periods the rules use. `totals` can already be known (the flush has them). */
async function countsOf(guildId, userIds, rules, query = getPrimaryPool().query, known) {
    const out = new Map();
    for (const id of userIds)
        out.set(id, { total: known?.get(id) ?? 0, periods: new Map() });
    if (!userIds.length)
        return out;
    if (!known && rules.some((rule) => rule.mode === 'total')) {
        for (const row of (await query(exports.SQL.total, [guildId, userIds])).rows) {
            const entry = out.get(String(row.user_id));
            if (entry)
                entry.total = Number(row.messages) || 0;
        }
    }
    const periods = [...new Set(rules.filter((rule) => rule.mode === 'period').map((rule) => rule.periodDays))];
    for (const days of periods) {
        for (const row of (await query(exports.SQL.period, [guildId, userIds, days])).rows)
            out.get(String(row.user_id))?.periods.set(days, Number(row.n) || 0);
    }
    return out;
}
function usableRole(guild, roleId) {
    const role = guild.roles.cache.get(roleId);
    const me = guild.members.me;
    if (!role) {
        complainOnce(`${guild.id}:${roleId}`, `Message roles: the role ${roleId} of guild ${guild.id} does not exist any more.`);
        return false;
    }
    if (role.managed || (me && role.position >= me.roles.highest.position)) {
        complainOnce(`${guild.id}:${roleId}`, `Message roles: Petto cannot give or take the role ${roleId} in guild ${guild.id} (managed, or above its own role).`);
        return false;
    }
    return true;
}
/** Gives and takes the roles of one member from their counts. How many changes were made. */
async function applyToMember(guild, member, rules, counts) {
    if (member.user.bot)
        return 0;
    const due = changesFor(new Set(member.roles.cache.keys()), rules, counts);
    let changes = 0;
    for (const rule of due.add) {
        if (!usableRole(guild, rule.roleId))
            continue;
        try {
            await member.roles.add(rule.roleId, `Message role: ${rule.messages} messages${rule.mode === 'period' ? ` in ${rule.periodDays} days` : ''}`);
            changes += 1;
            await sleep(GAP_MS);
        }
        catch (error) {
            complainOnce(`${guild.id}:${rule.roleId}:add`, `Message roles: could not give ${rule.roleId} in guild ${guild.id}: ${error.message}`);
            notePermissionProblem(guild.client, error, { guild, feature: 'task' });
        }
    }
    for (const rule of due.remove) {
        if (!usableRole(guild, rule.roleId))
            continue;
        try {
            await member.roles.remove(rule.roleId, `Message role: under ${rule.messages} messages in ${rule.periodDays} days`);
            changes += 1;
            await sleep(GAP_MS);
        }
        catch (error) {
            complainOnce(`${guild.id}:${rule.roleId}:remove`, `Message roles: could not take ${rule.roleId} in guild ${guild.id}: ${error.message}`);
            notePermissionProblem(guild.client, error, { guild, feature: 'task' });
        }
    }
    return changes;
}
/**
 * Writes what was counted (two statements for all the servers at once) and looks at the members who wrote: they get the roles they now reach. A failed write keeps the counts for the next flush.
 * Returns how many role changes were made.
 */
async function flush(client, query = getPrimaryPool().query) {
    if (!pending.size)
        return 0;
    const batch = [...pending.values()];
    pending.clear();
    const byTotal = new Map();
    for (const row of batch) {
        const key = `${row.guildId}:${row.userId}`;
        const entry = byTotal.get(key);
        if (entry)
            entry.n += row.n;
        else
            byTotal.set(key, { guildId: row.guildId, userId: row.userId, n: row.n });
    }
    const totals = [...byTotal.values()];
    const totalsNow = new Map(); // `${guild}:${user}` -> the total after this batch
    try {
        for (const row of (await query(exports.SQL.totals, [totals.map((r) => r.guildId), totals.map((r) => r.userId), totals.map((r) => r.n)])).rows)
            totalsNow.set(`${row.guild_id}:${row.user_id}`, Number(row.messages) || 0);
        await query(exports.SQL.days, [batch.map((r) => r.guildId), batch.map((r) => r.userId), batch.map((r) => r.day), batch.map((r) => r.n)]);
    }
    catch (error) {
        logger.warn(`[Message roles] the counts could not be written, kept for the next time: ${error.message}`);
        for (const row of batch) {
            const key = `${row.guildId}:${row.userId}:${row.day}`;
            const again = pending.get(key);
            if (again)
                again.n += row.n;
            else
                pending.set(key, row);
        }
        return 0;
    }
    const guilds = new Map();
    for (const row of totals) {
        const set = guilds.get(row.guildId) ?? new Set();
        set.add(row.userId);
        guilds.set(row.guildId, set);
    }
    let changes = 0;
    for (const [guildId, users] of guilds) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild)
            continue;
        try {
            const rules = (await (0, messageRoles_1.rulesOf)(guildId)).filter((rule) => rule.enabled);
            if (!rules.length)
                continue;
            const ids = [...users].slice(0, PER_GUILD_PER_FLUSH);
            const known = new Map(ids.map((id) => [id, totalsNow.get(`${guildId}:${id}`) ?? 0]));
            const counts = await countsOf(guildId, ids, rules, query, known);
            for (const id of ids) {
                const member = guild.members.cache.get(id) ?? await guild.members.fetch(id).catch(() => null);
                if (member)
                    changes += await applyToMember(guild, member, rules, counts.get(id));
            }
        }
        catch (error) {
            logger.error(`Message roles error in guild ${guildId}:`, error);
        }
    }
    return changes;
}
/** One server: the roles of `period` rules with `remove_below` are taken from the members who no longer reach them (up to `PER_GUILD_PER_RUN` changes). */
async function runGuild(guild, query = getPrimaryPool().query) {
    const rules = (await (0, messageRoles_1.rulesOf)(guild.id)).filter((rule) => rule.enabled && rule.mode === 'period' && rule.removeBelow);
    if (!rules.length)
        return 0;
    if (guild.memberCount > MAX_MEMBERS) {
        complainOnce(`${guild.id}:big`, `Message roles: guild ${guild.id} has more than ${MAX_MEMBERS} members, skipped.`);
        return 0;
    }
    const all = (await (0, messageRoles_1.rulesOf)(guild.id)).filter((rule) => rule.enabled);
    const members = await guild.members.fetch().catch(() => guild.members.cache);
    const roleIds = new Set(rules.map((rule) => rule.roleId));
    const holders = [...members.values()].filter((member) => !member.user.bot && [...roleIds].some((roleId) => member.roles.cache.has(roleId)));
    let changes = 0;
    for (let i = 0; i < holders.length && changes < PER_GUILD_PER_RUN; i += 500) {
        const chunk = holders.slice(i, i + 500);
        const counts = await countsOf(guild.id, chunk.map((m) => m.id), all, query);
        for (const member of chunk) {
            if (changes >= PER_GUILD_PER_RUN)
                break;
            const due = changesFor(new Set(member.roles.cache.keys()), all, counts.get(member.id));
            if (!due.remove.length)
                continue;
            changes += await applyToMember(guild, member, all.filter((rule) => rule.removeBelow), counts.get(member.id));
        }
    }
    return changes;
}
/** Every server that has such rules, one after the other. */
async function runRemovals(client) {
    const { rows } = await getPrimaryPool().query("select distinct guild_id from message_roles where enabled and mode = 'period' and remove_below");
    for (const row of rows) {
        const guild = client.guilds.cache.get(String(row.guild_id));
        if (!guild)
            continue;
        try {
            await runGuild(guild);
        }
        catch (error) {
            logger.error(`Message roles error in guild ${guild.id}:`, error);
        }
    }
}
/** The days older than a year are not needed by any rule (the longest period is 365 days). */
async function prune(query = getPrimaryPool().query) {
    await query(exports.SQL.prune);
}
