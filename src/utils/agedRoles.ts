// i18n-ignore-file: the texts of the commands are in the catalogs (agedroles.*); the rest here only logs for the team or builds audit reasons.
// Aged roles: who is due, and one look at a server (the job jobs/agedRolesJob.js looks at every server that has rules). The rules are in db/agedRoles.ts. Written in TypeScript:
// `npm run build:ts` compiles it over utils/agedRoles.js.
import type { Client, Guild, GuildMember } from 'discord.js';
import { rulesOf, type AgedRule } from '../db/agedRoles';
export * from '../db/agedRoles';

interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
const { getPrimaryPool } = require('../db/postgres') as { getPrimaryPool: () => Pool };
const logger = require('./logger') as { info: (m: string) => void; warn: (m: string) => void; error: (m: string, e?: unknown) => void };
const DAY_MS = 86_400_000;

export interface MemberFacts { bot: boolean; joinedTimestamp: number | null; roleIds: ReadonlySet<string> }

/** What a member should get now: the roles to give and the roles to take away, from the rules (pure: no Discord here). */
export function dueChanges(member: MemberFacts, rules: readonly AgedRule[], now: number): { add: { roleId: string; rule: AgedRule }[]; remove: { roleId: string; rule: AgedRule }[] } {
  const add: { roleId: string; rule: AgedRule }[] = [];
  const remove: { roleId: string; rule: AgedRule }[] = [];
  if (member.joinedTimestamp === null) return { add, remove };
  const age = now - member.joinedTimestamp;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.target === 'humans' && member.bot) continue;
    if (rule.target === 'bots' && !member.bot) continue;
    if (age < rule.days * DAY_MS) continue;
    if (!member.roleIds.has(rule.roleId) && !add.some((a) => a.roleId === rule.roleId)) add.push({ roleId: rule.roleId, rule });
    if (rule.removeRoleId && member.roleIds.has(rule.removeRoleId) && !remove.some((r) => r.roleId === rule.removeRoleId)) remove.push({ roleId: rule.removeRoleId, rule });
  }
  return { add, remove };
}

const PER_GUILD_PER_RUN = 200; // role changes in one server in one look: the rest wait for the next one (a big server is done in a few hours, never in a burst)
const GAP_MS = Number(process.env.PETTO_AGED_ROLES_GAP_MS ?? 400); // the pause between two changes (a test sets it to 0)
const MAX_MEMBERS = 100_000;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const complained = new Map<string, number>(); // `${guild}:${role}` -> when it was said
function complainOnce(key: string, text: string): void {
  if (Date.now() - (complained.get(key) ?? 0) < 6 * 3_600_000) return;
  if (complained.size > 500) complained.clear();
  complained.set(key, Date.now());
  logger.warn(text);
}

/** One server: the members who are due get or lose their roles, up to `PER_GUILD_PER_RUN` changes. */
export async function runGuild(guild: Guild, now = Date.now()): Promise<number> {
  const rules = (await rulesOf(guild.id)).filter((rule) => rule.enabled);
  if (!rules.length) return 0;
  if (guild.memberCount > MAX_MEMBERS) { complainOnce(`${guild.id}:big`, `Aged roles: guild ${guild.id} has more than ${MAX_MEMBERS} members, skipped.`); return 0; }
  const me = guild.members.me;
  const usable = (roleId: string): boolean => {
    const role = guild.roles.cache.get(roleId);
    if (!role) { complainOnce(`${guild.id}:${roleId}`, `Aged roles: the role ${roleId} of guild ${guild.id} does not exist any more.`); return false; }
    if (role.managed || (me && role.position >= me.roles.highest.position)) { complainOnce(`${guild.id}:${roleId}`, `Aged roles: Petto cannot give or take the role ${roleId} in guild ${guild.id} (managed, or above its own role).`); return false; }
    return true;
  };
  const members: Map<string, GuildMember> = await guild.members.fetch().catch(() => guild.members.cache as unknown as Map<string, GuildMember>);
  let changes = 0;
  for (const member of members.values()) {
    if (changes >= PER_GUILD_PER_RUN) break;
    const due = dueChanges({ bot: member.user.bot, joinedTimestamp: member.joinedTimestamp ?? null, roleIds: new Set(member.roles.cache.keys()) }, rules, now);
    for (const { roleId, rule } of due.add) {
      if (!usable(roleId)) continue;
      try { await member.roles.add(roleId, `Aged role: ${rule.days} days in the server`); changes += 1; await sleep(GAP_MS); } catch (error) { complainOnce(`${guild.id}:${roleId}:add`, `Aged roles: could not give ${roleId} in guild ${guild.id}: ${(error as Error).message}`); }
    }
    for (const { roleId, rule } of due.remove) {
      if (!usable(roleId)) continue;
      try { await member.roles.remove(roleId, `Aged role: ${rule.days} days in the server`); changes += 1; await sleep(GAP_MS); } catch (error) { complainOnce(`${guild.id}:${roleId}:remove`, `Aged roles: could not take ${roleId} in guild ${guild.id}: ${(error as Error).message}`); }
    }
  }
  return changes;
}

/** Every server that has rules, one after the other. */
export async function runAgedRoles(client: Client): Promise<void> {
  const { rows } = await getPrimaryPool().query('select distinct guild_id from aged_roles where enabled');
  for (const row of rows) {
    const guild = client.guilds.cache.get(String(row.guild_id));
    if (!guild) continue;
    try { await runGuild(guild); } catch (error) { logger.error(`Aged roles error in guild ${guild.id}:`, error); }
  }
}
