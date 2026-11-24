"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
async function oneGuild(guildId, userId, freezes, now) {
    const config = await db.getConfig(guildId);
    if (!config.enabled)
        return { guildId, enabled: false };
    const rules = { minMessages: config.minMessages, minVoiceMinutes: config.minVoiceMinutes };
    const days = streaks.activeDays(await db.daysOf(guildId, userId), rules);
    return { guildId, enabled: true, ...streaks.compute(days, streaks.dayOf(now), freezes), freezes, rules };
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
