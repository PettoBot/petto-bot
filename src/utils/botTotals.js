"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSplit = isSplit;
exports.totalsFromCache = totalsFromCache;
exports.readTotals = readTotals;
exports.readKnownGuilds = readKnownGuilds;
exports.readBigGuilds = readBigGuilds;
exports.readSnapshotHealth = readSnapshotHealth;
exports.readAllGuildIds = readAllGuildIds;
exports.iconUrl = iconUrl;
exports.readShardLines = readShardLines;
// Read when they are used, not when this file is loaded: the commands that only show a number (`/bot info`) must load without the configuration or the database.
const pool = () => require('../db/postgres').getPrimaryPool();
const settings = () => { try {
    return require('../config');
}
catch {
    return {};
} }; // without a configuration (a check) the bot is not split
/** True when this process does not hold every shard of the bot: the servers of the other shards are in the cache of another instance. */
function isSplit(shards = settings().shards, count = settings().shardCount) {
    if (!Array.isArray(shards) || !count)
        return false;
    return new Set(shards).size < count;
}
/**
 * The totals of this process alone, from its cache (it costs nothing). `held`: the shards this process holds; a guild of another shard that ended up in the cache
 * (an empty copy left by a fetch) is not one of its servers and is not counted. Without `held`, or for a guild that does not say its shard, every guild counts.
 */
function totalsFromCache(client, held = []) {
    const guilds = [...client.guilds.cache.values()].filter((guild) => !held.length || typeof guild.shardId !== 'number' || held.includes(guild.shardId));
    return { servers: guilds.length, members: guilds.reduce((total, guild) => total + (Number(guild.memberCount) || 0), 0), source: 'cache' };
}
/**
 * How many servers the whole bot is in, and how many members they have together. With every shard in this process it is the cache (as it always was). Split between
 * instances it is this process (its cache, always the freshest) plus what every other shard says about itself every 10 seconds (`bot_status`); only when one of those shards
 * has never reported, the copies of the servers are used instead. Never less than this process sees by itself; if the database does not answer, this process alone.
 * (The copies alone are not enough for members: a copy without its member count adds nothing, and the total used to fall by a third and jump back and forth.)
 */
async function readTotals(client, split = isSplit()) {
    if (!split)
        return totalsFromCache(client);
    const { shards, shardCount } = settings();
    const held = Array.isArray(shards) ? shards : [];
    const local = totalsFromCache(client, held);
    const count = Number(shardCount) || 0;
    try {
        const { rows } = await pool().query('select shard_id, guild_count, member_count from bot_status where shard_id <> all($1::int[]) and shard_id < $2', [held, count]);
        const reported = new Set(rows.map((row) => Number(row.shard_id)));
        let complete = count > 0;
        for (let id = 0; id < count; id += 1)
            if (!held.includes(id) && !reported.has(id))
                complete = false;
        if (complete) {
            const sum = (key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
            return { servers: local.servers + sum('guild_count'), members: local.members + sum('member_count'), source: 'shards' };
        }
    }
    catch { /* the copies below */ }
    try {
        const { rows } = await pool().query('select count(*)::int as servers, coalesce(sum(member_count), 0)::bigint as members from discord_guild_snapshots');
        return { servers: Math.max(Number(rows[0]?.servers) || 0, local.servers), members: Math.max(Number(rows[0]?.members) || 0, local.members), source: 'snapshots' };
    }
    catch {
        return local;
    }
}
const known = (row) => ({
    id: String(row.id),
    name: String(row.name ?? ''),
    icon: row.icon ? String(row.icon) : null,
    members: row.member_count === null || row.member_count === undefined ? null : Number(row.member_count),
});
// The column is read as `id` on purpose: the pool drops the rows of other shards from a `guild_id` answer made by a job (src/db/postgres.js), and these reads are for the whole bot.
/** The saved copy of some servers (name, icon hash, members), by id. */
async function readKnownGuilds(ids) {
    const wanted = [...new Set(ids.map(String))];
    if (!wanted.length)
        return new Map();
    const { rows } = await pool().query('select guild_id as id, name, icon, member_count from discord_guild_snapshots where guild_id = any($1::text[])', [wanted]);
    return new Map(rows.map((row) => [String(row.id), known(row)]));
}
/** The servers with at least `min` members, the biggest first (the candidates for the carousel of the home page, from every shard). */
async function readBigGuilds(min) {
    const { rows } = await pool().query('select guild_id as id, name, icon, member_count from discord_guild_snapshots where member_count >= $1 order by member_count desc, guild_id', [min]);
    return rows.map(known);
}
/** How many saved copies there are and how many of them do not know their member count (those never reach the carousel or the totals), for the log of the stats job. */
async function readSnapshotHealth() {
    const { rows } = await pool().query('select count(*)::int as total, (count(*) filter (where member_count is null))::int as without_members from discord_guild_snapshots');
    return { total: Number(rows[0]?.total) || 0, withoutMembers: Number(rows[0]?.without_members) || 0 };
}
/** The ids of every server the bot is in, from the saved copies (only meaningful split between instances: each one removes the copy of a server it leaves). */
async function readAllGuildIds() {
    const { rows } = await pool().query('select guild_id as id from discord_guild_snapshots');
    return new Set(rows.map((row) => String(row.id)));
}
/** The picture of a server from its icon hash (a GIF when it is animated), for a server this process does not have in memory. */
function iconUrl(id, hash, size = 64, format = 'png') {
    if (!hash)
        return null;
    return `https://cdn.discordapp.com/icons/${id}/${hash}.${hash.startsWith('a_') ? 'gif' : format}?size=${size}`;
}
const FRESH_MS = 5 * 60 * 1000;
/** The shards the whole bot reports, for `/about`: with the database down (or before the columns of the instance exist) it is an empty list, never an error. */
async function readShardLines(now = Date.now()) {
    try {
        const { rows } = await pool().query('select shard_id, status, guild_count, member_count, ping_ms, updated_at, cluster_name, cluster_location from bot_status order by shard_id');
        return rows.map((row) => ({
            shardId: Number(row.shard_id),
            status: String(row.status ?? ''),
            fresh: now - new Date(String(row.updated_at)).getTime() < FRESH_MS,
            ageMs: Math.max(0, now - new Date(String(row.updated_at)).getTime()) || 0,
            guildCount: Number(row.guild_count) || 0,
            memberCount: Number(row.member_count) || 0,
            pingMs: row.ping_ms === null || row.ping_ms === undefined ? null : Number(row.ping_ms),
            clusterName: row.cluster_name ? String(row.cluster_name) : null,
            clusterLocation: row.cluster_location ? String(row.cluster_location) : null,
        }));
    }
    catch {
        return [];
    }
}
