// The safety stop of the role triggers, typed: how many actions a minute a server may have, and the line of members who wait when it is passed.
// Plain functions and no Discord, so they are checked on their own (scripts/check-role-triggers.js). `roleTriggers.js` runs the actions.
//
// More than `limit` actions in `windowMs` in one server do not drop the rest: the members who are over the limit wait in a line (first in, first out) and
// `next` hands them out at the pace of the limit. The line holds what the limit can handle in `QUEUE_MINUTES` minutes; a member waits at most that long.
// Only when the line is full the rules of the server pause for `pauseMs`, and the members who were left alone are kept, so the staff can be told.

export const BREAKER_LIMIT = 5; // the default of a small server (see `defaultLimit`)
export const BREAKER_WINDOW_MS = 60_000;
export const BREAKER_PAUSE_MS = 10 * 60_000;
export const QUEUE_MINUTES = 10;
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 500;
const SKIPPED_KEPT = 50; // ids kept of the members who were not looked at (the count is always complete)

/** The default of how many actions a minute a server may have before its rules wait: a bigger server has more going on, and a raid is when the rules are needed. */
export function defaultLimit(memberCount: unknown): number {
  const count = Number(memberCount) || 0;
  if (count >= 25_000) return 40;
  if (count >= 5_000) return 20;
  if (count >= 1_000) return 10;
  return BREAKER_LIMIT;
}

export const validLimit = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= MIN_LIMIT && (value as number) <= MAX_LIMIT;

/** How many members may wait: what the limit can handle in `QUEUE_MINUTES` minutes. */
export const queueCap = (limit: number): number => limit * QUEUE_MINUTES;

export interface Job { who: string; roleId: string; at: number }
export interface Gate {
  /** The action may run now. */
  allowed: boolean;
  /** The line was full: the rules of the server are paused now (true once, on the action that stops them). */
  tripped: boolean;
  /** The member is waiting in line instead. */
  queued: boolean;
  /** The first member of a new wait, to tell the staff once. */
  startedQueue: boolean;
}
export interface BreakerOptions { limit?: number; windowMs?: number; pauseMs?: number; queueMinutes?: number; now?: () => number }

interface GuildState { times: number[]; pausedUntil: number; skipped: string[]; skippedCount: number; queue: Job[]; toldAt: number }

export function createBreaker({ limit = BREAKER_LIMIT, windowMs = BREAKER_WINDOW_MS, pauseMs = BREAKER_PAUSE_MS, queueMinutes = QUEUE_MINUTES, now = Date.now }: BreakerOptions = {}) {
  const guilds = new Map<string, GuildState>();
  const stateOf = (guildId: string): GuildState => {
    let state = guilds.get(guildId);
    if (!state) { state = { times: [], pausedUntil: 0, skipped: [], skippedCount: 0, queue: [], toldAt: -Infinity }; guilds.set(guildId, state); }
    return state;
  };
  const leftAlone = (state: GuildState, who: string | null): void => {
    if (who && state.skipped.length < SKIPPED_KEPT) state.skipped.push(who);
    state.skippedCount += 1;
  };
  const maxOf = (override: unknown): number => (validLimit(override) ? override : limit);

  return {
    /** Asks to run one action now. Over the limit, `who` waits in line (when there is room); a line that is full pauses the server. */
    allow(guildId: string, limitOverride?: unknown, who: string | null = null, roleId = ''): Gate {
      const time = now();
      const state = stateOf(guildId);
      const max = maxOf(limitOverride);
      if (state.pausedUntil > time) { leftAlone(state, who); return { allowed: false, tripped: false, queued: false, startedQueue: false }; }
      state.times = state.times.filter((at) => time - at < windowMs);
      // Somebody already waiting goes first: a new one does not jump the line, even when the minute has room.
      if (state.times.length < max && state.queue.length === 0) {
        state.times.push(time);
        return { allowed: true, tripped: false, queued: false, startedQueue: false };
      }
      if (who && state.queue.length < Math.floor(max * queueMinutes)) {
        const startedQueue = time - state.toldAt >= pauseMs;
        if (startedQueue) state.toldAt = time;
        state.queue.push({ who, roleId, at: time });
        return { allowed: false, tripped: false, queued: true, startedQueue };
      }
      // The line is full (or there is no member to keep): the rules of the server stop, and who was waiting is kept to be told.
      state.pausedUntil = time + pauseMs;
      state.times = [];
      state.skipped = [...state.queue.map((job) => job.who), ...(who ? [who] : [])].slice(0, SKIPPED_KEPT);
      state.skippedCount = state.queue.length + 1;
      state.queue = [];
      return { allowed: false, tripped: true, queued: false, startedQueue: false };
    },

    /** The next member of the line, when the limit has room for one (it counts as an action); otherwise how long to wait. A member who waited too long is left alone. */
    next(guildId: string, limitOverride?: unknown): { job: Job | null; waitMs: number } {
      const state = guilds.get(guildId);
      if (!state || state.queue.length === 0) return { job: null, waitMs: 0 };
      const time = now();
      const max = maxOf(limitOverride);
      state.times = state.times.filter((at) => time - at < windowMs);
      while (state.queue.length > 0 && time - state.queue[0].at > queueMinutes * 60_000) leftAlone(state, state.queue.shift()!.who);
      if (state.queue.length === 0) return { job: null, waitMs: 0 };
      if (state.times.length >= max) return { job: null, waitMs: Math.max(1, windowMs - (time - state.times[0])) };
      state.times.push(time);
      return { job: state.queue.shift()!, waitMs: 0 };
    },

    /** How many members wait in line in this server. */
    queued: (guildId: string): number => guilds.get(guildId)?.queue.length ?? 0,
    paused: (guildId: string): boolean => (guilds.get(guildId)?.pausedUntil ?? 0) > now(),
    /** How many members were left alone and have not been told about yet. */
    pendingSkipped: (guildId: string): number => guilds.get(guildId)?.skippedCount ?? 0,
    /** The members that were left alone (up to 50 ids, and how many in all); forgets them. */
    takeSkipped(guildId: string): { ids: string[]; count: number } {
      const state = guilds.get(guildId);
      if (!state) return { ids: [], count: 0 };
      const result = { ids: state.skipped, count: state.skippedCount };
      state.skipped = [];
      state.skippedCount = 0;
      return result;
    },
    clear: (): void => guilds.clear(),
  };
}
