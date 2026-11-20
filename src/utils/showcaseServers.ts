// i18n-ignore-file: the data is for the website (the carousel of the home page); the website writes the words.
// The servers of the carousel on the home page of the website: the ones with 500 members or more, the biggest first, at most 15, each with its
// name, icon (animated when it is), the members and how many are online, and the marks Discord gives it (discoverable, verified, partnered).
// A server that chose to be left out of the public numbers (`guilds.global_stats_hidden`, the switch of the dashboard for the public stats) is never in it.
// When a server with more members than the last one appears, it takes its place and the last one goes out: the list is made again every time.
// Written in TypeScript: `npm run build:ts` compiles it over utils/showcaseServers.js.
import type { Client, Guild } from 'discord.js';

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
const { getPrimaryPool } = require('../db/postgres') as { getPrimaryPool: () => { query: Query } };

export const MIN_MEMBERS = 500;
export const MAX_SERVERS = 15;
/** How long the number of online members of a server is kept before it is asked again: it costs one request to Discord for each server. */
export const ONLINE_EVERY_MS = 5 * 60_000;

export type Badge = 'discoverable' | 'verified' | 'partnered';

export interface ShowcaseServer {
  id: string;
  name: string;
  /** The picture of the server (a GIF when it is animated), or null when it has none. */
  icon: string | null;
  animated: boolean;
  members: number;
  /** Members online now, or null while Discord has not said. */
  online: number | null;
  badges: Badge[];
}

/** What is known of a server before it is decided whether it shows. */
export interface Candidate { id: string; members: number }

/** The servers that show: 500 members or more, not hidden, the biggest first, at most 15. Ties keep the order of the id, so the list does not jump. */
export function pickShowcase<T extends Candidate>(candidates: T[], hidden: ReadonlySet<string> = new Set(), min = MIN_MEMBERS, max = MAX_SERVERS): T[] {
  return candidates
    .filter((entry) => Number.isFinite(entry.members) && entry.members >= min && !hidden.has(entry.id))
    .sort((a, b) => b.members - a.members || (a.id < b.id ? -1 : 1))
    .slice(0, max);
}

/** The marks of a server that the carousel shows, from the features Discord lists. */
export function badgesOf(features: readonly string[] = []): Badge[] {
  const badges: Badge[] = [];
  if (features.includes('DISCOVERABLE')) badges.push('discoverable');
  if (features.includes('VERIFIED')) badges.push('verified');
  if (features.includes('PARTNERED')) badges.push('partnered');
  return badges;
}

/** The ids of the servers that asked to be left out of the public numbers. */
export async function readHiddenGuildIds(): Promise<Set<string>> {
  const { rows } = await getPrimaryPool().query('select guild_id from guilds where global_stats_hidden');
  return new Set(rows.map((row) => String(row.guild_id)));
}

const onlineCache = new Map<string, { value: number | null; at: number }>();

/** Members online now of a server (Discord's approximate count), kept for five minutes; the last known number stays when Discord does not answer. */
async function onlineOf(client: Client, guild: Guild, now: number): Promise<number | null> {
  const known = onlineCache.get(guild.id);
  if (known && now - known.at < ONLINE_EVERY_MS) return known.value;
  const fetched = await client.guilds.fetch({ guild: guild.id, withCounts: true, force: true }).catch(() => null);
  const value = typeof fetched?.approximatePresenceCount === 'number' ? fetched.approximatePresenceCount : (known?.value ?? null);
  onlineCache.set(guild.id, { value, at: now });
  return value;
}

/** The carousel as the website reads it. Servers that left the bot are forgotten, so the cache does not grow. */
export async function buildShowcase(client: Client, hidden?: ReadonlySet<string>, now = Date.now()): Promise<ShowcaseServer[]> {
  const left = hidden ?? await readHiddenGuildIds();
  const guilds = [...client.guilds.cache.values()];
  const picked = pickShowcase(guilds.map((guild) => ({ id: guild.id, members: Number(guild.memberCount) || 0, guild })), left);
  const showing = new Set(picked.map((entry) => entry.id));
  for (const id of [...onlineCache.keys()]) if (!showing.has(id)) onlineCache.delete(id);
  const servers: ShowcaseServer[] = [];
  for (const { guild, members } of picked) {
    servers.push({
      id: guild.id,
      name: guild.name,
      icon: guild.icon ? guild.iconURL({ size: 128, forceStatic: false }) : null,
      animated: Boolean(guild.icon?.startsWith('a_')),
      members,
      online: await onlineOf(client, guild, now),
      badges: badgesOf(guild.features),
    });
  }
  return servers;
}

/** Forgets the online numbers (used by the checks). */
export function resetShowcase(): void { onlineCache.clear(); }
