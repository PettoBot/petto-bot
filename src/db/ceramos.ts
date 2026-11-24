// i18n-ignore-file: database layer, nothing here is shown to anyone.
// The ceramos of a person (tables `ceramos_wallets` and `ceramos_ledger`). Every change of the balance is ONE statement that also writes the ledger,
// so two commands at once cannot spend the same ceramos twice and the balance never goes below zero.
// Written in TypeScript: `npm run build:ts` compiles it over db/ceramos.js.
interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };

export interface Movement { delta: number; reason: string; ref: string | null; createdAt: Date }

export async function getWallet(userId: string): Promise<{ balance: number; lastDaily: string | null }> {
  const { rows } = await getPrimaryPool().query(`select balance, to_char(last_daily, 'YYYY-MM-DD') as last_daily from ceramos_wallets where user_id = $1`, [userId]);
  return { balance: Number(rows[0]?.balance ?? 0), lastDaily: (rows[0]?.last_daily as string | null | undefined) ?? null };
}

/** Claims the daily ceramos of `day` (`YYYY-MM-DD`). Returns the new balance, or null when that day was already claimed. */
export async function claimDaily(userId: string, amount: number, day: string): Promise<number | null> {
  const { rows } = await getPrimaryPool().query(
    `with up as (
       insert into ceramos_wallets (user_id, balance, last_daily) values ($1, $2, $3::date)
       on conflict (user_id) do update set balance = ceramos_wallets.balance + $2, last_daily = $3::date, updated_at = now()
         where ceramos_wallets.last_daily is null or ceramos_wallets.last_daily < $3::date
       returning balance
     ), led as (
       insert into ceramos_ledger (user_id, delta, reason) select $1, $2, 'daily' from up returning id
     )
     select balance from up`, [userId, amount, day]);
  return rows[0] ? Number(rows[0].balance) : null;
}

/** Gives ceramos (the team, a refund). Returns the new balance. */
export async function give(userId: string, amount: number, reason: string, ref: string | null = null, byUser: string | null = null): Promise<number> {
  const { rows } = await getPrimaryPool().query(
    `with up as (
       insert into ceramos_wallets (user_id, balance) values ($1, $2)
       on conflict (user_id) do update set balance = ceramos_wallets.balance + $2, updated_at = now()
       returning balance
     ), led as (
       insert into ceramos_ledger (user_id, delta, reason, ref, by_user) select $1, $2, $3, $4, $5 from up returning id
     )
     select balance from up`, [userId, amount, reason, ref, byUser]);
  return Number(rows[0]?.balance ?? 0);
}

/**
 * Gives the ceramos of a pack that was paid, once for each order: the order is saved and the wallet and the ledger change in the same statement, so a payment that arrives twice
 * (or two at once) gives them once. Returns the balance and whether this call was the one that gave them.
 */
export async function giveOnce(userId: string, amount: number, pack: string, orderId: string): Promise<{ balance: number; applied: boolean }> {
  const { rows } = await getPrimaryPool().query(
    `with o as (
       insert into ceramos_orders (order_id, user_id, pack, coins) values ($4, $1, $3, $2) on conflict (order_id) do nothing returning order_id
     ), up as (
       insert into ceramos_wallets (user_id, balance) select $1, $2 from o
       on conflict (user_id) do update set balance = ceramos_wallets.balance + $2, updated_at = now() returning balance
     ), led as (
       insert into ceramos_ledger (user_id, delta, reason, ref) select $1, $2, 'purchase', $3 from up returning id
     )
     select (select balance from up) as balance, exists (select 1 from o) as applied`, [userId, amount, pack, orderId]);
  const row = rows[0];
  if (row?.applied) return { balance: Number(row.balance), applied: true };
  const wallet = await getWallet(userId);
  return { balance: wallet.balance, applied: false };
}

/**
 * A pack that was refunded by the payment service: the ceramos of that order are taken back, once (the order is marked in the same statement, so the event arriving twice takes them once).
 * What the person already spent cannot be taken: it takes what they still have, up to the ceramos of the order, and the ledger says the amount really taken. The person comes from the
 * order that was saved, never from the event. Returns null when the order is unknown or was already refunded.
 */
export async function refundOnce(orderId: string): Promise<{ userId: string; coins: number; took: number; balance: number } | null> {
  const { rows } = await getPrimaryPool().query(
    `with o as (
       update ceramos_orders set refunded_at = now() where order_id = $1 and refunded_at is null returning user_id, coins
     ), w as (
       select o.user_id, o.coins, least(coalesce(cw.balance, 0), o.coins) as take from o left join ceramos_wallets cw on cw.user_id = o.user_id
     ), up as (
       update ceramos_wallets set balance = balance - w.take, updated_at = now() from w where ceramos_wallets.user_id = w.user_id returning ceramos_wallets.balance as balance
     ), led as (
       insert into ceramos_ledger (user_id, delta, reason, ref) select user_id, -take, 'refund', $1 from w where take > 0 returning id
     )
     select w.user_id, w.coins, w.take, coalesce((select balance from up), 0) as balance from w`, [orderId]);
  const row = rows[0];
  return row ? { userId: String(row.user_id), coins: Number(row.coins), took: Number(row.take), balance: Number(row.balance) } : null;
}

/** Takes ceramos only if the person has them. Returns the new balance, or null when they do not have enough. */
export async function spend(userId: string, amount: number, reason: string, ref: string | null = null, byUser: string | null = null): Promise<number | null> {
  const { rows } = await getPrimaryPool().query(
    `with up as (
       update ceramos_wallets set balance = balance - $2, updated_at = now() where user_id = $1 and balance >= $2 returning balance
     ), led as (
       insert into ceramos_ledger (user_id, delta, reason, ref, by_user) select $1, -$2::bigint, $3, $4, $5 from up returning id
     )
     select balance from up`, [userId, amount, reason, ref, byUser]);
  return rows[0] ? Number(rows[0].balance) : null;
}

export async function lastMovements(userId: string, limit = 5): Promise<Movement[]> {
  const { rows } = await getPrimaryPool().query('select delta, reason, ref, created_at from ceramos_ledger where user_id = $1 order by id desc limit $2', [userId, limit]);
  return rows.map((row) => ({ delta: Number(row.delta), reason: String(row.reason), ref: (row.ref as string | null) ?? null, createdAt: new Date(String(row.created_at)) }));
}

/** Forgets the wallet and the ledger of a person (what they ask for when they want their data deleted). */
/** The richest wallets, the biggest first. */
export async function topBalances(limit = 10): Promise<{ userId: string; balance: number }[]> {
  const { rows } = await getPrimaryPool().query(`select user_id, balance from ceramos_wallets where balance > 0 order by balance desc, user_id limit $1`, [Math.max(1, Math.min(25, Math.floor(limit)))]);
  return rows.map((row) => ({ userId: String(row.user_id), balance: Number(row.balance) }));
}

export async function deleteCeramos(userId: string): Promise<void> {
  const pool = getPrimaryPool();
  await pool.query('delete from ceramos_ledger where user_id = $1', [userId]);
  await pool.query('delete from ceramos_wallets where user_id = $1', [userId]);
}
