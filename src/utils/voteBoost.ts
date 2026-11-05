// The vote boost: a person who voted for the bot (top.gg or omniplex.gg) earns +10% XP for 12 hours in every server that
// has the boost on. Both lists share one expiry for each person: the latest one, never the sum of the votes.
//
// This file is pure apart from the lazy database read in `getVoteBoost`: the cache is a plain object built with
// `createVoteBoostCache` (so it can be checked with a fake loader and a fake clock) and the module keeps one of them.

export const VOTE_BOOST_PERCENT = 10;
export const VOTE_BOOST_HOURS = 12;
export const VOTE_BOOST_MS = VOTE_BOOST_HOURS * 60 * 60 * 1000;

/** How long "no boost" is remembered for a person, so a member who never voted costs no query per message. */
export const NEGATIVE_TTL_MS = 10 * 60 * 1000;
/** How long a failed read is remembered, so a database that is down is not asked again for every message. */
export const ERROR_TTL_MS = 30 * 1000;
/** The most people the cache holds; the oldest entries leave first. */
export const MAX_ENTRIES = 50_000;

export interface VoteBoost {
  percent: number;
  /** When the boost ends, in milliseconds since the epoch. */
  endsAt: number;
}

/** What a stored vote needs to say when it ends. The dates can be Date objects, ISO strings or milliseconds. */
export interface VoteRow {
  voted_at?: Date | string | number | null;
  expires_at?: Date | string | number | null;
}

function toMs(value: Date | string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** When one vote stops giving the boost: its own `expires_at` when it has one, else 12 hours after it was cast. Null for a row with neither. */
export function voteExpiry(row: VoteRow | null | undefined): number | null {
  if (!row) return null;
  const expires = toMs(row.expires_at);
  if (expires !== null) return expires;
  const votedAt = toMs(row.voted_at);
  return votedAt === null ? null : votedAt + VOTE_BOOST_MS;
}

/** The latest expiry over many votes (the weight of a vote and the day of the week do not matter), or null when none has a date. */
export function latestExpiry(rows: Iterable<VoteRow> | null | undefined): number | null {
  let latest: number | null = null;
  for (const row of rows ?? []) {
    const expiry = voteExpiry(row);
    if (expiry !== null && (latest === null || expiry > latest)) latest = expiry;
  }
  return latest;
}

/** The multiplier of a boost: 1.1 for the 10% boost, 1 for no boost. */
export function boostFactor(boost: VoteBoost | null | undefined): number {
  return boost ? 1 + boost.percent / 100 : 1;
}

/** The time left of a boost split in whole hours and minutes (a started minute counts), never negative. */
export function timeLeft(boost: VoteBoost, now: number = Date.now()): { hours: number; minutes: number } {
  const minutes = Math.max(0, Math.ceil((boost.endsAt - now) / 60_000));
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

/** `3h 20m`, `45m` or `2h`: the time left of a boost as short text (the same letters in every language). */
export function formatTimeLeft(boost: VoteBoost, now: number = Date.now()): string {
  const { hours, minutes } = timeLeft(boost, now);
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

const SNOWFLAKE = /^\d{15,25}$/;

interface Entry {
  /** The end of the boost, or null for a remembered "no boost". */
  endsAt: number | null;
  /** Until when this entry can be trusted. */
  until: number;
}

export interface VoteBoostCacheOptions {
  /** Reads the latest expiry of a person (milliseconds) or null when they have no recent vote. */
  load: (userId: string) => Promise<number | null>;
  now?: () => number;
  maxEntries?: number;
  negativeTtlMs?: number;
  errorTtlMs?: number;
  percent?: number;
}

export interface VoteBoostCache {
  get(userId: string): Promise<VoteBoost | null>;
  /** A vote was just stored: the person has the boost at once (never shortening one they already had). */
  note(userId: string, endsAt: number): void;
  size(): number;
  clear(): void;
}

export function createVoteBoostCache(options: VoteBoostCacheOptions): VoteBoostCache {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const negativeTtl = options.negativeTtlMs ?? NEGATIVE_TTL_MS;
  const errorTtl = options.errorTtlMs ?? ERROR_TTL_MS;
  const percent = options.percent ?? VOTE_BOOST_PERCENT;
  // A Map keeps insertion order, so the first key is the oldest entry; a write deletes the key first to make it the newest.
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<VoteBoost | null>>();

  function store(userId: string, entry: Entry): void {
    entries.delete(userId);
    entries.set(userId, entry);
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
  }

  function answer(entry: Entry): VoteBoost | null {
    return entry.endsAt === null ? null : { percent, endsAt: entry.endsAt };
  }

  async function get(userId: string): Promise<VoteBoost | null> {
    if (!SNOWFLAKE.test(String(userId))) return null;
    const at = now();
    const cached = entries.get(userId);
    if (cached && cached.until > at) return answer(cached);
    const running = pending.get(userId);
    if (running) return running;
    const request = (async (): Promise<VoteBoost | null> => {
      try {
        const endsAt = await options.load(userId);
        const readAt = now();
        if (endsAt !== null && endsAt > readAt) {
          // A vote noted while the read was in flight may already be newer than what the read saw.
          const current = entries.get(userId);
          const best = current?.endsAt && current.until > readAt ? Math.max(current.endsAt, endsAt) : endsAt;
          store(userId, { endsAt: best, until: best });
          return { percent, endsAt: best };
        }
        const current = entries.get(userId);
        if (current?.endsAt && current.until > readAt) return answer(current);
        store(userId, { endsAt: null, until: readAt + negativeTtl });
        return null;
      } catch {
        // The database could not say: no boost for now, and no new query for a short while. Nothing else is touched.
        store(userId, { endsAt: null, until: now() + errorTtl });
        return null;
      } finally {
        pending.delete(userId);
      }
    })();
    pending.set(userId, request);
    return request;
  }

  function note(userId: string, endsAt: number): void {
    if (!SNOWFLAKE.test(String(userId)) || !Number.isFinite(endsAt)) return;
    const at = now();
    if (endsAt <= at) return;
    const current = entries.get(userId);
    const best = current?.endsAt && current.until > at ? Math.max(current.endsAt, endsAt) : endsAt;
    store(userId, { endsAt: best, until: best });
  }

  return { get, note, size: () => entries.size, clear: () => { entries.clear(); pending.clear(); } };
}

// The cache the bot uses. The database is read the first time it is needed, so loading this file costs nothing.
const shared = createVoteBoostCache({
  load: async (userId) => {
    const { recentVotes } = require('../db/votes') as { recentVotes: (userId: string) => Promise<VoteRow[]> };
    return latestExpiry(await recentVotes(userId));
  },
});

/** The active boost of a person, or null. Answered from memory except once in a while for a person who voted or asked. */
export function getVoteBoost(userId: string): Promise<VoteBoost | null> {
  return shared.get(userId);
}

/** Tells the cache about a vote that was just stored (from a webhook), so the voter has the boost at once. */
export function noteVote(userId: string, endsAt: number): void {
  shared.note(userId, endsAt);
}

/**
 * The boost a member has in a server: null when the server turned the boost off (`level_config.vote_boost_enabled`, on unless it is
 * exactly false) or the person has none. One answer from memory, not one query per call.
 */
export async function boostFor(config: { vote_boost_enabled?: boolean | null } | null | undefined, userId: string): Promise<VoteBoost | null> {
  if (config?.vote_boost_enabled === false) return null;
  return shared.get(userId);
}

/** The expiry of a stored vote in the shape `noteVote` takes. */
export function expiryOfVote(vote: { votedAt?: Date | string | number | null; expiresAt?: Date | string | number | null }): number | null {
  return voteExpiry({ voted_at: vote.votedAt, expires_at: vote.expiresAt });
}

/** Drops everything remembered (used by the checks). */
export function resetVoteBoostCache(): void {
  shared.clear();
}
