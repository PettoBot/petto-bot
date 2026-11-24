// i18n-ignore-file: internal protection (logs only).
// The fallback for the calls to an outside service (Discord, OpenAI, Polar, any HTTP): a rate limit (429) is waited for ONCE (what the service asks, never more than `maxWaitMs`) and tried again;
// anything else that fails, or a wait that is too long, gives the fallback instead of an error, so the part of the bot that asked keeps working with less. A call that keeps failing is put apart
// by the quarantine (utils/quarantine.ts): while it rests the task is not even tried and the fallback answers at once.
// Plain functions, checked on their own (scripts/check-quarantine.js).
import type { Quarantine } from './quarantine';

export const MAX_WAIT_MS = 5_000;
const DEFAULT_WAIT_MS = 1_000;

/** True for a rate limit: HTTP 429, a Discord rate limit error, or the words of the services that do not send the number. */
export function isRateLimited(error: unknown): boolean {
  const e = error as { status?: unknown; httpStatus?: unknown; statusCode?: unknown; code?: unknown; name?: unknown; message?: unknown } | null;
  if (!e) return false;
  if ([e.status, e.httpStatus, e.statusCode, e.code].some((value) => Number(value) === 429)) return true;
  return /rate.?limit|too many requests/i.test(`${String(e.name ?? '')} ${String(e.message ?? '')}`);
}

/** How long the service asks to wait, in milliseconds: `retry-after` (seconds, in the headers), `retryAfter` (discord.js, ms) or `timeToReset`; a default when it says nothing. */
export function retryAfterMs(error: unknown): number {
  const e = error as { retryAfter?: unknown; timeToReset?: unknown; headers?: { get?: (name: string) => string | null } | Record<string, unknown>; response?: { headers?: { get?: (name: string) => string | null } } } | null;
  const header = (e?.headers as { get?: (name: string) => string | null } | undefined)?.get?.('retry-after') ?? e?.response?.headers?.get?.('retry-after') ?? (e?.headers as Record<string, unknown> | undefined)?.['retry-after'];
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000);
  const ms = Number(e?.retryAfter ?? e?.timeToReset);
  if (Number.isFinite(ms) && ms > 0) return Math.round(ms);
  return DEFAULT_WAIT_MS;
}

export interface FallbackOptions<T> {
  /** What answers when the task cannot be done (a rate limit that is too long, a failure, or the part is in quarantine). Without it the error is thrown. */
  fallback?: (error: unknown) => T | Promise<T>;
  /** Name of the part for the quarantine (`call:openai`): its failures and successes are counted and, while it rests, only the fallback runs. */
  key?: string;
  quarantine?: Quarantine;
  retries?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (waitMs: number, error: unknown) => void;
}

/** Runs `task`. A rate limit waits and tries again (up to `retries`, default 1); a failure counts for the quarantine and gives the fallback. */
export async function withFallback<T>(task: () => Promise<T>, { fallback, key, quarantine, retries = 1, maxWaitMs = MAX_WAIT_MS, sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)), onRetry }: FallbackOptions<T> = {}): Promise<T> {
  const giveUp = async (error: unknown): Promise<T> => {
    if (fallback) return fallback(error);
    throw error;
  };
  if (key && quarantine?.blocked(key)) return giveUp(new Error(`${key} is resting (quarantine)`));
  let attempt = 0;
  for (;;) {
    try {
      const value = await task();
      if (key) quarantine?.succeed(key);
      return value;
    } catch (error) {
      if (isRateLimited(error) && attempt < retries) {
        const wait = retryAfterMs(error);
        if (wait <= maxWaitMs) {
          attempt += 1;
          onRetry?.(wait, error);
          await sleep(wait);
          continue;
        }
      }
      // A rate limit is the service asking for calm, not a broken part: it does not count as a failure of the part.
      if (key && !isRateLimited(error)) quarantine?.fail(key, error);
      return giveUp(error);
    }
  }
}
