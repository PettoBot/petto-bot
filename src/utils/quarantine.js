"use strict";
// i18n-ignore-file: internal protection (logs and the private `!perf` tool); nobody sees these words in a server.
// The quarantine: when one part of the bot keeps failing (an event listener, a background job, a call to an outside service) that part is put apart for a while so it cannot
// break the rest. A part is never "turned off for good": after a rest ONE trial run is let through (half open); if it works the part comes back, if it fails it rests again, twice as long.
//   - A part is quarantined when, in the last `windowMs`, it failed at least `minFailures` times AND at least `ratio` of its runs failed. A few errors from odd input do not count.
//   - The rest starts at `baseMs`, doubles with every failed trial and never passes `maxMs`.
//   - The essential work (commands, moderation, tickets, verification) is never quarantined: it is listed by the caller with `protect`, so a failing one keeps logging its error but keeps running.
// Plain functions and no Discord, so it is checked on its own (scripts/check-quarantine.js). `utils/eventQuarantine.js` is the one the bot uses.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_MS = exports.BASE_MS = exports.FAIL_RATIO = exports.MIN_FAILURES = exports.WINDOW_MS = void 0;
exports.createQuarantine = createQuarantine;
exports.WINDOW_MS = 60_000;
exports.MIN_FAILURES = 8;
exports.FAIL_RATIO = 0.5;
exports.BASE_MS = 60_000;
exports.MAX_MS = 15 * 60_000;
const KEPT = 200; // the runs remembered for each part (the window never needs more)
const describe = (error) => String(error?.message ?? error ?? '').slice(0, 200);
function createQuarantine({ windowMs = exports.WINDOW_MS, minFailures = exports.MIN_FAILURES, ratio = exports.FAIL_RATIO, baseMs = exports.BASE_MS, maxMs = exports.MAX_MS, now = Date.now, onChange = () => { } } = {}) {
    const parts = new Map();
    const protectedKeys = new Set();
    const protectedTest = [];
    const partOf = (key) => {
        let part = parts.get(key);
        if (!part) {
            part = { runs: [], restUntil: 0, restMs: baseMs, trial: false, times: 0, lastError: '', state: 'open' };
            parts.set(key, part);
        }
        return part;
    };
    const isProtected = (key) => protectedKeys.has(key) || protectedTest.some((test) => test(key));
    const emit = (change) => { try {
        onChange(change);
    }
    catch { /* an alert is best effort */ } };
    return {
        /** Parts that are never put apart: exact keys, or a function that says it. */
        protect(what) { if (typeof what === 'function')
            protectedTest.push(what);
        else
            protectedKeys.add(what); },
        /** True while the part rests: the caller must not run it. After the rest it answers false ONCE (the trial run), then true again until that run says how it went. */
        blocked(key) {
            const part = parts.get(key);
            if (!part || part.state === 'open')
                return false;
            const time = now();
            if (part.state === 'resting') {
                if (time < part.restUntil)
                    return true;
                part.state = 'trial';
                part.trial = true;
                return false; // the trial run
            }
            // A trial is already out. If it never reported (it hung), a new one is let through after another rest, so a part is never stuck.
            if (part.trial) {
                part.trial = false;
                part.restUntil = time + part.restMs;
                return true;
            }
            if (time < part.restUntil)
                return true;
            part.trial = true;
            return false;
        },
        /** The run worked. A trial that works brings the part back. */
        succeed(key) {
            const part = partOf(key);
            const time = now();
            part.runs.push({ at: time, ok: true });
            if (part.runs.length > KEPT)
                part.runs.shift();
            if (part.state !== 'open') {
                part.state = 'open';
                part.trial = false;
                part.restMs = baseMs;
                part.runs = [];
                emit({ key, state: 'back', failures: 0, restMs: 0, error: part.lastError });
            }
        },
        /** The run failed. Returns true when this failure put the part in quarantine (or sent it back to rest). */
        fail(key, error) {
            const part = partOf(key);
            const time = now();
            part.lastError = describe(error);
            part.runs.push({ at: time, ok: false });
            if (part.runs.length > KEPT)
                part.runs.shift();
            if (isProtected(key))
                return false;
            if (part.state !== 'open') {
                // The trial failed: rest again, twice as long.
                part.restMs = Math.min(maxMs, part.restMs * 2);
                part.state = 'resting';
                part.trial = false;
                part.restUntil = time + part.restMs;
                part.times += 1;
                emit({ key, state: 'resting', failures: part.runs.filter((run) => !run.ok).length, restMs: part.restMs, error: part.lastError });
                return true;
            }
            part.runs = part.runs.filter((run) => time - run.at < windowMs);
            const failures = part.runs.filter((run) => !run.ok).length;
            if (failures >= minFailures && failures / part.runs.length >= ratio) {
                part.state = 'resting';
                part.trial = false;
                part.restUntil = time + part.restMs;
                part.times += 1;
                emit({ key, state: 'resting', failures, restMs: part.restMs, error: part.lastError });
                return true;
            }
            return false;
        },
        /** Brings a part back by hand (the team's tool). */
        release(key) {
            const part = parts.get(key);
            if (!part || part.state === 'open')
                return false;
            part.state = 'open';
            part.trial = false;
            part.restMs = baseMs;
            part.runs = [];
            emit({ key, state: 'back', failures: 0, restMs: 0, error: part.lastError });
            return true;
        },
        /** Every part that is resting or was ever put apart, for `!perf` and the checks. */
        status() {
            const time = now();
            return [...parts.entries()].filter(([, part]) => part.state !== 'open' || part.times > 0).map(([key, part]) => ({
                key, state: part.state, failures: part.runs.filter((run) => !run.ok && time - run.at < windowMs).length, runs: part.runs.length,
                restUntil: part.restUntil, restMs: part.restMs, times: part.times, lastError: part.lastError,
            }));
        },
        reset() { parts.clear(); },
    };
}
