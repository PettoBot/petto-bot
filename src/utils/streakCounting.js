"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.channelPasses = channelPasses;
exports.rolesPass = rolesPass;
exports.consider = consider;
exports.rulesOf = rulesOf;
exports.setForTests = setForTests;
const countsDb = require('../db/streakCounts');
const { botDay } = require('./botTime');
/** Whether the channel (or the thread, channel or category it is in) passes the rule. */
function channelPasses(filters, channelIds) {
    if (filters.channelMode === 'all')
        return true;
    const hit = channelIds.some((id) => filters.channelIds.includes(id));
    return filters.channelMode === 'only' ? hit : !hit;
}
/** Whether the roles of the person pass the rule. */
function rolesPass(filters, roleIds) {
    if (filters.roleMode === 'all')
        return true;
    const hit = roleIds.some((id) => filters.roleIds.includes(id));
    return filters.roleMode === 'only' ? hit : !hit;
}
// The last counted moment of each person in each server (for the cooldown). Forgotten when it is old, so it does not grow for ever.
const lastCounted = new Map();
const FORGET_AFTER_MS = 3_600_000;
function forgetOld(now) {
    if (lastCounted.size < 20_000)
        return;
    for (const [key, at] of lastCounted)
        if (now - at > FORGET_AFTER_MS)
            lastCounted.delete(key);
}
/** Whether this message or reaction counts, and if it does, remembers the moment (for the cooldown) and queues the day. Returns whether it counted. */
function consider(filters, candidate, queue = countsDb.queueDay) {
    const now = candidate.at ?? Date.now();
    if (candidate.length !== null && candidate.length < filters.minLength)
        return false;
    if (!channelPasses(filters, candidate.channelIds) || !rolesPass(filters, candidate.roleIds))
        return false;
    const key = `${candidate.guildId}:${candidate.userId}`;
    if (filters.cooldownSeconds > 0) {
        const last = lastCounted.get(key);
        if (last !== undefined && now - last < filters.cooldownSeconds * 1000)
            return false;
    }
    lastCounted.set(key, now);
    forgetOld(now);
    queue(candidate.guildId, candidate.userId, botDay(new Date(now)));
    return true;
}
// The rules of the servers that filter, kept a minute.
let filters = new Map();
let loadedAt = 0;
let loading = null;
const FRESH_MS = 60_000;
/** The rules of a server, or undefined when it does not filter. Reads again when they are older than a minute (without making the message wait). */
function rulesOf(guildId) {
    if (Date.now() - loadedAt > FRESH_MS && !loading) {
        loading = countsDb.loadFilters().then((next) => { filters = next; loadedAt = Date.now(); }).catch(() => { loadedAt = Date.now() - FRESH_MS + 10_000; }).finally(() => { loading = null; });
    }
    return filters.get(guildId);
}
/** Only for the checks. */
function setForTests(next) { filters = next; loadedAt = Date.now() + 365 * 86_400_000; lastCounted.clear(); }
