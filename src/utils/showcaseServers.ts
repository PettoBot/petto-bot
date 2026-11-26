// i18n-ignore-file: the data is for the website (the carousel of the home page); the website writes the words.
// The servers of the carousel on the home page of the website: the ones with 500 members or more, the biggest first, at most 15, each with its
// name, icon (animated when it is), the members and how many are online, and the badge the Discord app shows for it.
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

/** The marks of a server, in the order the carousel draws them (the ones the Discord app itself has an icon for: community alone has none). */
/**
 * The badge of a server, the one the Discord app shows next to its name (the file of the same name in `public/assets/discord-badges/` of the website):
 * partnered, verified, discoverable (with a boost: `discoverable-boosted`), community (`community-boosted`), and a boosted server that is none of those, by its level (`boost-0` to `boost-3`).
 */
export type Badge = 'partnered' | 'verified' | 'discoverable' | 'discoverable-boosted' | 'community' | 'community-boosted' | 'boost-0' | 'boost-1' | 'boost-2' | 'boost-3';

export interface ShowcaseServer {
  id: string;
  name: string;
  /** The picture of the server (a GIF when it is animated), or null when it has none. */
  icon: string | null;
  animated: boolean;
  members: number;
  /** Members online now, or null while Discord has not said. */
  online: number | null;
  /** The badge of the server, or null when it has none. */
  badge: Badge | null;
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

/**
 * The badge of a server, in the order the Discord app uses: partnered, verified, discoverable, community, then the boost level when it has at least one boost.
 * A boost makes the discoverable and the community badges their boosted look.
 */
export function badgeOf(features: readonly string[] = [], boosts = 0, tier = 0): Badge | null {
  const boosted = Number(boosts) >= 1;
  if (features.includes('PARTNERED')) return 'partnered';
  if (features.includes('VERIFIED')) return 'verified';
  if (features.includes('DISCOVERABLE')) return boosted ? 'discoverable-boosted' : 'discoverable';
  if (features.includes('COMMUNITY')) return boosted ? 'community-boosted' : 'community';
  if (!boosted) return null;
  const level = Math.min(3, Math.max(0, Math.floor(Number(tier) || 0)));
  return `boost-${level}` as Badge;
}

/** The ids of the servers that asked to be left out of the public numbers. */
export async function readHiddenGuildIds(): Promise<Set<string>> {
  const { rows } = await getPrimaryPool().query('select guild_id from guilds where global_stats_hidden');
  return new Set(rows.map((row) => String(row.guild_id)));
}

/** What Discord says about a server now, kept for five minutes: its online members and its badge (the badge of a server of another shard is only known this way). */
const liveCache = new Map<string, { online: number | null; badge: Badge | null; at: number }>();

/** Members online now of a server (Discord's approximate count) and its badge, kept for five minutes; the last known ones stay when Discord does not answer. */
async function liveOf(client: Client, id: string, now: number): Promise<{ online: number | null; badge: Badge | null }> {
  const known = liveCache.get(id);
  if (known && now - known.at < ONLINE_EVERY_MS) return known;
  // Asked to Discord directly (REST) and not with `client.guilds.fetch`: that one keeps what it gets in `client.guilds.cache`, and a server of another shard would stay in this
  // process as an empty copy (no member count): it was counted as one more server of this process, and it left the carousel the next time it was built.
  const { Routes } = require('discord.js') as typeof import('discord.js');
  const raw = await (client.rest.get(Routes.guild(id), { query: new URLSearchParams({ with_counts: 'true' }) }) as Promise<{ approximate_presence_count?: number; features?: string[]; premium_subscription_count?: number; premium_tier?: number }>).catch(() => null);
  const value = {
    online: typeof raw?.approximate_presence_count === 'number' ? raw.approximate_presence_count : (known?.online ?? null),
    badge: raw ? badgeOf(raw.features ?? [], raw.premium_subscription_count ?? 0, Number(raw.premium_tier) || 0) : (known?.badge ?? null),
    at: now,
  };
  liveCache.set(id, value);
  return value;
}

/** A server of another shard (the copy that the instance holding it saved): enough to pick it and to draw it, its online members and badge are asked to Discord. */
export interface OtherGuild { id: string; name: string; icon: string | null; members: number | null }

/** The picture of a server from its icon hash, for a server this process does not have in memory. */
const otherIcon = (id: string, hash: string | null): string | null => (hash ? `https://cdn.discordapp.com/icons/${id}/${hash}.${hash.startsWith('a_') ? 'gif' : 'webp'}?size=128` : null);

/**
 * The carousel as the website reads it. Servers that left the bot are forgotten, so the cache does not grow. `others` are the servers of the shards that another instance holds
 * (the bot split between a primary and workers): without them the carousel would only have the servers of this process.
 */
export async function buildShowcase(client: Client, hidden?: ReadonlySet<string>, now = Date.now(), others: readonly OtherGuild[] = []): Promise<ShowcaseServer[]> {
  const left = hidden ?? await readHiddenGuildIds();
  const guilds = [...client.guilds.cache.values()];
  const mine = new Set(guilds.map((guild) => guild.id));
  const candidates = [
    ...guilds.map((guild) => ({ id: guild.id, members: Number(guild.memberCount) || 0, guild: guild as Guild | null, other: null as OtherGuild | null })),
    ...others.filter((other) => !mine.has(other.id)).map((other) => ({ id: other.id, members: Number(other.members) || 0, guild: null as Guild | null, other })),
  ];
  const picked = pickShowcase(candidates, left);
  const showing = new Set(picked.map((entry) => entry.id));
  for (const id of [...liveCache.keys()]) if (!showing.has(id)) liveCache.delete(id);
  const servers: ShowcaseServer[] = [];
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
export function resetShowcase(): void { liveCache.clear(); }
