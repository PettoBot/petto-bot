"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_WAIT_MS = void 0;
exports.isRateLimited = isRateLimited;
exports.retryAfterMs = retryAfterMs;
exports.withFallback = withFallback;
exports.MAX_WAIT_MS = 5_000;
const DEFAULT_WAIT_MS = 1_000;
/** True for a rate limit: HTTP 429, a Discord rate limit error, or the words of the services that do not send the number. */
function isRateLimited(error) {
    const e = error;
    if (!e)
        return false;
    if ([e.status, e.httpStatus, e.statusCode, e.code].some((value) => Number(value) === 429))
        return true;
    return /rate.?limit|too many requests/i.test(`${String(e.name ?? '')} ${String(e.message ?? '')}`);
}
/** How long the service asks to wait, in milliseconds: `retry-after` (seconds, in the headers), `retryAfter` (discord.js, ms) or `timeToReset`; a default when it says nothing. */
function retryAfterMs(error) {
    const e = error;
    const header = e?.headers?.get?.('retry-after') ?? e?.response?.headers?.get?.('retry-after') ?? e?.headers?.['retry-after'];
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0)
        return Math.round(seconds * 1000);
    const ms = Number(e?.retryAfter ?? e?.timeToReset);
    if (Number.isFinite(ms) && ms > 0)
        return Math.round(ms);
    return DEFAULT_WAIT_MS;
}
/** Runs `task`. A rate limit waits and tries again (up to `retries`, default 1); a failure counts for the quarantine and gives the fallback. */
async function withFallback(task, { fallback, key, quarantine, retries = 1, maxWaitMs = exports.MAX_WAIT_MS, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), onRetry } = {}) {
    const giveUp = async (error) => {
        if (fallback)
            return fallback(error);
        throw error;
    };
    if (key && quarantine?.blocked(key))
        return giveUp(new Error(`${key} is resting (quarantine)`));
    let attempt = 0;
    for (;;) {
        try {
            const value = await task();
            if (key)
                quarantine?.succeed(key);
            return value;
        }
        catch (error) {
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
            if (key && !isRateLimited(error))
                quarantine?.fail(key, error);
            return giveUp(error);
        }
    }
}
