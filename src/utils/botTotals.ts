// i18n-ignore-file: numbers and names read for the jobs that work on the whole bot; nothing here is a text for people.
// What the whole bot has (its servers and members) when its shards are held by more than one instance (the primary and the workers, docs/SECOND_INSTANCE.md).
// A process only has in its cache the servers of its own shards, so a job that counts or looks for "every server of the bot" (the totals of the public stats, the
// channels of the category "@ stats", the carousel of the home page, the cleanup of the servers that Petto left) must not read `client.guilds.cache` alone: every
// instance saves a copy of each of its servers (`discord_guild_snapshots`), and that table is the list of the whole bot.
// Written in TypeScript: `npm run build:ts` compiles it over utils/botTotals.js. Checked on its own (scripts/check-bot-totals.js).
import type { Client } from 'discord.js';

interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
// Read when they are used, not when this file is loaded: the commands that only show a number (`/bot info`) must load without the configuration or the database.
const pool = (): Pool => (require('../db/postgres') as { getPrimaryPool: () => Pool }).getPrimaryPool();
const settings = (): { shards?: number[] | 'auto' | undefined; shardCount?: number | undefined } => { try { return require('../config'); } catch { return {}; } }; // without a configuration (a check) the bot is not split

/** True when this process does not hold every shard of the bot: the servers of the other shards are in the cache of another instance. */
export function isSplit(shards: number[] | 'auto' | undefined = settings().shards, count: number | undefined = settings().shardCount): boolean {
  if (!Array.isArray(shards) || !count) return false;
  return new Set(shards).size < count;
}

export interface Totals { servers: number; members: number; source: 'cache' | 'shards' | 'snapshots' }

/**
 * The totals of this process alone, from its cache (it costs nothing). `held`: the shards this process holds; a guild of another shard that ended up in the cache
 * (an empty copy left by a fetch) is not one of its servers and is not counted. Without `held`, or for a guild that does not say its shard, every guild counts.
 */
export function totalsFromCache(client: Pick<Client, 'guilds'>, held: readonly number[] = []): Totals {
  const guilds = [...client.guilds.cache.values()].filter((guild) => !held.length || typeof guild.shardId !== 'number' || held.includes(guild.shardId));
  return { servers: guilds.length, members: guilds.reduce((total, guild) => total + (Number(guild.memberCount) || 0), 0), source: 'cache' };
}

/**
 * How many servers the whole bot is in, and how many members they have together. With every shard in this process it is the cache (as it always was). Split between
 * instances it is this process (its cache, always the freshest) plus what every other shard says about itself every 10 seconds (`bot_status`); only when one of those shards
 * has never reported, the copies of the servers are used instead. Never less than this process sees by itself; if the database does not answer, this process alone.
 * (The copies alone are not enough for members: a copy without its member count adds nothing, and the total used to fall by a third and jump back and forth.)
 */
export async function readTotals(client: Pick<Client, 'guilds'>, split: boolean = isSplit()): Promise<Totals> {
  if (!split) return totalsFromCache(client);
  const { shards, shardCount } = settings();
  const held = Array.isArray(shards) ? shards : [];
  const local = totalsFromCache(client, held);
  const count = Number(shardCount) || 0;
  try {
    const { rows } = await pool().query('select shard_id, guild_count, member_count from bot_status where shard_id <> all($1::int[]) and shard_id < $2', [held, count]);
    const reported = new Set(rows.map((row) => Number(row.shard_id)));
    let complete = count > 0;
    for (let id = 0; id < count; id += 1) if (!held.includes(id) && !reported.has(id)) complete = false;
    if (complete) {
      const sum = (key: 'guild_count' | 'member_count') => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
      return { servers: local.servers + sum('guild_count'), members: local.members + sum('member_count'), source: 'shards' };
    }
  } catch { /* the copies below */ }
  try {
    const { rows } = await pool().query('select count(*)::int as servers, coalesce(sum(member_count), 0)::bigint as members from discord_guild_snapshots');
    return { servers: Math.max(Number(rows[0]?.servers) || 0, local.servers), members: Math.max(Number(rows[0]?.members) || 0, local.members), source: 'snapshots' };
  } catch {
    return local;
  }
}

/** What is kept of a server of another shard: enough to name it and draw its icon. */
export interface KnownGuild { id: string; name: string; icon: string | null; members: number | null }

const known = (row: Record<string, unknown>): KnownGuild => ({
  id: String(row.id),
  name: String(row.name ?? ''),
  icon: row.icon ? String(row.icon) : null,
  members: row.member_count === null || row.member_count === undefined ? null : Number(row.member_count),
});

// The column is read as `id` on purpose: the pool drops the rows of other shards from a `guild_id` answer made by a job (src/db/postgres.js), and these reads are for the whole bot.
/** The saved copy of some servers (name, icon hash, members), by id. */
export async function readKnownGuilds(ids: readonly string[]): Promise<Map<string, KnownGuild>> {
  const wanted = [...new Set(ids.map(String))];
  if (!wanted.length) return new Map();
  const { rows } = await pool().query('select guild_id as id, name, icon, member_count from discord_guild_snapshots where guild_id = any($1::text[])', [wanted]);
  return new Map(rows.map((row) => [String(row.id), known(row)]));
}

/** The servers with at least `min` members, the biggest first (the candidates for the carousel of the home page, from every shard). */
export async function readBigGuilds(min: number): Promise<KnownGuild[]> {
  const { rows } = await pool().query('select guild_id as id, name, icon, member_count from discord_guild_snapshots where member_count >= $1 order by member_count desc, guild_id', [min]);
  return rows.map(known);
}

/** How many saved copies there are and how many of them do not know their member count (those never reach the carousel or the totals), for the log of the stats job. */
export async function readSnapshotHealth(): Promise<{ total: number; withoutMembers: number }> {
  const { rows } = await pool().query('select count(*)::int as total, (count(*) filter (where member_count is null))::int as without_members from discord_guild_snapshots');
  return { total: Number(rows[0]?.total) || 0, withoutMembers: Number(rows[0]?.without_members) || 0 };
}

/** The ids of every server the bot is in, from the saved copies (only meaningful split between instances: each one removes the copy of a server it leaves). */
export async function readAllGuildIds(): Promise<Set<string>> {
  const { rows } = await pool().query('select guild_id as id from discord_guild_snapshots');
  return new Set(rows.map((row) => String(row.id)));
}

/** The picture of a server from its icon hash (a GIF when it is animated), for a server this process does not have in memory. */
export function iconUrl(id: string, hash: string | null, size = 64, format: 'png' | 'webp' = 'png'): string | null {
  if (!hash) return null;
  return `https://cdn.discordapp.com/icons/${id}/${hash}.${hash.startsWith('a_') ? 'gif' : format}?size=${size}`;
}

/** What each shard last said about itself (table `bot_status`): its state, and the name and place of the instance that holds it. */
export interface ShardLine { shardId: number; status: string; fresh: boolean; guildCount: number; memberCount: number; pingMs: number | null; ageMs: number; clusterName: string | null; clusterLocation: string | null }

const FRESH_MS = 5 * 60 * 1000;

/** The shards the whole bot reports, for `/about`: with the database down (or before the columns of the instance exist) it is an empty list, never an error. */
export async function readShardLines(now: number = Date.now()): Promise<ShardLine[]> {
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
  } catch {
    return [];
  }
}
