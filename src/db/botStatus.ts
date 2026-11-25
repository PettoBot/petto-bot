// i18n-ignore-file: database layer, nothing here is shown to anyone.
// The row of each gateway shard (table `bot_status`), overwritten on every heartbeat by the instance that holds the shard (the primary and every worker).
// Written in TypeScript: `npm run build:ts` compiles it over db/botStatus.js.
interface Table { upsert(row: Record<string, unknown>, options: { onConflict: string }): Promise<{ error: unknown }> }
const database = require('./database') as { from(table: string): Table };
const { retryIdempotent } = require('../utils/transientDb') as { retryIdempotent: <T>(task: () => Promise<T>) => Promise<T> };

/** What the status page shows besides the state: how many members the servers of the shard have, and the name and place of the instance that holds it. */
export interface ShardStatusExtra { memberCount?: number; clusterName?: string | null; clusterLocation?: string | null }

export async function upsertShardStatus(shardId: number, status: string, guildCount: number, pingMs: number | null, extra: ShardStatusExtra = {}): Promise<void> {
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
    if (error) throw error;
  });
}
