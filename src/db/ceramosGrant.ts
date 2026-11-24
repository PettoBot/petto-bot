// i18n-ignore-file: database layer, nothing here is shown to anyone.
// The settings of who may give ceramos from the dashboard, and what each person gave today (table `ceramos_grant_settings` and the ledger).
// Written in TypeScript: `npm run build:ts` compiles it over db/ceramosGrant.js.
interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };

export interface GrantSettings { enabled: boolean; maxPerGrant: number; maxPerDay: number; people: string[] }
export const DEFAULT_SETTINGS: GrantSettings = { enabled: true, maxPerGrant: 5000, maxPerDay: 20000, people: [] };

export async function getSettings(): Promise<GrantSettings> {
  const { rows } = await getPrimaryPool().query(`select enabled, max_per_grant, max_per_day, people from ceramos_grant_settings where id = 1`);
  const row = rows[0];
  if (!row) return { ...DEFAULT_SETTINGS };
  return { enabled: Boolean(row.enabled), maxPerGrant: Number(row.max_per_grant), maxPerDay: Number(row.max_per_day), people: Array.isArray(row.people) ? (row.people as unknown[]).map(String) : [] };
}

export async function saveSettings(settings: GrantSettings): Promise<void> {
  await getPrimaryPool().query(
    `insert into ceramos_grant_settings (id, enabled, max_per_grant, max_per_day, people) values (1, $1, $2, $3, $4)
     on conflict (id) do update set enabled = $1, max_per_grant = $2, max_per_day = $3, people = $4, updated_at = now()`,
    [settings.enabled, settings.maxPerGrant, settings.maxPerDay, settings.people]);
}

/** What one person of the team gave in the last 24 hours. */
export async function givenToday(adminId: string): Promise<number> {
  const { rows } = await getPrimaryPool().query(`select coalesce(sum(delta), 0) as total from ceramos_ledger where by_user = $1 and reason = 'grant' and delta > 0 and created_at > now() - interval '24 hours'`, [adminId]);
  return Number(rows[0]?.total ?? 0);
}

/** The last gifts of the team. */
export async function recentGrants(limit = 15): Promise<{ userId: string; amount: number; byUser: string | null; note: string | null; createdAt: string }[]> {
  const { rows } = await getPrimaryPool().query(`select user_id, delta, by_user, ref, created_at from ceramos_ledger where reason = 'grant' and delta > 0 order by id desc limit $1`, [Math.max(1, Math.min(50, limit))]);
  return rows.map((row) => ({ userId: String(row.user_id), amount: Number(row.delta), byUser: row.by_user ? String(row.by_user) : null, note: row.ref ? String(row.ref) : null, createdAt: new Date(row.created_at as string).toISOString() }));
}
