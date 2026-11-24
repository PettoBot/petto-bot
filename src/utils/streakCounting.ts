// i18n-ignore-file: nothing here is shown to anyone.
// What counts as a message for a streak: the rules of the server (at least some characters, one counted message every so many seconds, only or everywhere but some channels
// or roles, and a reaction that counts as a message) applied to each message or reaction, and the counted ones written as days. Written in TypeScript: `npm run build:ts` compiles it over streakCounting.js.
import type { Filters } from '../db/streakCounts';
const countsDb = require('../db/streakCounts') as typeof import('../db/streakCounts');
const { botDay } = require('./botTime') as { botDay: (date?: Date) => string };

export interface Candidate { guildId: string; userId: string; /** The length of the text (0 for a reaction, which the rule of length does not ask). */ length: number | null; channelIds: string[]; roleIds: string[]; at?: number }

/** Whether the channel (or the thread, channel or category it is in) passes the rule. */
export function channelPasses(filters: Filters, channelIds: string[]): boolean {
  if (filters.channelMode === 'all') return true;
  const hit = channelIds.some((id) => filters.channelIds.includes(id));
  return filters.channelMode === 'only' ? hit : !hit;
}
/** Whether the roles of the person pass the rule. */
export function rolesPass(filters: Filters, roleIds: string[]): boolean {
  if (filters.roleMode === 'all') return true;
  const hit = roleIds.some((id) => filters.roleIds.includes(id));
  return filters.roleMode === 'only' ? hit : !hit;
}

// The last counted moment of each person in each server (for the cooldown). Forgotten when it is old, so it does not grow for ever.
const lastCounted = new Map<string, number>();
const FORGET_AFTER_MS = 3_600_000;
function forgetOld(now: number): void {
  if (lastCounted.size < 20_000) return;
  for (const [key, at] of lastCounted) if (now - at > FORGET_AFTER_MS) lastCounted.delete(key);
}

/** Whether this message or reaction counts, and if it does, remembers the moment (for the cooldown) and queues the day. Returns whether it counted. */
export function consider(filters: Filters, candidate: Candidate, queue: (guildId: string, userId: string, day: string) => void = countsDb.queueDay): boolean {
  const now = candidate.at ?? Date.now();
  if (candidate.length !== null && candidate.length < filters.minLength) return false;
  if (!channelPasses(filters, candidate.channelIds) || !rolesPass(filters, candidate.roleIds)) return false;
  const key = `${candidate.guildId}:${candidate.userId}`;
  if (filters.cooldownSeconds > 0) {
    const last = lastCounted.get(key);
    if (last !== undefined && now - last < filters.cooldownSeconds * 1000) return false;
  }
  lastCounted.set(key, now);
  forgetOld(now);
  queue(candidate.guildId, candidate.userId, botDay(new Date(now)));
  return true;
}

// The rules of the servers that filter, kept a minute.
let filters = new Map<string, Filters>();
let loadedAt = 0;
let loading: Promise<void> | null = null;
const FRESH_MS = 60_000;
/** The rules of a server, or undefined when it does not filter. Reads again when they are older than a minute (without making the message wait). */
export function rulesOf(guildId: string): Filters | undefined {
  if (Date.now() - loadedAt > FRESH_MS && !loading) {
    loading = countsDb.loadFilters().then((next) => { filters = next; loadedAt = Date.now(); }).catch(() => { loadedAt = Date.now() - FRESH_MS + 10_000; }).finally(() => { loading = null; });
  }
  return filters.get(guildId);
}

/** Only for the checks. */
export function setForTests(next: Map<string, Filters>): void { filters = next; loadedAt = Date.now() + 365 * 86_400_000; lastCounted.clear(); }
