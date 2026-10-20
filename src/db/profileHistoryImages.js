// i18n-ignore-file: SQL only, no text anybody reads
// The copies of the avatars of the profile history (profile_history_images): the picture is kept when Petto records an avatar, because
// Discord stops serving an old one soon after it is changed. A copy only exists while its entry of the history does and the person has
// not turned the history off; the triggers of schema.sql delete it with the entry or the opt-out, whoever makes the change.

const KEEP_PER_USER = 100; // copies of the newest 100 avatars of a person
const MAX_BYTES = 256 * 1024; // one copy (a 256 px WebP is usually 10 to 40 KB)
const MAX_ATTEMPTS = 3; // failed tries (not a "Discord no longer has it") before a copy is given up
const HASH = /^(a_)?[0-9a-f]{32}$/;

// Required when first used, so the modules that only pass this one along (and their checks) do not need the database settings.
const pool = () => require('./postgres').getPrimaryPool();

// The person still has this avatar in their history and has not turned it off.
const ALLOWED = `exists (select 1 from identity_history where user_id = $1 and kind = 'avatar' and value = $2)
  and not exists (select 1 from identity_history_optout where user_id = $1)`;

/** Saves the copy of an avatar. Returns false when it is not wanted any more (the entry was deleted or the history turned off). */
async function store(userId, hash, { contentType, bytes }) {
  if (!HASH.test(hash) || !bytes?.length || bytes.length > MAX_BYTES) return false;
  const { rowCount } = await pool().query(
    `insert into profile_history_images (user_id, hash, content_type, size, bytes, missing, attempts, updated_at)
     select $1, $2, $3, $4, $5, false, 0, now() where ${ALLOWED}
     on conflict (user_id, hash) do update set content_type = excluded.content_type, size = excluded.size, bytes = excluded.bytes, missing = false, updated_at = now()`,
    [String(userId), hash, contentType, bytes.length, bytes],
  );
  if (rowCount) await trim(userId);
  return rowCount > 0;
}

/** A try that gave no copy: `missing` when Discord said it no longer has the picture (never asked again), else one more failed attempt. */
async function markFailed(userId, hash, { missing = false } = {}) {
  if (!HASH.test(hash)) return;
  await pool().query(
    `insert into profile_history_images (user_id, hash, missing, attempts, updated_at)
     select $1, $2, $3, 1, now() where ${ALLOWED}
     on conflict (user_id, hash) do update set missing = profile_history_images.missing or excluded.missing, attempts = profile_history_images.attempts + 1, updated_at = now()
     where profile_history_images.bytes is null`,
    [String(userId), hash, missing],
  );
}

/** Copies (and marks) beyond the newest KEEP_PER_USER avatars of the person's history go. */
async function trim(userId) {
  await pool().query(
    `delete from profile_history_images where user_id = $1 and hash not in (
       select value from identity_history where user_id = $1 and kind = 'avatar' group by value order by max(seen_at) desc limit ${KEEP_PER_USER})`,
    [String(userId)],
  );
}

/** What is known of one avatar, without the bytes: null when nothing was tried yet. */
async function status(userId, hash) {
  const { rows } = await pool().query('select size, missing, attempts from profile_history_images where user_id = $1 and hash = $2', [String(userId), String(hash)]);
  return rows[0] ?? null;
}

/** The copy of one avatar ({ content_type, size, bytes, updated_at }), or null. */
async function get(userId, hash) {
  if (!HASH.test(String(hash))) return null;
  const { rows } = await pool().query('select content_type, size, bytes, updated_at from profile_history_images where user_id = $1 and hash = $2 and size > 0', [String(userId), String(hash)]);
  return rows[0] ?? null;
}

/** The copies of several avatars of a person, as a Map hash -> bytes. */
async function getMany(userId, hashes) {
  const list = [...new Set(hashes)].filter((hash) => HASH.test(String(hash)));
  if (!list.length) return new Map();
  const { rows } = await pool().query('select hash, bytes from profile_history_images where user_id = $1 and hash = any($2::text[]) and size > 0', [String(userId), list]);
  return new Map(rows.map((row) => [row.hash, row.bytes]));
}

/** True when the avatar is in the person's history (a copy is only ever made of one that is). */
async function recorded(userId, hash) {
  const { rows } = await pool().query(`select 1 from identity_history where user_id = $1 and kind = 'avatar' and value = $2 limit 1`, [String(userId), String(hash)]);
  return rows.length > 0;
}

async function clearUser(userId) {
  const { rowCount } = await pool().query('delete from profile_history_images where user_id = $1', [String(userId)]);
  return rowCount;
}

/** All the bytes kept, for the total limit. */
async function totalSize() {
  const { rows } = await pool().query('select coalesce(sum(size), 0)::bigint as total from profile_history_images');
  return Number(rows[0]?.total ?? 0);
}

/**
 * The next piece of the history for the backfill: the avatar entries just older than `beforeId` (newest first, since a recent avatar is
 * the most likely to still be served; null = from the newest), at most `chunk` of them, read along the primary key so a big history
 * costs the same on every step. Returns `{ rows, cursor }`: the avatars of that piece still worth a try (no copy, not marked missing,
 * fewer than MAX_ATTEMPTS failed tries, history not turned off, among the newest KEEP_PER_USER of the person) and where the next piece
 * starts (null when the history is done).
 */
async function backfillCandidates(beforeId = null, chunk = 50) {
  const { rows } = await pool().query(
    `with piece as (
       select id, user_id, value from identity_history where kind = 'avatar' and ($1::bigint is null or id < $1::bigint) order by id desc limit $2)
     select (select min(id) from piece)::text as cursor, coalesce((
       select json_agg(json_build_object('user_id', c.user_id, 'hash', c.value) order by c.id desc) from piece c
       left join profile_history_images p on p.user_id = c.user_id and p.hash = c.value
       where (p.user_id is null or (p.size = 0 and not p.missing and p.attempts < ${MAX_ATTEMPTS}))
         and not exists (select 1 from identity_history_optout o where o.user_id = c.user_id)
         -- the same newest KEEP_PER_USER as trim(), or the copy would be deleted as soon as it is stored and tried again on every pass
         and c.value in (select value from identity_history where user_id = c.user_id and kind = 'avatar' group by value order by max(seen_at) desc limit ${KEEP_PER_USER})), '[]'::json) as rows`,
    [beforeId == null ? null : String(beforeId), Math.max(1, Math.min(500, Number(chunk) || 50))],
  );
  return { rows: rows[0]?.rows ?? [], cursor: rows[0]?.cursor ?? null };
}

module.exports = { KEEP_PER_USER, MAX_BYTES, MAX_ATTEMPTS, HASH, store, markFailed, trim, status, recorded, get, getMany, clearUser, totalSize, backfillCandidates };
