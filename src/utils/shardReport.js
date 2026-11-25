"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clusterOf = clusterOf;
exports.statusLabel = statusLabel;
exports.collectShards = collectShards;
exports.shardForPing = shardForPing;
// i18n-ignore-file: what an instance says about its own shards for the status page, and the shard line of /ping; nothing here is a text for people.
// Every instance (the primary and each worker, see docs/SECOND_INSTANCE.md) reports the shards it holds: how many servers and members they have, their ping and state, and the name and place of
// the instance (a "cluster": a group of shards that live in one process), so the status page can show every shard and not only the ones of the primary.
// Written in TypeScript: `npm run build:ts` compiles it over utils/shardReport.js. Plain functions, checked on their own (scripts/check-shard-status.js).
const discord_js_1 = require("discord.js");
const MAX_TEXT = 40;
/** A short, plain text for a name or a place: no control characters, no double spaces, at most 40 characters; null when there is nothing left. */
function plain(value) {
    const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT).trim();
    return text || null;
}
function clusterOf(env = process.env) {
    return { name: plain(env.PETTO_CLUSTER_NAME), location: plain(env.PETTO_CLUSTER_LOCATION) };
}
/** The name Discord.js gives to the state of a shard (`Ready`, `Connecting`...), or `Unknown`. */
function statusLabel(status) {
    return discord_js_1.Status[status] ?? 'Unknown';
}
/** One row for each shard this instance holds: its state, ping and how many servers and members its servers have. */
function collectShards(client) {
    const guilds = new Map();
    const members = new Map();
    for (const guild of client.guilds.cache.values()) {
        const id = guild.shardId ?? 0;
        guilds.set(id, (guilds.get(id) ?? 0) + 1);
        members.set(id, (members.get(id) ?? 0) + (Number(guild.memberCount) || 0));
    }
    const rows = [];
    for (const [shardId, shard] of client.ws.shards) {
        rows.push({
            shardId,
            status: statusLabel(shard.status),
            guildCount: guilds.get(shardId) ?? 0,
            memberCount: members.get(shardId) ?? 0,
            pingMs: shard.ping >= 0 ? Math.round(shard.ping) : null,
        });
    }
    return rows.sort((a, b) => a.shardId - b.shardId);
}
function shardForPing(client, guild) {
    // A client that is not whole (a fake one in a check, or one that has not loaded its shards yet) says 1/1 instead of failing.
    const held = [...(client.ws?.shards?.keys() ?? [])].sort((a, b) => a - b);
    // Where it was used: the shard of that server. In a direct message there is no server: the first shard this instance holds.
    const id = typeof guild?.shardId === 'number' ? guild.shardId : (held[0] ?? 0);
    let guilds = 0;
    for (const each of client.guilds?.cache?.values?.() ?? [])
        if ((each.shardId ?? 0) === id)
            guilds += 1;
    const configured = Number(client.options?.shardCount) || 1;
    return { shard: id + 1, shardCount: Math.max(configured, id + 1, ...held.map((each) => each + 1)), guilds };
}
