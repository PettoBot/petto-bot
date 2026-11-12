// The role of the most active member: when a week ends, the number 1 of the weekly ranking of the chat (or of the voice) gets the role chosen by the server and
// the one who had it loses it. It reads the same counts as the leaderboards (`activity_members`), so it follows what a server turned off in `!statsconfig` and who
// asked not to be counted (`!stats privacy`). Weeks are the ones of Petto: Monday to Sunday, GMT-5 (Colombia). Nothing here is ever given by hand: a role can only be
// taken or given by the job (every 5 minutes it looks for the ones not given yet for the week that just ended) and by `/activityboard role-remove`.
// Written in TypeScript: `npm run build:ts` compiles it over src/utils/activityTopRole.js, which is what the bot loads.
import { PermissionFlagsBits } from 'discord.js';
import type { Client, Guild, Role } from 'discord.js';
import leaderboards = require('../db/activityLeaderboards');
import roles = require('../db/activityTopRoles');
import type { TopRoleRow } from '../db/activityTopRoles';
import { CANDIDATES, periodWindow, statsReason, topMembers } from './activityLeaderboard';

/** The short reason saved in the row when the role cannot be given; the command and the dashboard say it in words. */
export type RoleReason = 'statsOff' | 'membersOff' | 'role' | 'permissions' | 'error';

export interface AwardResult { ok: boolean; reason?: RoleReason; winner?: string | null }

const { t, guildLanguage } = require('../i18n') as { t: (lang: string, key: string, vars?: Record<string, unknown>) => string; guildLanguage: (guildId: string) => Promise<string> };
const logger = require('./logger') as { warn: (message: string) => void };

const DAY_MS = 86_400_000;
const ERROR_CODES = { unknownRole: 10011, missingAccess: 50001, missingPermissions: 50013 } as const;
const codeOf = (error: unknown): number | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : null;
};

/**
 * The week that just ended for `now`: its first day (`YYYY-MM-DD`) and the first day of the week that is running, which is where it stops.
 * On a Monday at one in the morning (GMT-5) it is the week that finished an hour ago.
 */
export function lastWeek(now: Date = new Date()): { week: string; until: string } {
  return { week: periodWindow('weekly', new Date(now.getTime() - 7 * DAY_MS)).startDay, until: periodWindow('weekly', now).startDay };
}

/** Why Petto cannot hand out this role, or null when it can: it has to exist, not be the one of everybody or one of a bot or a booster, and be below the roles of Petto. */
export function roleProblem(guild: Guild, role: Role | null | undefined): RoleReason | null {
  if (!role || role.id === guild.id || role.managed) return 'role';
  const me = guild.members.me;
  if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles) || me.roles.highest.comparePositionTo(role) <= 0) return 'permissions';
  return null;
}

/**
 * Gives the role of one row for the week that just ended: the number 1 of that week gets it, whoever had it loses it, and the week is remembered so it is not given twice.
 * When nobody was active the role is taken from the one who had it and stays with nobody. A role that cannot be given keeps the reason in the database and is tried
 * again in an hour. Never throws for something that is the server's doing.
 */
export async function awardRole(client: Client, row: TopRoleRow, { now = new Date() }: { now?: Date } = {}): Promise<AwardResult> {
  const guild = client.guilds.cache.get(row.guild_id);
  if (!guild) return { ok: false, reason: 'error' }; // not reachable now: nothing is said, it is looked at again
  const fail = async (reason: RoleReason): Promise<AwardResult> => { await roles.markError(row.guild_id, row.kind, reason); return { ok: false, reason }; };

  const blocked = statsReason(guild.id);
  if (blocked) return fail(blocked);
  const role = guild.roles.cache.get(row.role_id) ?? await guild.roles.fetch(row.role_id).catch(() => null);
  const problem = roleProblem(guild, role);
  if (problem) return fail(problem);
  const target = role as Role;

  const { week, until } = lastWeek(now);
  const winner = (await topMembers(guild, await leaderboards.readTopBetween(guild.id, row.kind, week, until, CANDIDATES), 1))[0] ?? null;
  const reason = t(await guildLanguage(guild.id), 'leaderboards.role.reason', { week });

  try {
    if (winner) {
      const member = guild.members.cache.get(winner.userId);
      if (member && !member.roles.cache.has(target.id)) await member.roles.add(target.id, reason);
    }
    if (row.holder_id && row.holder_id !== winner?.userId) {
      const previous = guild.members.cache.get(row.holder_id) ?? await guild.members.fetch(row.holder_id).catch(() => null);
      if (previous?.roles.cache.has(target.id)) await previous.roles.remove(target.id, reason);
    }
  } catch (error) {
    const code = codeOf(error);
    if (code === ERROR_CODES.unknownRole) return fail('role');
    if (code === ERROR_CODES.missingAccess || code === ERROR_CODES.missingPermissions) return fail('permissions');
    logger.warn(`Role of the most active member (${row.kind}) in guild ${row.guild_id} could not be given: ${(error as Error)?.message}`);
    return fail('error');
  }
  await roles.markAwarded(row.guild_id, row.kind, week, winner?.userId ?? null);
  return { ok: true, winner: winner?.userId ?? null };
}

/** Takes the role from who has it, for a role that was taken away (best effort: the member or the role may be gone, or Petto may not be allowed any more). */
export async function takeRoleFromHolder(client: Client, row: TopRoleRow): Promise<void> {
  if (!row.holder_id) return;
  const guild = client.guilds.cache.get(row.guild_id);
  if (!guild) return;
  const holder = guild.members.cache.get(row.holder_id) ?? await guild.members.fetch(row.holder_id).catch(() => null);
  if (holder?.roles.cache.has(row.role_id)) await holder.roles.remove(row.role_id, t(await guildLanguage(guild.id), 'leaderboards.role.removedReason')).catch(() => null);
}

/** Gives the roles that are due, one server after another with a pause between them. */
export async function runDueRoles(client: Client, { now = new Date(), pauseMs = 1500, sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }) }: { now?: Date; pauseMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<number> {
  const due = await roles.listDue(lastWeek(now).week);
  for (const row of due) {
    try {
      await awardRole(client, row, { now });
    } catch (error) {
      logger.warn(`Role of the most active member (${row.kind}) in guild ${row.guild_id} failed: ${(error as Error)?.message}`);
    }
    await sleep(pauseMs);
  }
  return due.length;
}
