"use strict";
// The vote boost: a person who voted for the bot (top.gg or omniplex.gg) earns +10% XP for 12 hours in every server that
// has the boost on. Both lists share one expiry for each person: the latest one, never the sum of the votes.
//
// This file is pure apart from the lazy database read in `getVoteBoost`: the cache is a plain object built with
// `createVoteBoostCache` (so it can be checked with a fake loader and a fake clock) and the module keeps one of them.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ENTRIES = exports.ERROR_TTL_MS = exports.NEGATIVE_TTL_MS = exports.VOTE_BOOST_MS = exports.VOTE_BOOST_HOURS = exports.VOTE_BOOST_PERCENT = void 0;
exports.voteExpiry = voteExpiry;
exports.latestExpiry = latestExpiry;
exports.boostFactor = boostFactor;
exports.timeLeft = timeLeft;
exports.formatTimeLeft = formatTimeLeft;
exports.createVoteBoostCache = createVoteBoostCache;
exports.getVoteBoost = getVoteBoost;
exports.noteVote = noteVote;
exports.boostFor = boostFor;
exports.expiryOfVote = expiryOfVote;
exports.resetVoteBoostCache = resetVoteBoostCache;
exports.VOTE_BOOST_PERCENT = 10;
exports.VOTE_BOOST_HOURS = 12;
exports.VOTE_BOOST_MS = exports.VOTE_BOOST_HOURS * 60 * 60 * 1000;
/** How long "no boost" is remembered for a person, so a member who never voted costs no query per message. */
exports.NEGATIVE_TTL_MS = 10 * 60 * 1000;
/** How long a failed read is remembered, so a database that is down is not asked again for every message. */
exports.ERROR_TTL_MS = 30 * 1000;
/** The most people the cache holds; the oldest entries leave first. */
exports.MAX_ENTRIES = 50_000;
function toMs(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
}
/** When one vote stops giving the boost: its own `expires_at` when it has one, else 12 hours after it was cast. Null for a row with neither. */
function voteExpiry(row) {
    if (!row)
        return null;
    const expires = toMs(row.expires_at);
    if (expires !== null)
        return expires;
    const votedAt = toMs(row.voted_at);
    return votedAt === null ? null : votedAt + exports.VOTE_BOOST_MS;
}
/** The latest expiry over many votes (the weight of a vote and the day of the week do not matter), or null when none has a date. */
function latestExpiry(rows) {
    let latest = null;
    for (const row of rows ?? []) {
        const expiry = voteExpiry(row);
        if (expiry !== null && (latest === null || expiry > latest))
            latest = expiry;
    }
    return latest;
}
/** The multiplier of a boost: 1.1 for the 10% boost, 1 for no boost. */
function boostFactor(boost) {
    return boost ? 1 + boost.percent / 100 : 1;
}
/** The time left of a boost split in whole hours and minutes (a started minute counts), never negative. */
function timeLeft(boost, now = Date.now()) {
    const minutes = Math.max(0, Math.ceil((boost.endsAt - now) / 60_000));
    return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
/** `3h 20m`, `45m` or `2h`: the time left of a boost as short text (the same letters in every language). */
function formatTimeLeft(boost, now = Date.now()) {
    const { hours, minutes } = timeLeft(boost, now);
    if (!hours)
        return `${minutes}m`;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}
const SNOWFLAKE = /^\d{15,25}$/;
function createVoteBoostCache(options) {
    const now = options.now ?? Date.now;
    const maxEntries = options.maxEntries ?? exports.MAX_ENTRIES;
    const negativeTtl = options.negativeTtlMs ?? exports.NEGATIVE_TTL_MS;
    const errorTtl = options.errorTtlMs ?? exports.ERROR_TTL_MS;
    const percent = options.percent ?? exports.VOTE_BOOST_PERCENT;
    // A Map keeps insertion order, so the first key is the oldest entry; a write deletes the key first to make it the newest.
    const entries = new Map();
    const pending = new Map();
    function store(userId, entry) {
        entries.delete(userId);
        entries.set(userId, entry);
        while (entries.size > maxEntries) {
            const oldest = entries.keys().next();
            if (oldest.done)
                break;
            entries.delete(oldest.value);
        }
    }
    function answer(entry) {
        return entry.endsAt === null ? null : { percent, endsAt: entry.endsAt };
    }
    async function get(userId) {
        if (!SNOWFLAKE.test(String(userId)))
            return null;
        const at = now();
        const cached = entries.get(userId);
        if (cached && cached.until > at)
            return answer(cached);
        const running = pending.get(userId);
        if (running)
            return running;
        const request = (async () => {
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
                if (current?.endsAt && current.until > readAt)
                    return answer(current);
                store(userId, { endsAt: null, until: readAt + negativeTtl });
                return null;
            }
            catch {
                // The database could not say: no boost for now, and no new query for a short while. Nothing else is touched.
                store(userId, { endsAt: null, until: now() + errorTtl });
                return null;
            }
            finally {
                pending.delete(userId);
            }
        })();
        pending.set(userId, request);
        return request;
    }
    function note(userId, endsAt) {
        if (!SNOWFLAKE.test(String(userId)) || !Number.isFinite(endsAt))
            return;
        const at = now();
        if (endsAt <= at)
            return;
        const current = entries.get(userId);
        const best = current?.endsAt && current.until > at ? Math.max(current.endsAt, endsAt) : endsAt;
        store(userId, { endsAt: best, until: best });
    }
    return { get, note, size: () => entries.size, clear: () => { entries.clear(); pending.clear(); } };
}
// The cache the bot uses. The database is read the first time it is needed, so loading this file costs nothing.
const shared = createVoteBoostCache({
    load: async (userId) => {
        const { recentVotes } = require('../db/votes');
        return latestExpiry(await recentVotes(userId));
    },
});
/** The active boost of a person, or null. Answered from memory except once in a while for a person who voted or asked. */
function getVoteBoost(userId) {
    return shared.get(userId);
}
/** Tells the cache about a vote that was just stored (from a webhook), so the voter has the boost at once. */
function noteVote(userId, endsAt) {
    shared.note(userId, endsAt);
}
/**
 * The boost a member has in a server: null when the server turned the boost off (`level_config.vote_boost_enabled`, on unless it is
 * exactly false) or the person has none. One answer from memory, not one query per call.
 */
async function boostFor(config, userId) {
    if (config?.vote_boost_enabled === false)
        return null;
    return shared.get(userId);
}
/** The expiry of a stored vote in the shape `noteVote` takes. */
function expiryOfVote(vote) {
    return voteExpiry({ voted_at: vote.votedAt, expires_at: vote.expiresAt });
}
/** Drops everything remembered (used by the checks). */
function resetVoteBoostCache() {
    shared.clear();
}
