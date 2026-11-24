// i18n-ignore-file: database layer, nothing here is shown to anyone.
// Own badges (table `user_own_badges`): the badge a person made, waiting for the team; and the badges that were approved (they live in `custom_badges` with the id `own-<person>-<slot>`).
// Written in TypeScript: `npm run build:ts` compiles it over db/userOwnBadges.js.
interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };

const iso = (value: unknown): string | null => (value ? new Date(value as string).toISOString() : null);
export const ownId = (userId: string, slot: number): string => `own-${userId}-${slot}`;

export interface PendingOwn { userId: string; slot: number; name: string; screened: boolean; submittedAt: string }
export interface ApprovedOwn { slot: number; name: string; id: string }

export async function setPending(userId: string, slot: number, name: string, image: Buffer, screened: boolean): Promise<void> {
  await getPrimaryPool().query(
    `insert into user_own_badges (user_id, slot, name, image, screened, submitted_at) values ($1, $2, $3, $4, $5, now())
     on conflict (user_id, slot) do update set name = $3, image = $4, screened = $5, submitted_at = now()`, [userId, slot, name, image, screened]);
}
export async function pendingOf(userId: string): Promise<PendingOwn[]> {
  const { rows } = await getPrimaryPool().query(`select user_id, slot, name, screened, submitted_at from user_own_badges where user_id = $1 order by slot`, [userId]);
  return rows.map((row) => ({ userId: String(row.user_id), slot: Number(row.slot), name: String(row.name), screened: Boolean(row.screened), submittedAt: iso(row.submitted_at) as string }));
}
export async function listPending(limit = 30): Promise<PendingOwn[]> {
  const { rows } = await getPrimaryPool().query(`select user_id, slot, name, screened, submitted_at from user_own_badges order by submitted_at limit $1`, [limit]);
  return rows.map((row) => ({ userId: String(row.user_id), slot: Number(row.slot), name: String(row.name), screened: Boolean(row.screened), submittedAt: iso(row.submitted_at) as string }));
}
export async function pendingImage(userId: string, slot: number): Promise<Buffer | null> {
  const { rows } = await getPrimaryPool().query(`select image from user_own_badges where user_id = $1 and slot = $2`, [userId, slot]);
  return (rows[0]?.image as Buffer | undefined) ?? null;
}
/** Takes the waiting badge out (it was approved or rejected) and gives it back, or null when there was none. */
export async function take(userId: string, slot: number): Promise<{ name: string; image: Buffer } | null> {
  const { rows } = await getPrimaryPool().query(`delete from user_own_badges where user_id = $1 and slot = $2 returning name, image`, [userId, slot]);
  return rows[0] ? { name: String(rows[0].name), image: rows[0].image as Buffer } : null;
}
export async function removePending(userId: string, slot: number): Promise<boolean> {
  const { rows } = await getPrimaryPool().query(`delete from user_own_badges where user_id = $1 and slot = $2 returning slot`, [userId, slot]);
  return rows.length > 0;
}

/** The approved badges of a person: the ones of the editor with their id. */
export async function approvedOf(userId: string): Promise<ApprovedOwn[]> {
  const { rows } = await getPrimaryPool().query(`select id, names from custom_badges where id like $1 order by id`, [`own-${userId}-%`]);
  return rows.map((row) => ({ id: String(row.id), slot: Number(String(row.id).split('-').pop()), name: String((row.names as Record<string, string>).en ?? '') }));
}
/** Makes (or replaces) the approved badge of a slot: off sale, with its picture, and the person gets it. */
export async function approve(userId: string, slot: number, name: string, image: Buffer): Promise<void> {
  const pool = getPrimaryPool();
  const id = ownId(userId, slot);
  await pool.query(
    `insert into custom_badges (id, names, category, rarity, price, color, image, image_type, active, created_by) values ($1, $2::jsonb, 'special', 'common', 0, '#8f7bd6', $3, 'image/png', false, $4)
     on conflict (id) do update set names = $2::jsonb, image = $3, image_type = 'image/png', active = false, updated_at = now()`, [id, JSON.stringify({ en: name }), image, userId]);
  await pool.query(`insert into user_badges (user_id, badge_id, source) values ($1, $2, 'team') on conflict (user_id, badge_id) do nothing`, [userId, id]);
}
/** Takes an approved badge away (the person removes it, or the team takes it down). */
export async function removeApproved(userId: string, slot: number): Promise<boolean> {
  const pool = getPrimaryPool();
  const id = ownId(userId, slot);
  await pool.query(`delete from user_badges where badge_id = $1`, [id]);
  await pool.query(`update user_profile set showcase = array_remove(showcase, $1) where user_id = $2`, [id, userId]);
  const { rows } = await pool.query(`delete from custom_badges where id = $1 returning id`, [id]);
  return rows.length > 0;
}
