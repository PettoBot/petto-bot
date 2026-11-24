// i18n-ignore-file: database layer, nothing here is shown to anyone.
// The plan of a person (table `user_plans`): Bronze, Silver or Gold, with the day it ends. The team puts one by hand from the dashboard; the payment service will put
// them too. A plan past its end is not active, and it is never deleted by itself (the row says when it ended).
// Written in TypeScript: `npm run build:ts` compiles it over db/userPlans.js.
interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };

export interface PlanRow { userId: string; plan: string; endsAt: string | null; renews: boolean; source: string; grantedBy: string | null; note: string | null; startedAt: string; active: boolean }

const iso = (value: unknown): string | null => (value ? new Date(String(value)).toISOString() : null);
const toRow = (row: Record<string, unknown>): PlanRow => ({
  userId: String(row.user_id), plan: String(row.plan), endsAt: iso(row.ends_at), renews: Boolean(row.renews), source: String(row.source), grantedBy: (row.granted_by as string | null) ?? null,
  note: (row.note as string | null) ?? null, startedAt: iso(row.started_at) ?? '', active: Boolean(row.active),
});
const COLUMNS = 'user_id, plan, ends_at, renews, source, granted_by, note, started_at, (ends_at is null or ends_at > now()) as active';

/** The plan of a person with whether it is active now, or null when they never had one. */
export async function getPlan(userId: string): Promise<PlanRow | null> {
  const { rows } = await getPrimaryPool().query(`select ${COLUMNS} from user_plans where user_id = $1`, [userId]);
  return rows[0] ? toRow(rows[0]) : null;
}

/** Puts a plan on a person until `endsAt` (null: no end). Replaces the one they had. */
export async function setPlan(userId: string, plan: string, endsAt: string | null, source: 'team' | 'payment', by: string | null, note: string | null): Promise<void> {
  await getPrimaryPool().query(
    `insert into user_plans (user_id, plan, ends_at, source, granted_by, note) values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id) do update set plan = excluded.plan, ends_at = excluded.ends_at, source = excluded.source, granted_by = excluded.granted_by, note = excluded.note, started_at = now(), updated_at = now()`,
    [userId, plan, endsAt, source, by, note]);
}

/** Ends the plan of a person now. Returns whether they had one. */
export async function endPlan(userId: string): Promise<boolean> {
  const { rows } = await getPrimaryPool().query('update user_plans set ends_at = now(), renews = false, updated_at = now() where user_id = $1 and (ends_at is null or ends_at > now()) returning user_id', [userId]);
  return rows.length > 0;
}

/** Every person with an active plan, for the list of the team (up to 200, the newest first). */
export async function listActive(): Promise<PlanRow[]> {
  const { rows } = await getPrimaryPool().query(`select ${COLUMNS} from user_plans where ends_at is null or ends_at > now() order by updated_at desc limit 200`);
  return rows.map(toRow);
}

/** Every person who ever had a plan, with whether it is active now (no limit): for the job that gives and takes the roles of the plans. */
export async function listAll(): Promise<{ userId: string; plan: string; active: boolean }[]> {
  const { rows } = await getPrimaryPool().query('select user_id, plan, (ends_at is null or ends_at > now()) as active from user_plans');
  return rows.map((row) => ({ userId: String(row.user_id), plan: String(row.plan), active: Boolean(row.active) }));
}
