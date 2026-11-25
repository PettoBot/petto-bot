"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSplit = isSplit;
exports.totalsFromCache = totalsFromCache;
exports.readTotals = readTotals;
exports.readKnownGuilds = readKnownGuilds;
exports.readBigGuilds = readBigGuilds;
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
/** The totals of this process alone, from its cache (it costs nothing). */
function totalsFromCache(client) {
    const guilds = [...client.guilds.cache.values()];
    return { servers: guilds.length, members: guilds.reduce((total, guild) => total + (Number(guild.memberCount) || 0), 0), source: 'cache' };
}
/**
 * How many servers the whole bot is in, and how many members they have together. With every shard in this process it is the cache (as it always was); split between
 * instances it is read from the copies of the servers, and never less than what this process sees by itself. If the database does not answer, this process alone.
 */
async function readTotals(client, split = isSplit()) {
    const local = totalsFromCache(client);
    if (!split)
        return local;
    try {
        const { rows } = await pool().query('select count(*)::int as servers, coalesce(sum(member_count), 0)::bigint as members from discord_guild_snapshots');
        return { servers: Math.max(Number(rows[0]?.servers) || 0, local.servers), members: Math.max(Number(rows[0]?.members) || 0, local.members), source: 'snapshots' };
    }
    catch {
        return local;
    }
}
const known = (row) => ({
    id: String(row.guild_id),
    name: String(row.name ?? ''),
    icon: row.icon ? String(row.icon) : null,
    members: row.member_count === null || row.member_count === undefined ? null : Number(row.member_count),
});
/** The saved copy of some servers (name, icon hash, members), by id. */
async function readKnownGuilds(ids) {
    const wanted = [...new Set(ids.map(String))];
    if (!wanted.length)
        return new Map();
    const { rows } = await pool().query('select guild_id, name, icon, member_count from discord_guild_snapshots where guild_id = any($1::text[])', [wanted]);
    return new Map(rows.map((row) => [String(row.guild_id), known(row)]));
}
/** The servers with at least `min` members, the biggest first (the candidates for the carousel of the home page, from every shard). */
async function readBigGuilds(min) {
    const { rows } = await pool().query('select guild_id, name, icon, member_count from discord_guild_snapshots where member_count >= $1 order by member_count desc, guild_id', [min]);
    return rows.map(known);
}
/** The ids of every server the bot is in, from the saved copies (only meaningful split between instances: each one removes the copy of a server it leaves). */
async function readAllGuildIds() {
    const { rows } = await pool().query('select guild_id from discord_guild_snapshots');
    return new Set(rows.map((row) => String(row.guild_id)));
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
        const { rows } = await pool().query('select shard_id, status, updated_at, cluster_name, cluster_location from bot_status order by shard_id');
        return rows.map((row) => ({
            shardId: Number(row.shard_id),
            status: String(row.status ?? ''),
            fresh: now - new Date(String(row.updated_at)).getTime() < FRESH_MS,
            clusterName: row.cluster_name ? String(row.cluster_name) : null,
            clusterLocation: row.cluster_location ? String(row.cluster_location) : null,
        }));
    }
    catch {
        return [];
    }
}
