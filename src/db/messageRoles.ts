// i18n-ignore-file: database layer, nothing here is shown to anyone.
// Message roles: "at N messages, give this role". The rules are rows of `message_roles` (the dashboard and `/messagerole` write them); the counting and the roles are in utils/messageRoles.ts.
// `total` counts every message since the first rule of the server was made; `period` counts the messages of the last `period_days` days and can take the role away again (`remove_below`).
// Written in TypeScript: `npm run build:ts` compiles it over db/messageRoles.js.
interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };
const { createExpiringCache } = require('../utils/expiringCache') as { createExpiringCache: <T>(ttl: number, options: { invalidateOn: string[] }) => { get(key: string, loader: () => Promise<T>): Promise<T>; delete(key: string): void } };

export const MAX_RULES = 25;
export const MAX_MESSAGES = 10_000_000;
export const MAX_PERIOD_DAYS = 365;
export const MODES = ['total', 'period'] as const;
export type Mode = (typeof MODES)[number];
export interface MessageRule { id: number; roleId: string; messages: number; mode: Mode; periodDays: number; removeBelow: boolean; enabled: boolean }
export type NewRule = { roleId: string; messages: number; mode?: Mode; periodDays?: number | null; removeBelow?: boolean };
export type Problem = 'full' | 'messages' | 'period';

const rowToRule = (row: Record<string, unknown>): MessageRule => ({
  id: Number(row.id), roleId: String(row.role_id), messages: Number(row.messages), mode: row.mode === 'period' ? 'period' : 'total',
  periodDays: Number(row.period_days) || 0, removeBelow: row.remove_below === true, enabled: row.enabled !== false,
});

const cache = createExpiringCache<MessageRule[]>(15_000, { invalidateOn: ['message_roles'] });

/** Every rule of a server (also the ones that are off: the commands and the dashboard list them). */
export function rulesOf(guildId: string): Promise<MessageRule[]> {
  return cache.get(String(guildId), async () => {
    const { rows } = await getPrimaryPool().query('select id, role_id, messages, mode, period_days, remove_below, enabled from message_roles where guild_id = $1 order by messages, id', [guildId]);
    return rows.map(rowToRule);
  });
}

/** The rule as it will be saved, or why it cannot be (pure, so the command, the dashboard and the checks agree). */
export function normalize(rule: NewRule): { ok: true; rule: { roleId: string; messages: number; mode: Mode; periodDays: number; removeBelow: boolean } } | { ok: false; reason: Problem } {
  if (!Number.isInteger(rule.messages) || rule.messages < 1 || rule.messages > MAX_MESSAGES) return { ok: false, reason: 'messages' };
  const mode: Mode = rule.mode === 'period' || (rule.periodDays ?? 0) > 0 ? 'period' : 'total';
  if (mode === 'total') return { ok: true, rule: { roleId: rule.roleId, messages: rule.messages, mode, periodDays: 0, removeBelow: false } };
  const days = rule.periodDays ?? 0;
  if (!Number.isInteger(days) || days < 1 || days > MAX_PERIOD_DAYS) return { ok: false, reason: 'period' };
  return { ok: true, rule: { roleId: rule.roleId, messages: rule.messages, mode, periodDays: days, removeBelow: rule.removeBelow === true } };
}

export async function addRule(guildId: string, input: NewRule): Promise<{ ok: true; rule: MessageRule } | { ok: false; reason: Problem }> {
  const checked = normalize(input);
  if (checked.ok === false) return { ok: false, reason: checked.reason };
  const rule = checked.rule;
  const pool = getPrimaryPool();
  const have = Number((await pool.query('select count(*)::int as n from message_roles where guild_id = $1', [guildId])).rows[0]?.n ?? 0);
  const exists = (await pool.query('select 1 from message_roles where guild_id = $1 and role_id = $2 and messages = $3 and mode = $4 and period_days = $5', [guildId, rule.roleId, rule.messages, rule.mode, rule.periodDays])).rows.length > 0;
  if (!exists && have >= MAX_RULES) return { ok: false, reason: 'full' };
  const { rows } = await pool.query(
    `insert into message_roles (guild_id, role_id, messages, mode, period_days, remove_below) values ($1, $2, $3, $4, $5, $6)
     on conflict (guild_id, role_id, messages, mode, period_days) do update set remove_below = excluded.remove_below, enabled = true
     returning id, role_id, messages, mode, period_days, remove_below, enabled`,
    [guildId, rule.roleId, rule.messages, rule.mode, rule.periodDays, rule.removeBelow]);
  cache.delete(String(guildId));
  return { ok: true, rule: rowToRule(rows[0] ?? {}) };
}

/** Removes the rules of a role (the one with that number of messages, or all of them when `messages` is left out). How many were removed. */
export async function removeRule(guildId: string, roleId: string, messages?: number | null): Promise<number> {
  const pool = getPrimaryPool();
  const result = messages ? await pool.query('delete from message_roles where guild_id = $1 and role_id = $2 and messages = $3 returning id', [guildId, roleId, messages])
    : await pool.query('delete from message_roles where guild_id = $1 and role_id = $2 returning id', [guildId, roleId]);
  cache.delete(String(guildId));
  return result.rows.length;
}
