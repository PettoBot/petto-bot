// i18n-ignore-file: database layer, nothing here is shown to anyone.
// The personal birthday of a person (table `user_birthdays`): saved with `/birthday set` where Petto is not a member (a person's own installation). It has no server and only its owner reads it.
// Written in TypeScript: `npm run build:ts` compiles it over db/userBirthdays.js.
interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };

export interface PersonalBirthday { month: number; day: number; year: number | null }

const rowTo = (row: Record<string, unknown>): PersonalBirthday => ({ month: Number(row.month), day: Number(row.day), year: row.year === null || row.year === undefined ? null : Number(row.year) });

export async function getPersonalBirthday(userId: string): Promise<PersonalBirthday | null> {
  const { rows } = await getPrimaryPool().query('select month, day, year from user_birthdays where user_id = $1', [userId]);
  return rows[0] ? rowTo(rows[0]) : null;
}

export async function setPersonalBirthday(userId: string, { month, day, year = null }: { month: number; day: number; year?: number | null }): Promise<PersonalBirthday> {
  const { rows } = await getPrimaryPool().query(
    `insert into user_birthdays (user_id, month, day, year) values ($1, $2, $3, $4)
     on conflict (user_id) do update set month = excluded.month, day = excluded.day, year = excluded.year, updated_at = now()
     returning month, day, year`,
    [userId, month, day, year ?? null]);
  return rowTo(rows[0] ?? { month, day, year });
}

/** Forgets it. Returns whether there was one. */
export async function removePersonalBirthday(userId: string): Promise<boolean> {
  const { rows } = await getPrimaryPool().query('delete from user_birthdays where user_id = $1 returning user_id', [userId]);
  return rows.length > 0;
}
