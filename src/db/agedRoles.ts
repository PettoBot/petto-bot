// i18n-ignore-file: database layer, nothing here is shown to anyone.
// Aged roles: "after N days in the server, give this role (and take another one away)". The rules are rows of `aged_roles` (the dashboard and `/role aged` write them); a job
// (jobs/agedRolesJob.js) looks at the members of the servers that have rules, a few at a time. Written in TypeScript: `npm run build:ts` compiles it over db/agedRoles.js. Who is due and the look at a server are in utils/agedRoles.ts.
interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };
const { createExpiringCache } = require('../utils/expiringCache') as { createExpiringCache: <T>(ttl: number, options: { invalidateOn: string[] }) => { get(key: string, loader: () => Promise<T>): Promise<T>; delete(key: string): void } };

export const MAX_RULES = 25;
export const TARGETS = ['humans', 'all', 'bots'] as const;
export type Target = (typeof TARGETS)[number];
export interface AgedRule { id: number; roleId: string; days: number; removeRoleId: string | null; target: Target; enabled: boolean }

const rowToRule = (row: Record<string, unknown>): AgedRule => ({
  id: Number(row.id), roleId: String(row.role_id), days: Number(row.days), removeRoleId: (row.remove_role_id as string | null) ?? null,
  target: (TARGETS as readonly unknown[]).includes(row.target) ? (row.target as Target) : 'humans', enabled: row.enabled !== false,
});

const cache = createExpiringCache<AgedRule[]>(15_000, { invalidateOn: ['aged_roles'] });

/** Every rule of a server (also the ones that are off: the commands and the dashboard list them). */
export function rulesOf(guildId: string): Promise<AgedRule[]> {
  return cache.get(String(guildId), async () => {
    const { rows } = await getPrimaryPool().query('select id, role_id, days, remove_role_id, target, enabled from aged_roles where guild_id = $1 order by days, id', [guildId]);
    return rows.map(rowToRule);
  });
}

export async function addRule(guildId: string, rule: { roleId: string; days: number; removeRoleId?: string | null; target?: Target }): Promise<{ ok: true } | { ok: false; reason: 'full' | 'days' | 'same' }> {
  if (!Number.isInteger(rule.days) || rule.days < 1 || rule.days > 3650) return { ok: false, reason: 'days' };
  if (rule.removeRoleId && rule.removeRoleId === rule.roleId) return { ok: false, reason: 'same' };
  const pool = getPrimaryPool();
  const have = Number((await pool.query('select count(*)::int as n from aged_roles where guild_id = $1', [guildId])).rows[0]?.n ?? 0);
  const exists = (await pool.query('select 1 from aged_roles where guild_id = $1 and role_id = $2 and days = $3', [guildId, rule.roleId, rule.days])).rows.length > 0;
  if (!exists && have >= MAX_RULES) return { ok: false, reason: 'full' };
  await pool.query(
    `insert into aged_roles (guild_id, role_id, days, remove_role_id, target) values ($1, $2, $3, $4, $5)
     on conflict (guild_id, role_id, days) do update set remove_role_id = excluded.remove_role_id, target = excluded.target, enabled = true`,
    [guildId, rule.roleId, rule.days, rule.removeRoleId ?? null, rule.target ?? 'humans']);
  cache.delete(String(guildId));
  return { ok: true };
}

/** Removes the rules of a role (the one with that number of days, or all of them when `days` is left out). How many were removed. */
export async function removeRule(guildId: string, roleId: string, days?: number | null): Promise<number> {
  const pool = getPrimaryPool();
  const result = days ? await pool.query('delete from aged_roles where guild_id = $1 and role_id = $2 and days = $3 returning id', [guildId, roleId, days])
    : await pool.query('delete from aged_roles where guild_id = $1 and role_id = $2 returning id', [guildId, roleId]);
  cache.delete(String(guildId));
  return result.rows.length;
}

