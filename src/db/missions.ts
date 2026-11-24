// i18n-ignore-file: database layer, nothing here is shown to anyone.
// What a person did (activity_members) and the missions they already claimed (mission_claims). Paying a mission is ONE statement: the claim, the wallet and the ledger change
// together or not at all, so two taps at once cannot pay it twice.
// Written in TypeScript: `npm run build:ts` compiles it over db/missions.js.
interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };

/** Messages and seconds of voice of a person in every server, from `from` to `to` (days, both included). activity_members already leaves out who asked not to be counted. */
export async function activityBetween(userId: string, from: string, to: string): Promise<{ messages: number; voiceSeconds: number }> {
  const { rows } = await getPrimaryPool().query(
    `select coalesce(sum(messages), 0) as messages, coalesce(sum(voice_seconds), 0) as voice from activity_members where user_id = $1 and day between $2::date and $3::date`, [userId, from, to]);
  return { messages: Number(rows[0]?.messages ?? 0), voiceSeconds: Number(rows[0]?.voice ?? 0) };
}

/** The claims of a person in these periods, as `missionId|periodKey`. */
export async function claimed(userId: string, periodKeys: string[]): Promise<Set<string>> {
  const { rows } = await getPrimaryPool().query(`select mission_id, period_key from mission_claims where user_id = $1 and period_key = any($2::text[])`, [userId, periodKeys]);
  return new Set(rows.map((row) => `${String(row.mission_id)}|${String(row.period_key)}`));
}

/** Pays a mission once for the period. Returns whether this call was the one that paid, and the balance after. */
export async function claimOnce(userId: string, missionId: string, periodKey: string, reward: number): Promise<{ applied: boolean; balance: number | null }> {
  const { rows } = await getPrimaryPool().query(
    `with claim as (
       insert into mission_claims (user_id, mission_id, period_key) values ($1, $2, $3) on conflict do nothing returning 1
     ), up as (
       insert into ceramos_wallets (user_id, balance) select $1, $4 from claim
       on conflict (user_id) do update set balance = ceramos_wallets.balance + $4, updated_at = now() returning balance
     ), led as (
       insert into ceramos_ledger (user_id, delta, reason, ref) select $1, $4, 'mission', $2 from claim returning id
     )
     select (select count(*) from claim) as applied, (select balance from up) as balance`, [userId, missionId, periodKey, reward]);
  const applied = Number(rows[0]?.applied ?? 0) > 0;
  return { applied, balance: rows[0]?.balance === null || rows[0]?.balance === undefined ? null : Number(rows[0].balance) };
}
