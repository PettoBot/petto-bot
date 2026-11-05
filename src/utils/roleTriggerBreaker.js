"use strict";
// The safety stop of the role triggers, typed: how many actions a minute a server may have, and the line of members who wait when it is passed.
// Plain functions and no Discord, so they are checked on their own (scripts/check-role-triggers.js). `roleTriggers.js` runs the actions.
//
// More than `limit` actions in `windowMs` in one server do not drop the rest: the members who are over the limit wait in a line (first in, first out) and
// `next` hands them out at the pace of the limit. The line holds what the limit can handle in `QUEUE_MINUTES` minutes; a member waits at most that long.
// Only when the line is full the rules of the server pause for `pauseMs`, and the members who were left alone are kept, so the staff can be told.
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueCap = exports.validLimit = exports.MAX_LIMIT = exports.MIN_LIMIT = exports.QUEUE_MINUTES = exports.BREAKER_PAUSE_MS = exports.BREAKER_WINDOW_MS = exports.BREAKER_LIMIT = void 0;
exports.defaultLimit = defaultLimit;
exports.createBreaker = createBreaker;
exports.BREAKER_LIMIT = 5; // the default of a small server (see `defaultLimit`)
exports.BREAKER_WINDOW_MS = 60_000;
exports.BREAKER_PAUSE_MS = 10 * 60_000;
exports.QUEUE_MINUTES = 10;
exports.MIN_LIMIT = 1;
exports.MAX_LIMIT = 500;
const SKIPPED_KEPT = 50; // ids kept of the members who were not looked at (the count is always complete)
/** The default of how many actions a minute a server may have before its rules wait: a bigger server has more going on, and a raid is when the rules are needed. */
function defaultLimit(memberCount) {
    const count = Number(memberCount) || 0;
    if (count >= 25_000)
        return 40;
    if (count >= 5_000)
        return 20;
    if (count >= 1_000)
        return 10;
    return exports.BREAKER_LIMIT;
}
const validLimit = (value) => Number.isInteger(value) && value >= exports.MIN_LIMIT && value <= exports.MAX_LIMIT;
exports.validLimit = validLimit;
/** How many members may wait: what the limit can handle in `QUEUE_MINUTES` minutes. */
const queueCap = (limit) => limit * exports.QUEUE_MINUTES;
exports.queueCap = queueCap;
function createBreaker({ limit = exports.BREAKER_LIMIT, windowMs = exports.BREAKER_WINDOW_MS, pauseMs = exports.BREAKER_PAUSE_MS, queueMinutes = exports.QUEUE_MINUTES, now = Date.now } = {}) {
    const guilds = new Map();
    const stateOf = (guildId) => {
        let state = guilds.get(guildId);
        if (!state) {
            state = { times: [], pausedUntil: 0, skipped: [], skippedCount: 0, queue: [], toldAt: -Infinity };
            guilds.set(guildId, state);
        }
        return state;
    };
    const leftAlone = (state, who) => {
        if (who && state.skipped.length < SKIPPED_KEPT)
            state.skipped.push(who);
        state.skippedCount += 1;
    };
    const maxOf = (override) => ((0, exports.validLimit)(override) ? override : limit);
    return {
        /** Asks to run one action now. Over the limit, `who` waits in line (when there is room); a line that is full pauses the server. */
        allow(guildId, limitOverride, who = null, roleId = '') {
            const time = now();
            const state = stateOf(guildId);
            const max = maxOf(limitOverride);
            if (state.pausedUntil > time) {
                leftAlone(state, who);
                return { allowed: false, tripped: false, queued: false, startedQueue: false };
            }
            state.times = state.times.filter((at) => time - at < windowMs);
            // Somebody already waiting goes first: a new one does not jump the line, even when the minute has room.
            if (state.times.length < max && state.queue.length === 0) {
                state.times.push(time);
                return { allowed: true, tripped: false, queued: false, startedQueue: false };
            }
            if (who && state.queue.length < Math.floor(max * queueMinutes)) {
                const startedQueue = time - state.toldAt >= pauseMs;
                if (startedQueue)
                    state.toldAt = time;
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
        next(guildId, limitOverride) {
            const state = guilds.get(guildId);
            if (!state || state.queue.length === 0)
                return { job: null, waitMs: 0 };
            const time = now();
            const max = maxOf(limitOverride);
            state.times = state.times.filter((at) => time - at < windowMs);
            while (state.queue.length > 0 && time - state.queue[0].at > queueMinutes * 60_000)
                leftAlone(state, state.queue.shift().who);
            if (state.queue.length === 0)
                return { job: null, waitMs: 0 };
            if (state.times.length >= max)
                return { job: null, waitMs: Math.max(1, windowMs - (time - state.times[0])) };
            state.times.push(time);
            return { job: state.queue.shift(), waitMs: 0 };
        },
        /** How many members wait in line in this server. */
        queued: (guildId) => guilds.get(guildId)?.queue.length ?? 0,
        paused: (guildId) => (guilds.get(guildId)?.pausedUntil ?? 0) > now(),
        /** How many members were left alone and have not been told about yet. */
        pendingSkipped: (guildId) => guilds.get(guildId)?.skippedCount ?? 0,
        /** The members that were left alone (up to 50 ids, and how many in all); forgets them. */
        takeSkipped(guildId) {
            const state = guilds.get(guildId);
            if (!state)
                return { ids: [], count: 0 };
            const result = { ids: state.skipped, count: state.skippedCount };
            state.skipped = [];
            state.skippedCount = 0;
            return result;
        },
        clear: () => guilds.clear(),
    };
}
