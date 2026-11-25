"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ONLINE_EVERY_MS = exports.MAX_SERVERS = exports.MIN_MEMBERS = void 0;
exports.pickShowcase = pickShowcase;
exports.badgeOf = badgeOf;
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
/**
 * The badge of a server, in the order the Discord app uses: partnered, verified, discoverable, community, then the boost level when it has at least one boost.
 * A boost makes the discoverable and the community badges their boosted look.
 */
function badgeOf(features = [], boosts = 0, tier = 0) {
    const boosted = Number(boosts) >= 1;
    if (features.includes('PARTNERED'))
        return 'partnered';
    if (features.includes('VERIFIED'))
        return 'verified';
    if (features.includes('DISCOVERABLE'))
        return boosted ? 'discoverable-boosted' : 'discoverable';
    if (features.includes('COMMUNITY'))
        return boosted ? 'community-boosted' : 'community';
    if (!boosted)
        return null;
    const level = Math.min(3, Math.max(0, Math.floor(Number(tier) || 0)));
    return `boost-${level}`;
}
/** The ids of the servers that asked to be left out of the public numbers. */
async function readHiddenGuildIds() {
    const { rows } = await getPrimaryPool().query('select guild_id from guilds where global_stats_hidden');
    return new Set(rows.map((row) => String(row.guild_id)));
}
/** What Discord says about a server now, kept for five minutes: its online members and its badge (the badge of a server of another shard is only known this way). */
const liveCache = new Map();
/** Members online now of a server (Discord's approximate count) and its badge, kept for five minutes; the last known ones stay when Discord does not answer. */
async function liveOf(client, id, now) {
    const known = liveCache.get(id);
    if (known && now - known.at < exports.ONLINE_EVERY_MS)
        return known;
    const fetched = await client.guilds.fetch({ guild: id, withCounts: true, force: true }).catch(() => null);
    const value = {
        online: typeof fetched?.approximatePresenceCount === 'number' ? fetched.approximatePresenceCount : (known?.online ?? null),
        badge: fetched ? badgeOf(fetched.features, fetched.premiumSubscriptionCount ?? 0, Number(fetched.premiumTier) || 0) : (known?.badge ?? null),
        at: now,
    };
    liveCache.set(id, value);
    return value;
}
/** The picture of a server from its icon hash, for a server this process does not have in memory. */
const otherIcon = (id, hash) => (hash ? `https://cdn.discordapp.com/icons/${id}/${hash}.${hash.startsWith('a_') ? 'gif' : 'webp'}?size=128` : null);
/**
 * The carousel as the website reads it. Servers that left the bot are forgotten, so the cache does not grow. `others` are the servers of the shards that another instance holds
 * (the bot split between a primary and workers): without them the carousel would only have the servers of this process.
 */
async function buildShowcase(client, hidden, now = Date.now(), others = []) {
    const left = hidden ?? await readHiddenGuildIds();
    const guilds = [...client.guilds.cache.values()];
    const mine = new Set(guilds.map((guild) => guild.id));
    const candidates = [
        ...guilds.map((guild) => ({ id: guild.id, members: Number(guild.memberCount) || 0, guild: guild, other: null })),
        ...others.filter((other) => !mine.has(other.id)).map((other) => ({ id: other.id, members: Number(other.members) || 0, guild: null, other })),
    ];
    const picked = pickShowcase(candidates, left);
    const showing = new Set(picked.map((entry) => entry.id));
    for (const id of [...liveCache.keys()])
        if (!showing.has(id))
            liveCache.delete(id);
    const servers = [];
    for (const { id, guild, other, members } of picked) {
        const live = await liveOf(client, id, now);
        servers.push({
            id,
            name: guild?.name ?? other?.name ?? '',
            icon: guild ? (guild.icon ? guild.iconURL({ size: 128, forceStatic: false }) : null) : otherIcon(id, other?.icon ?? null),
            animated: Boolean((guild ? guild.icon : other?.icon)?.startsWith('a_')),
            members,
            online: live.online,
            badge: guild ? badgeOf(guild.features, guild.premiumSubscriptionCount ?? 0, Number(guild.premiumTier) || 0) : live.badge,
        });
    }
    return servers;
}
/** Forgets what Discord said about the servers (used by the checks). */
function resetShowcase() { liveCache.clear(); }
