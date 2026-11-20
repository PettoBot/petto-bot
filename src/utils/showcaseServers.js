"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ONLINE_EVERY_MS = exports.MAX_SERVERS = exports.MIN_MEMBERS = void 0;
exports.pickShowcase = pickShowcase;
exports.badgesOf = badgesOf;
exports.readHiddenGuildIds = readHiddenGuildIds;
exports.buildShowcase = buildShowcase;
exports.resetShowcase = resetShowcase;
const { getPrimaryPool } = require('../db/postgres');
exports.MIN_MEMBERS = 500;
exports.MAX_SERVERS = 15;
/** How long the number of online members of a server is kept before it is asked again: it costs one request to Discord for each server. */
exports.ONLINE_EVERY_MS = 5 * 60_000;
/** The servers that show: 500 members or more, not hidden, the biggest first, at most 15. Ties keep the order of the id, so the list does not jump. */
function pickShowcase(candidates, hidden = new Set(), min = exports.MIN_MEMBERS, max = exports.MAX_SERVERS) {
    return candidates
        .filter((entry) => Number.isFinite(entry.members) && entry.members >= min && !hidden.has(entry.id))
        .sort((a, b) => b.members - a.members || (a.id < b.id ? -1 : 1))
        .slice(0, max);
}
/** The marks of a server that the carousel shows, from the features Discord lists. */
function badgesOf(features = []) {
    const badges = [];
    if (features.includes('PARTNERED'))
        badges.push('partnered');
    if (features.includes('VERIFIED'))
        badges.push('verified');
    if (features.includes('DISCOVERABLE'))
        badges.push('discoverable');
    else if (features.includes('COMMUNITY'))
        badges.push('community');
    return badges;
}
/** The ids of the servers that asked to be left out of the public numbers. */
async function readHiddenGuildIds() {
    const { rows } = await getPrimaryPool().query('select guild_id from guilds where global_stats_hidden');
    return new Set(rows.map((row) => String(row.guild_id)));
}
const onlineCache = new Map();
/** Members online now of a server (Discord's approximate count), kept for five minutes; the last known number stays when Discord does not answer. */
async function onlineOf(client, guild, now) {
    const known = onlineCache.get(guild.id);
    if (known && now - known.at < exports.ONLINE_EVERY_MS)
        return known.value;
    const fetched = await client.guilds.fetch({ guild: guild.id, withCounts: true, force: true }).catch(() => null);
    const value = typeof fetched?.approximatePresenceCount === 'number' ? fetched.approximatePresenceCount : (known?.value ?? null);
    onlineCache.set(guild.id, { value, at: now });
    return value;
}
/** The carousel as the website reads it. Servers that left the bot are forgotten, so the cache does not grow. */
async function buildShowcase(client, hidden, now = Date.now()) {
    const left = hidden ?? await readHiddenGuildIds();
    const guilds = [...client.guilds.cache.values()];
    const picked = pickShowcase(guilds.map((guild) => ({ id: guild.id, members: Number(guild.memberCount) || 0, guild })), left);
    const showing = new Set(picked.map((entry) => entry.id));
    for (const id of [...onlineCache.keys()])
        if (!showing.has(id))
            onlineCache.delete(id);
    const servers = [];
    for (const { guild, members } of picked) {
        servers.push({
            id: guild.id,
            name: guild.name,
            icon: guild.icon ? guild.iconURL({ size: 128, forceStatic: false }) : null,
            animated: Boolean(guild.icon?.startsWith('a_')),
            members,
            online: await onlineOf(client, guild, now),
            badges: badgesOf(guild.features),
            boost: Math.min(3, Math.max(0, Number(guild.premiumTier) || 0)),
        });
    }
    return servers;
}
/** Forgets the online numbers (used by the checks). */
function resetShowcase() { onlineCache.clear(); }
