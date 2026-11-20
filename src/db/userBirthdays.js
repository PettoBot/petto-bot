"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPersonalBirthday = getPersonalBirthday;
exports.setPersonalBirthday = setPersonalBirthday;
exports.removePersonalBirthday = removePersonalBirthday;
const { getPrimaryPool } = require('./postgres');
const rowTo = (row) => ({ month: Number(row.month), day: Number(row.day), year: row.year === null || row.year === undefined ? null : Number(row.year) });
async function getPersonalBirthday(userId) {
    const { rows } = await getPrimaryPool().query('select month, day, year from user_birthdays where user_id = $1', [userId]);
    return rows[0] ? rowTo(rows[0]) : null;
}
async function setPersonalBirthday(userId, { month, day, year = null }) {
    const { rows } = await getPrimaryPool().query(`insert into user_birthdays (user_id, month, day, year) values ($1, $2, $3, $4)
     on conflict (user_id) do update set month = excluded.month, day = excluded.day, year = excluded.year, updated_at = now()
     returning month, day, year`, [userId, month, day, year ?? null]);
    return rowTo(rows[0] ?? { month, day, year });
}
/** Forgets it. Returns whether there was one. */
async function removePersonalBirthday(userId) {
    const { rows } = await getPrimaryPool().query('delete from user_birthdays where user_id = $1 returning user_id', [userId]);
    return rows.length > 0;
}
