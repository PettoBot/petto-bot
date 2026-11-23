// i18n-ignore-file: database layer, nothing here is shown to anyone.
// What a person keeps for their profile (tables `user_badges` and `user_profile`): the badges they have turned on or been given, and the
// ones they put in the showcase of the image of `/profile`. It belongs to the person and has no server.
// Written in TypeScript: `npm run build:ts` compiles it over db/userProfile.js.
interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };

/** The ids of the badges saved for a person (the badge of a plan is not saved: it follows the plan). */
export async function getSavedBadges(userId: string): Promise<string[]> {
  const { rows } = await getPrimaryPool().query('select badge_id from user_badges where user_id = $1 order by granted_at', [userId]);
  return rows.map((row) => String(row.badge_id));
}

/** Saves a badge for a person. Returns whether it was new. */
export async function addBadge(userId: string, badgeId: string, source: 'self' | 'team'): Promise<boolean> {
  const { rows } = await getPrimaryPool().query(
    'insert into user_badges (user_id, badge_id, source) values ($1, $2, $3) on conflict (user_id, badge_id) do nothing returning badge_id',
    [userId, badgeId, source]);
  return rows.length > 0;
}

/** Takes a badge away (and out of the showcase). Returns whether they had it. */
export async function removeBadge(userId: string, badgeId: string): Promise<boolean> {
  const pool = getPrimaryPool();
  const { rows } = await pool.query('delete from user_badges where user_id = $1 and badge_id = $2 returning badge_id', [userId, badgeId]);
  await pool.query('update user_profile set showcase = array_remove(showcase, $2), updated_at = now() where user_id = $1', [userId, badgeId]);
  return rows.length > 0;
}

export async function getShowcase(userId: string): Promise<string[]> {
  const { rows } = await getPrimaryPool().query('select showcase from user_profile where user_id = $1', [userId]);
  const list = rows[0]?.showcase;
  return Array.isArray(list) ? list.map(String) : [];
}

export async function setShowcase(userId: string, showcase: string[]): Promise<string[]> {
  const { rows } = await getPrimaryPool().query(
    `insert into user_profile (user_id, showcase) values ($1, $2::text[])
     on conflict (user_id) do update set showcase = excluded.showcase, updated_at = now()
     returning showcase`,
    [userId, showcase]);
  return Array.isArray(rows[0]?.showcase) ? (rows[0]?.showcase as unknown[]).map(String) : showcase;
}

/** Forgets everything saved for a person (what they ask for when they want their profile data deleted). */
export async function deleteProfile(userId: string): Promise<void> {
  const pool = getPrimaryPool();
  await pool.query('delete from user_badges where user_id = $1', [userId]);
  await pool.query('delete from user_profile where user_id = $1', [userId]);
}
