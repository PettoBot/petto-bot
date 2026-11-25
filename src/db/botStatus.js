"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertShardStatus = upsertShardStatus;
const database = require('./database');
const { retryIdempotent } = require('../utils/transientDb');
async function upsertShardStatus(shardId, status, guildCount, pingMs, extra = {}) {
    const row = {
        shard_id: shardId,
        status,
        guild_count: guildCount,
        ping_ms: pingMs,
        member_count: Math.max(0, Math.round(Number(extra.memberCount) || 0)),
        cluster_name: extra.clusterName ?? null,
        cluster_location: extra.clusterLocation ?? null,
        updated_at: new Date().toISOString(),
    };
    await retryIdempotent(async () => {
        const { error } = await database.from('bot_status').upsert(row, { onConflict: 'shard_id' });
        if (error)
            throw error;
    });
}
