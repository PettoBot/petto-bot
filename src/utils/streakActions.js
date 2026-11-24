"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.freezesFor = void 0;
exports.board = board;
exports.planFreezesOf = planFreezesOf;
exports.inGuild = inGuild;
exports.summary = summary;
exports.mine = mine;
// i18n-ignore-file: the answers are codes and numbers; the website and the command write the words.
// The streaks of a person: in one server, or in every server where they have been active. Each server decides what an active day is; the plan gives the freezes.
// Written in TypeScript: `npm run build:ts` compiles it over utils/streakActions.js.
const streaks = require('./streaks');
const db = require('../db/streaks');
const plansDb = require('../db/userPlans');
const plans = require('./userPlans');
async function freezesOf(userId) {
    const row = await plansDb.getPlan(userId).catch(() => null);
    const tier = row && row.active ? row.plan : 'free';
    return plans.PLAN_PERKS[tier]?.streakFreezes ?? 0;
}
/** The freezes of a plan (a person's own) and the ones the server gives to everyone together. */
const freezesFor = (planFreezes, guildFreezes) => planFreezes + guildFreezes;
exports.freezesFor = freezesFor;
async function oneGuild(guildId, userId, planFreezes, now) {
    const config = await db.getConfig(guildId);
    if (!config.enabled)
        return { guildId, enabled: false };
    const rules = { minMessages: config.minMessages, minVoiceMinutes: config.minVoiceMinutes, mode: config.mode, counting: config.countingSince ? config.counting : null };
    const days = streaks.activeDays(await db.daysOf(guildId, userId, config.resetAt), rules);
    const freezes = (0, exports.freezesFor)(planFreezes, config.guildFreezes);
    // The grace period: for some minutes after midnight (Colombia time) the day that just ended is still the one that counts, so a streak is not lost the moment the day changes.
    return { guildId, enabled: true, ...streaks.compute(days, streaks.dayOf(streaks.graceNow(now, config.graceMinutes)), freezes), freezes, rules, graceMinutes: config.graceMinutes };
}
const BOARD_PLACES = 25;
const boardCache = new Map();
/** The best streaks of a server: the 25 members with the longest current streak (kind `current`) or the longest ever (kind `longest`). The plans of the members count, so it is the same number they see. */
async function board(guildId, kind, now = new Date()) {
    const key = `${guildId}:${kind}`;
    const hit = boardCache.get(key);
    if (hit && now.getTime() - hit.at < 60_000)
        return { ok: true, entries: hit.value };
    const config = await db.getConfig(guildId);
    if (!config.enabled)
        return { ok: true, entries: [] };
    const ids = await db.busiestMembers(guildId, config.resetAt);
    const [days, plans] = await Promise.all([db.daysOfMany(guildId, ids, config.resetAt), db.plansOf(ids)]);
    const rules = { minMessages: config.minMessages, minVoiceMinutes: config.minVoiceMinutes, mode: config.mode };
    const today = streaks.dayOf(streaks.graceNow(now, config.graceMinutes));
    const all = ids.map((userId) => {
        const planFreezes = planFreezesOf(plans.get(userId));
        const result = streaks.compute(streaks.activeDays(days.get(userId) ?? [], rules), today, (0, exports.freezesFor)(planFreezes, config.guildFreezes));
        return { userId, current: result.current, best: result.best };
    }).filter((entry) => (kind === 'current' ? entry.current : entry.best) > 0);
    all.sort((a, b) => (kind === 'current' ? b.current - a.current || b.best - a.best : b.best - a.best || b.current - a.current));
    const value = all.slice(0, BOARD_PLACES);
    if (boardCache.size > 200)
        boardCache.clear();
    boardCache.set(key, { at: now.getTime(), value });
    return { ok: true, entries: value };
}
/** The freezes a plan gives (0 for no plan). */
function planFreezesOf(plan) {
    return plan ? plans.PLAN_PERKS[plan]?.streakFreezes ?? 0 : 0;
}
/** The streak of a person in one server. */
async function inGuild(userId, guildId, now = new Date()) {
    return oneGuild(guildId, userId, await freezesOf(userId), now);
}
/** The summary of a person: what they did in every server, and their streaks. */
async function summary(userId, now = new Date()) {
    const [totals, streak] = await Promise.all([db.totalsOf(userId), mine(userId, now)]);
    return { ...streak, totals };
}
/** The streaks of a person in the servers where they have been active, with the best of all. */
async function mine(userId, now = new Date()) {
    const freezes = await freezesOf(userId);
    const ids = await db.guildsOf(userId);
    const list = (await Promise.all(ids.map((id) => oneGuild(id, userId, freezes, now)))).filter((entry) => entry.enabled);
    const on = list;
    return { ok: true, freezes, servers: on, bestEver: on.reduce((best, entry) => Math.max(best, entry.best), 0), longestNow: on.reduce((best, entry) => Math.max(best, entry.current), 0) };
}
