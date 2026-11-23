"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWallet = getWallet;
exports.claimDaily = claimDaily;
exports.give = give;
exports.spend = spend;
exports.lastMovements = lastMovements;
exports.deleteCeramos = deleteCeramos;
const { getPrimaryPool } = require('./postgres');
async function getWallet(userId) {
    const { rows } = await getPrimaryPool().query(`select balance, to_char(last_daily, 'YYYY-MM-DD') as last_daily from ceramos_wallets where user_id = $1`, [userId]);
    return { balance: Number(rows[0]?.balance ?? 0), lastDaily: rows[0]?.last_daily ?? null };
}
/** Claims the daily ceramos of `day` (`YYYY-MM-DD`). Returns the new balance, or null when that day was already claimed. */
async function claimDaily(userId, amount, day) {
    const { rows } = await getPrimaryPool().query(`with up as (
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
async function give(userId, amount, reason, ref = null, byUser = null) {
    const { rows } = await getPrimaryPool().query(`with up as (
       insert into ceramos_wallets (user_id, balance) values ($1, $2)
       on conflict (user_id) do update set balance = ceramos_wallets.balance + $2, updated_at = now()
       returning balance
     ), led as (
       insert into ceramos_ledger (user_id, delta, reason, ref, by_user) select $1, $2, $3, $4, $5 from up returning id
     )
     select balance from up`, [userId, amount, reason, ref, byUser]);
    return Number(rows[0]?.balance ?? 0);
}
/** Takes ceramos only if the person has them. Returns the new balance, or null when they do not have enough. */
async function spend(userId, amount, reason, ref = null, byUser = null) {
    const { rows } = await getPrimaryPool().query(`with up as (
       update ceramos_wallets set balance = balance - $2, updated_at = now() where user_id = $1 and balance >= $2 returning balance
     ), led as (
       insert into ceramos_ledger (user_id, delta, reason, ref, by_user) select $1, -$2::bigint, $3, $4, $5 from up returning id
     )
     select balance from up`, [userId, amount, reason, ref, byUser]);
    return rows[0] ? Number(rows[0].balance) : null;
}
async function lastMovements(userId, limit = 5) {
    const { rows } = await getPrimaryPool().query('select delta, reason, ref, created_at from ceramos_ledger where user_id = $1 order by id desc limit $2', [userId, limit]);
    return rows.map((row) => ({ delta: Number(row.delta), reason: String(row.reason), ref: row.ref ?? null, createdAt: new Date(String(row.created_at)) }));
}
/** Forgets the wallet and the ledger of a person (what they ask for when they want their data deleted). */
async function deleteCeramos(userId) {
    const pool = getPrimaryPool();
    await pool.query('delete from ceramos_ledger where user_id = $1', [userId]);
    await pool.query('delete from ceramos_wallets where user_id = $1', [userId]);
}
