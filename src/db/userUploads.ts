// i18n-ignore-file: database layer, nothing here is shown to anyone.
// Own pictures: the policy a person accepted (`user_policy`), their picture waiting for review and the approved one (`user_uploads`), and who cannot upload (`upload_blocks`).
// Written in TypeScript: `npm run build:ts` compiles it over db/userUploads.js.
interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };

const iso = (value: unknown): string | null => (value ? new Date(value as string).toISOString() : null);
export interface UploadState { hasApproved: boolean; hasPending: boolean; pendingAt: string | null; approvedAt: string | null; lastRejectReason: string | null; lastRejectAt: string | null; removedReason: string | null }

export async function policyVersionOf(userId: string): Promise<number> {
  const { rows } = await getPrimaryPool().query(`select version from user_policy where user_id = $1`, [userId]);
  return Number(rows[0]?.version ?? 0);
}
export async function acceptPolicy(userId: string, version: number): Promise<void> {
  await getPrimaryPool().query(`insert into user_policy (user_id, version) values ($1, $2) on conflict (user_id) do update set version = $2, accepted_at = now()`, [userId, version]);
}

export async function getState(userId: string): Promise<UploadState> {
  const { rows } = await getPrimaryPool().query(
    `select approved is not null as has_approved, pending is not null as has_pending, pending_at, approved_at, last_reject_reason, last_reject_at, removed_reason from user_uploads where user_id = $1`, [userId]);
  const row = rows[0];
  return { hasApproved: Boolean(row?.has_approved), hasPending: Boolean(row?.has_pending), pendingAt: iso(row?.pending_at), approvedAt: iso(row?.approved_at), lastRejectReason: (row?.last_reject_reason as string | null) ?? null, lastRejectAt: iso(row?.last_reject_at), removedReason: (row?.removed_reason as string | null) ?? null };
}

export async function setPending(userId: string, bytes: Buffer): Promise<void> {
  await getPrimaryPool().query(
    `insert into user_uploads (user_id, pending, pending_at) values ($1, $2, now())
     on conflict (user_id) do update set pending = $2, pending_at = now(), last_reject_reason = null, last_reject_at = null, removed_reason = null`, [userId, bytes]);
}
export async function approvedBytes(userId: string): Promise<Buffer | null> {
  const { rows } = await getPrimaryPool().query(`select approved from user_uploads where user_id = $1`, [userId]);
  return (rows[0]?.approved as Buffer | null | undefined) ?? null;
}
export async function pendingBytes(userId: string): Promise<Buffer | null> {
  const { rows } = await getPrimaryPool().query(`select pending from user_uploads where user_id = $1`, [userId]);
  return (rows[0]?.pending as Buffer | null | undefined) ?? null;
}
/** The pending picture becomes the approved one. False when there was none. */
export async function approve(userId: string): Promise<boolean> {
  const { rows } = await getPrimaryPool().query(`update user_uploads set approved = pending, approved_at = now(), pending = null, pending_at = null where user_id = $1 and pending is not null returning user_id`, [userId]);
  return rows.length > 0;
}
export async function reject(userId: string, reason: string): Promise<boolean> {
  const { rows } = await getPrimaryPool().query(`update user_uploads set pending = null, pending_at = null, last_reject_reason = $2, last_reject_at = now() where user_id = $1 and pending is not null returning user_id`, [userId, reason]);
  return rows.length > 0;
}
/** Removes both pictures (a copyright claim, a report, the rules). */
export async function takedown(userId: string, reason: string): Promise<boolean> {
  const { rows } = await getPrimaryPool().query(`update user_uploads set approved = null, approved_at = null, pending = null, pending_at = null, removed_reason = $2 where user_id = $1 returning user_id`, [userId, reason]);
  return rows.length > 0;
}
export async function listPending(limit = 30): Promise<{ userId: string; pendingAt: string }[]> {
  const { rows } = await getPrimaryPool().query(`select user_id, pending_at from user_uploads where pending is not null order by pending_at limit $1`, [Math.max(1, Math.min(100, limit))]);
  return rows.map((row) => ({ userId: String(row.user_id), pendingAt: iso(row.pending_at) as string }));
}

export async function isBlocked(userId: string): Promise<boolean> {
  const { rows } = await getPrimaryPool().query(`select 1 from upload_blocks where user_id = $1`, [userId]);
  return rows.length > 0;
}
export async function block(userId: string, reason: string, byUser: string): Promise<void> {
  await getPrimaryPool().query(`insert into upload_blocks (user_id, reason, by_user) values ($1, $2, $3) on conflict (user_id) do update set reason = $2, by_user = $3`, [userId, reason, byUser]);
}
export async function unblock(userId: string): Promise<boolean> {
  const { rows } = await getPrimaryPool().query(`delete from upload_blocks where user_id = $1 returning user_id`, [userId]);
  return rows.length > 0;
}
export async function listBlocked(limit = 50): Promise<{ userId: string; reason: string; createdAt: string }[]> {
  const { rows } = await getPrimaryPool().query(`select user_id, reason, created_at from upload_blocks order by created_at desc limit $1`, [Math.max(1, Math.min(100, limit))]);
  return rows.map((row) => ({ userId: String(row.user_id), reason: String(row.reason ?? ''), createdAt: iso(row.created_at) as string }));
}
