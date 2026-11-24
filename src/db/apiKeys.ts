// i18n-ignore-file: database layer, nothing here is shown to anyone.
// The keys of the read-only API (table `api_keys`). Only the hash of a key is kept.
// Written in TypeScript: `npm run build:ts` compiles it over db/apiKeys.js.
interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };

export const MAX_KEYS = 3;
export interface KeyRow { id: number; label: string; createdAt: string; lastUsed: string | null }

export async function listKeys(userId: string): Promise<KeyRow[]> {
  const { rows } = await getPrimaryPool().query(`select id, label, created_at, last_used from api_keys where user_id = $1 order by id`, [userId]);
  return rows.map((row) => ({ id: Number(row.id), label: String(row.label ?? ''), createdAt: new Date(row.created_at as string).toISOString(), lastUsed: row.last_used ? new Date(row.last_used as string).toISOString() : null }));
}

/** Saves a key (its hash) unless the person already has the most keys. Returns the id, or null when there is no room. One statement, so two at once cannot pass the limit. */
export async function addKey(userId: string, hash: string, label: string): Promise<number | null> {
  const { rows } = await getPrimaryPool().query(
    `insert into api_keys (user_id, key_hash, label) select $1, $2, $3 where (select count(*) from api_keys where user_id = $1) < $4 returning id`, [userId, hash, label, MAX_KEYS]);
  return rows[0] ? Number(rows[0].id) : null;
}

export async function removeKey(userId: string, id: number): Promise<boolean> {
  const { rows } = await getPrimaryPool().query(`delete from api_keys where user_id = $1 and id = $2 returning id`, [userId, id]);
  return rows.length > 0;
}

/** The person a key belongs to (and the key is marked as used), or null. */
export async function userOfKey(hash: string): Promise<string | null> {
  const { rows } = await getPrimaryPool().query(`update api_keys set last_used = now() where key_hash = $1 returning user_id`, [hash]);
  return rows[0] ? String(rows[0].user_id) : null;
}
