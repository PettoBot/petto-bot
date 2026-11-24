// i18n-ignore-file: the answers are codes and numbers; the website and the command write the words.
// The streaks of a person: in one server, or in every server where they have been active. Each server decides what an active day is; the plan gives the freezes.
// Written in TypeScript: `npm run build:ts` compiles it over utils/streakActions.js.
const streaks = require('./streaks') as typeof import('./streaks');
const db = require('../db/streaks') as typeof import('../db/streaks');
const plansDb = require('../db/userPlans') as typeof import('../db/userPlans');
const plans = require('./userPlans') as typeof import('./userPlans');

async function freezesOf(userId: string): Promise<number> {
  const row = await plansDb.getPlan(userId).catch(() => null);
  const tier = row && row.active ? row.plan : 'free';
  return plans.PLAN_PERKS[tier as keyof typeof plans.PLAN_PERKS]?.streakFreezes ?? 0;
}

/** The freezes of a plan (a person's own) and the ones the server gives to everyone together. */
export const freezesFor = (planFreezes: number, guildFreezes: number): number => planFreezes + guildFreezes;

async function oneGuild(guildId: string, userId: string, planFreezes: number, now: Date) {
  const config = await db.getConfig(guildId);
  if (!config.enabled) return { guildId, enabled: false as const };
  const rules = { minMessages: config.minMessages, minVoiceMinutes: config.minVoiceMinutes, mode: config.mode };
  const days = streaks.activeDays(await db.daysOf(guildId, userId, config.resetAt), rules);
  const freezes = freezesFor(planFreezes, config.guildFreezes);
  return { guildId, enabled: true as const, ...streaks.compute(days, streaks.dayOf(now), freezes), freezes, rules };
}

const BOARD_PLACES = 25;
const boardCache = new Map<string, { at: number; value: { userId: string; current: number; best: number }[] }>();

/** The best streaks of a server: the 25 members with the longest current streak (kind `current`) or the longest ever (kind `longest`). The plans of the members count, so it is the same number they see. */
export async function board(guildId: string, kind: 'current' | 'longest', now: Date = new Date()) {
  const key = `${guildId}:${kind}`;
  const hit = boardCache.get(key);
  if (hit && now.getTime() - hit.at < 60_000) return { ok: true as const, entries: hit.value };
  const config = await db.getConfig(guildId);
  if (!config.enabled) return { ok: true as const, entries: [] };
  const ids = await db.busiestMembers(guildId, config.resetAt);
  const [days, plans] = await Promise.all([db.daysOfMany(guildId, ids, config.resetAt), db.plansOf(ids)]);
  const rules = { minMessages: config.minMessages, minVoiceMinutes: config.minVoiceMinutes, mode: config.mode };
  const today = streaks.dayOf(now);
  const all = ids.map((userId) => {
    const planFreezes = planFreezesOf(plans.get(userId));
    const result = streaks.compute(streaks.activeDays(days.get(userId) ?? [], rules), today, freezesFor(planFreezes, config.guildFreezes));
    return { userId, current: result.current, best: result.best };
  }).filter((entry) => (kind === 'current' ? entry.current : entry.best) > 0);
  all.sort((a, b) => (kind === 'current' ? b.current - a.current || b.best - a.best : b.best - a.best || b.current - a.current));
  const value = all.slice(0, BOARD_PLACES);
  if (boardCache.size > 200) boardCache.clear();
  boardCache.set(key, { at: now.getTime(), value });
  return { ok: true as const, entries: value };
}

/** The freezes a plan gives (0 for no plan). */
export function planFreezesOf(plan: string | undefined): number {
  return plan ? plans.PLAN_PERKS[plan as keyof typeof plans.PLAN_PERKS]?.streakFreezes ?? 0 : 0;
}

/** The streak of a person in one server. */
export async function inGuild(userId: string, guildId: string, now: Date = new Date()) {
  return oneGuild(guildId, userId, await freezesOf(userId), now);
}

/** The summary of a person: what they did in every server, and their streaks. */
export async function summary(userId: string, now: Date = new Date()) {
  const [totals, streak] = await Promise.all([db.totalsOf(userId), mine(userId, now)]);
  return { ...streak, totals };
}

/** The streaks of a person in the servers where they have been active, with the best of all. */
export async function mine(userId: string, now: Date = new Date()) {
  const freezes = await freezesOf(userId);
  const ids = await db.guildsOf(userId);
  const list = (await Promise.all(ids.map((id) => oneGuild(id, userId, freezes, now)))).filter((entry) => entry.enabled);
  const on = list as Extract<(typeof list)[number], { enabled: true }>[];
  return { ok: true as const, freezes, servers: on, bestEver: on.reduce((best, entry) => Math.max(best, entry.best), 0), longestNow: on.reduce((best, entry) => Math.max(best, entry.current), 0) };
}
