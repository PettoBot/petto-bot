// i18n-ignore-file: the announcement is written with the catalog (streaks.milestone); the rest only logs for the team.
// What a streak earns on its own, looked at every few minutes by jobs/streakJob.ts: the members who reached a milestone are announced in the channel the server chose, and the members who
// reached the days of a reward role get it. Only the members who did something today or yesterday are looked at (nobody else's streak can have moved), and nothing is given or said twice
// (streak_awards). A streak that was already long when the server turned this on is not announced (only given the roles it has earned). Written in TypeScript: compiled over streakRewards.js.
import type { Client, Guild } from 'discord.js';
const db = require('../db/streaks') as typeof import('../db/streaks');
const streaks = require('./streaks') as typeof import('./streaks');
const actions = require('./streakActions') as typeof import('./streakActions');
const { t, guildLanguage } = require('../i18n') as { t: (lang: string, key: string, vars?: Record<string, unknown>) => string; guildLanguage: (guildId: string) => Promise<string> };
const logger = require('./logger') as { warn: (m: string) => void; error: (m: string, e?: unknown) => void };

const PER_GUILD_PER_RUN = 60;
const GAP_MS = Number(process.env.PETTO_STREAK_GAP_MS ?? 400);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface Due { announce: number | null; roles: { days: number; roleId: string }[]; record: number[] }

/** What a member earns now (pure): the days to record, the reward roles to give, and the milestone to announce (only the highest one, and only while it is fresh: at most a day over). */
export function dueFor(current: number, milestones: readonly number[], roles: readonly { days: number; roleId: string }[], done: ReadonlySet<number>): Due {
  const reachedMilestones = milestones.filter((days) => days <= current && !done.has(days));
  const reachedRoles = roles.filter((role) => role.days <= current && !done.has(role.days));
  const record = [...new Set([...reachedMilestones, ...reachedRoles.map((role) => role.days)])].sort((a, b) => a - b);
  const top = reachedMilestones.length ? Math.max(...reachedMilestones) : null;
  return { announce: top !== null && current - top <= 1 ? top : null, roles: [...reachedRoles], record };
}

/** One server: looks at who did something today or yesterday and gives what their streak earned. Returns how many actions it did. */
export async function runGuild(guild: Guild, now: Date = new Date()): Promise<number> {
  const config = await db.getConfig(guild.id);
  if (!config.enabled) return 0;
  const roles = await db.rolesOf(guild.id);
  const channel = config.announceChannelId ? guild.channels.cache.get(config.announceChannelId) : null;
  const canSay = Boolean(channel && channel.isTextBased() && 'send' in channel);
  if (!canSay && !roles.length) return 0;
  const ids = await db.recentMembers(guild.id);
  if (!ids.length) return 0;
  const [days, plans, awards] = await Promise.all([db.daysOfMany(guild.id, ids, config.resetAt), db.plansOf(ids), db.awardsOf(guild.id, ids)]);
  const rules = { minMessages: config.minMessages, minVoiceMinutes: config.minVoiceMinutes, mode: config.mode };
  const today = streaks.dayOf(now);
  const lang = await guildLanguage(guild.id).catch(() => 'en');
  let did = 0;
  for (const userId of ids) {
    if (did >= PER_GUILD_PER_RUN) break;
    const result = streaks.compute(streaks.activeDays(days.get(userId) ?? [], rules), today, actions.freezesFor(actions.planFreezesOf(plans.get(userId)), config.guildFreezes));
    if (result.current < 1) continue;
    const due = dueFor(result.current, config.milestones, roles, awards.get(userId) ?? new Set());
    if (!due.record.length) continue;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || member.user.bot) { for (const d of due.record) await db.recordAward(guild.id, userId, d); continue; }
    for (const role of due.roles) {
      const found = guild.roles.cache.get(role.roleId);
      const me = guild.members.me;
      if (!found || found.managed || (me && found.position >= me.roles.highest.position)) { logger.warn(`Streak roles: Petto cannot give the role ${role.roleId} in guild ${guild.id}.`); continue; }
      try { await member.roles.add(role.roleId, `Streak of ${role.days} days`); did += 1; await sleep(GAP_MS); } catch (error) { logger.warn(`Streak roles: could not give ${role.roleId} in guild ${guild.id}: ${(error as Error).message}`); }
    }
    let said = false;
    for (const d of due.record) {
      if (!(await db.recordAward(guild.id, userId, d))) continue; // another look did it first
      if (!said && canSay && due.announce === d) {
        said = true;
        try { await (channel as unknown as { send: (o: unknown) => Promise<unknown> }).send({ content: t(lang, 'streaks.milestone', { user: `<@${userId}>`, days: d }), allowedMentions: { users: [userId] } }); did += 1; await sleep(GAP_MS); } catch (error) { logger.warn(`Streak announcement failed in guild ${guild.id}: ${(error as Error).message}`); }
      }
    }
  }
  return did;
}

/** Every server that has an announcement channel or reward roles, one after the other. */
export async function runStreakRewards(client: Client): Promise<void> {
  for (const guildId of await db.guildsWithRewards()) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    try { await runGuild(guild); } catch (error) { logger.error(`Streak rewards error in guild ${guildId}:`, error); }
  }
}
