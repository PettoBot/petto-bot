// i18n-ignore-file: the messages are written with the catalog (streaks.dm.*); the rest only logs for the team.
// What a streak says on its own besides the milestones and the roles (utils/streakRewards.ts): a reminder by DM a few hours before the day ends to who would lose a streak, a message when a
// streak was lost, and the streak in the nickname ("name | 7 🔥"). Each server chooses which of the three it wants; a member can turn the DMs and the nickname off for themselves (`/streak
// notifications:false`). Only the members with activity in the last three days are looked at, a reminder or a lost-streak message goes once a day (streak_notices), and the custom emoji of
// the nickname needs Premium on the server (without it the fire is used). Written in TypeScript: compiled over streakNotices.js.
import type { Guild, GuildMember } from 'discord.js';
const db = require('../db/streaks') as typeof import('../db/streaks');
const streaks = require('./streaks') as typeof import('./streaks');
const actions = require('./streakActions') as typeof import('./streakActions');
const premiumDb = require('../db/premium') as { getGuildPremium(guildId: string): Promise<{ active: boolean }> };
const { t, guildLanguage } = require('../i18n') as { t: (lang: string, key: string, vars?: Record<string, unknown>) => string; guildLanguage: (guildId: string) => Promise<string> };
const { sendDm } = require('./dmOrigin') as { sendDm(target: unknown, payload: unknown, options?: Record<string, unknown>): Promise<unknown> };
const logger = require('./logger') as { warn: (m: string) => void; error: (m: string, e?: unknown) => void };

export const MIN_STREAK = 3;          // a streak shorter than this is not worth a reminder
export const REMINDER_HOURS = 3;      // the reminder goes in the last hours of the day
export const NICK_MIN = 2;            // the streak shows in the nickname from this many days
const PER_GUILD_PER_RUN = 40;
const GAP_MS = Number(process.env.PETTO_STREAK_GAP_MS ?? 600);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
// " | 7 🔥" at the end of a name (the emoji is any short run of non-space characters).
const SUFFIX = /\s\|\s\d+\s\S{1,8}$/u;

/** Hours left of the day of Colombia (GMT-5), the day the streaks are counted in. */
export const hoursLeft = (now: Date): number => {
  const local = (require('./botTime') as { shifted: (date?: Date) => Date }).shifted(now);
  return (Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - local.getTime()) / 3_600_000;
};

/** A reminder is due when the streak is worth it, the day is not done and little of it is left. */
export const reminderDue = (current: number, activeToday: boolean, left: number): boolean => current >= MIN_STREAK && !activeToday && left <= REMINDER_HOURS;

/** A streak was lost when it was alive a day ago (and worth a message) and it is gone now. */
export const lostDue = (before: number, now: number): boolean => before >= MIN_STREAK && now === 0;

/** The name with its streak: the old suffix is taken away, the name is cut so that the whole is 32 characters at most, and below `NICK_MIN` days there is no suffix. */
export function nicknameFor(name: string, current: number, emoji: string): string {
  const base = name.replace(SUFFIX, '').trim();
  if (current < NICK_MIN) return base;
  const suffix = ` | ${current} ${emoji}`;
  // Discord counts the length of a nickname in UTF-16 units, so that is how it is cut (a letter at a time, never in the middle of an emoji).
  let kept = '';
  for (const letter of base) { if ((kept + letter).length > Math.max(1, 32 - suffix.length)) break; kept += letter; }
  return `${kept.trimEnd()}${suffix}`;
}

/** One server: the reminders, the lost streaks and the nicknames of the members with activity in the last three days. Returns how many actions it did. */
export async function runNotices(guild: Guild, now: Date = new Date()): Promise<number> {
  const config = await db.getConfig(guild.id);
  if (!config.enabled || !(config.dmReminder || config.dmLost || config.nicknameEnabled)) return 0;
  const ids = await db.recentMembers(guild.id, 3000, 3);
  if (!ids.length) return 0;
  const [days, plans, out] = await Promise.all([db.daysOfMany(guild.id, ids, config.resetAt), db.plansOf(ids), db.optedOut(ids)]);
  const premium = config.nicknameEnabled ? Boolean((await premiumDb.getGuildPremium(guild.id).catch(() => ({ active: false }))).active) : false;
  const emoji = premium ? config.nicknameEmoji : '🔥';
  const rules = { minMessages: config.minMessages, minVoiceMinutes: config.minVoiceMinutes, mode: config.mode };
  const today = streaks.dayOf(streaks.graceNow(now, config.graceMinutes));
  const yesterday = streaks.dayOf(new Date(streaks.graceNow(now, config.graceMinutes).getTime() - 86_400_000));
  const lang = await guildLanguage(guild.id).catch(() => 'en');
  const me = guild.members.me;
  let did = 0;
  for (const userId of ids) {
    if (did >= PER_GUILD_PER_RUN) break;
    if (out.has(userId)) continue;
    const freezes = actions.freezesFor(actions.planFreezesOf(plans.get(userId)), config.guildFreezes);
    const active = streaks.activeDays(days.get(userId) ?? [], rules);
    const current = streaks.compute(active, today, freezes);
    const before = streaks.compute(active, yesterday, freezes);
    const wantsReminder = config.dmReminder && reminderDue(current.current, current.activeToday, hoursLeft(now));
    const wantsLost = config.dmLost && lostDue(before.current, current.current);
    const member: GuildMember | null = (wantsReminder || wantsLost || config.nicknameEnabled) ? (guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null)) : null;
    if (!member || member.user.bot) continue;
    const send = async (kind: 'reminder' | 'lost', key: string, vars: Record<string, unknown>): Promise<void> => {
      if (!(await db.claimNotice(guild.id, userId, kind, today))) return;
      try { await sendDm(member, { content: t(lang, key, { ...vars, server: guild.name }) }, { guild, kind: 'notice' }); did += 1; await sleep(GAP_MS); } catch { /* DMs closed: nothing to do */ }
    };
    if (wantsReminder) await send('reminder', 'streaks.dm.reminder', { days: current.current, hours: Math.max(1, Math.ceil(hoursLeft(now))) });
    else if (wantsLost) await send('lost', 'streaks.dm.lost', { days: before.current });
    if (config.nicknameEnabled && member.manageable && me) {
      const shown = member.nickname ?? member.user.globalName ?? member.user.username;
      const wanted = nicknameFor(shown, current.current, emoji);
      if (wanted !== shown) {
        try {
          // A name that is the account's own name goes back to no nickname.
          const own = wanted === (member.user.globalName ?? member.user.username);
          await member.setNickname(own ? null : wanted, 'Streak in the nickname');
          did += 1; await sleep(GAP_MS);
        } catch (error) { logger.warn(`Streak nickname failed in guild ${guild.id}: ${(error as Error).message}`); }
      }
    }
  }
  return did;
}
