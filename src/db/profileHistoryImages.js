// i18n-ignore-file: SQL only, no text anybody reads
// The copies of the avatars of the profile history (profile_history_images): the picture is kept when Petto records an avatar, because
// Discord stops serving an old one soon after it is changed. A copy only exists while its entry of the history does and the person has
// not turned the history off. The copies can live in the second database (db/secondary.js) while the history is in the main one, so what the
// triggers of schema.sql used to do (delete a copy with its entry or with the opt-out) is done here: `clearUser` when the history is cleared or turned off,
// `trim` when a person has more avatars than are kept, and `reconcile` (an hourly pass) for whatever else removed an entry.

const KEEP_PER_USER = 100; // copies of the newest 100 avatars of a person
const MAX_BYTES = 256 * 1024; // one copy (a 256 px WebP is usually 10 to 40 KB)
const MAX_ATTEMPTS = 3; // failed tries (not a "Discord no longer has it") before a copy is given up
const HASH = /^(a_)?[0-9a-f]{32}$/;

// Required when first used, so the modules that only pass this one along (and their checks) do not need the database settings.
const primary = () => require('./postgres').getPrimaryPool(); // the history (identity_history) is always in the main database
const copies = () => require('./secondary').pool; // the copies: the second database, or the main one when there is none

// While the copies that the main database already had are moved to the second one, a copy that is not there yet is looked for in the main one.
let movePending = false;
const setMovePending = (value) => { movePending = Boolean(value); };

/** The person still has this avatar in their history and has not turned it off. */
async function allowed(userId, hash) {
  const { rows } = await primary().query(
    `select exists (select 1 from identity_history where user_id = $1 and kind = 'avatar' and value = $2)
        and not exists (select 1 from identity_history_optout where user_id = $1) as ok`, [String(userId), String(hash)]);
  return rows[0]?.ok === true;
}

/** Saves the copy of an avatar. Returns false when it is not wanted any more (the entry was deleted or the history turned off). */
async function store(userId, hash, { contentType, bytes }) {
  if (!HASH.test(hash) || !bytes?.length || bytes.length > MAX_BYTES) return false;
  if (!await allowed(userId, hash)) return false;
  await copies().query(
    `insert into profile_history_images (user_id, hash, content_type, size, bytes, missing, attempts, packed, updated_at)
     values ($1, $2, $3, $4, $5, false, 0, true, now())
     on conflict (user_id, hash) do update set content_type = excluded.content_type, size = excluded.size, bytes = excluded.bytes, missing = false, packed = true, updated_at = now()`,
    [String(userId), hash, contentType, bytes.length, bytes],
  );
  await trim(userId);
  return true;
}

/** A try that gave no copy: `missing` when Discord said it no longer has the picture (never asked again), else one more failed attempt. */
async function markFailed(userId, hash, { missing = false } = {}) {
  if (!HASH.test(hash)) return;
  if (!await allowed(userId, hash)) return;
  await copies().query(
    `insert into profile_history_images (user_id, hash, missing, attempts, updated_at)
     values ($1, $2, $3, 1, now())
     on conflict (user_id, hash) do update set missing = profile_history_images.missing or excluded.missing, attempts = profile_history_images.attempts + 1, updated_at = now()
     where profile_history_images.bytes is null`,
    [String(userId), hash, missing],
  );
}

/** Copies (and marks) beyond the newest KEEP_PER_USER avatars of the person's history go. */
async function trim(userId) {
  const { rows } = await primary().query(
    `select value from identity_history where user_id = $1 and kind = 'avatar' group by value order by max(seen_at) desc limit ${KEEP_PER_USER}`, [String(userId)]);
  await copies().query('delete from profile_history_images where user_id = $1 and not (hash = any($2::text[]))', [String(userId), rows.map((row) => row.value)]);
}

/** What is known of one avatar, without the bytes: null when nothing was tried yet. */
async function status(userId, hash) {
  const sql = 'select size, missing, attempts from profile_history_images where user_id = $1 and hash = $2';
  const found = (await copies().query(sql, [String(userId), String(hash)])).rows[0];
  if (found || !movePending) return found ?? null;
  return (await primary().query(sql, [String(userId), String(hash)])).rows[0] ?? null;
}

/** The copy of one avatar ({ content_type, size, bytes, updated_at }), or null. */
async function get(userId, hash) {
  if (!HASH.test(String(hash))) return null;
  const sql = 'select content_type, size, bytes, updated_at from profile_history_images where user_id = $1 and hash = $2 and size > 0';
  const found = (await copies().query(sql, [String(userId), String(hash)])).rows[0];
  if (found || !movePending) return found ?? null;
  return (await primary().query(sql, [String(userId), String(hash)])).rows[0] ?? null;
}

/** The copies of several avatars of a person, as a Map hash -> bytes. */
async function getMany(userId, hashes) {
  const list = [...new Set(hashes)].filter((hash) => HASH.test(String(hash)));
  if (!list.length) return new Map();
  const sql = 'select hash, bytes from profile_history_images where user_id = $1 and hash = any($2::text[]) and size > 0';
  const out = new Map((await copies().query(sql, [String(userId), list])).rows.map((row) => [row.hash, row.bytes]));
  if (movePending && out.size < list.length) for (const row of (await primary().query(sql, [String(userId), list.filter((hash) => !out.has(hash))])).rows) out.set(row.hash, row.bytes);
  return out;
}

/** True when the avatar is in the person's history (a copy is only ever made of one that is). */
async function recorded(userId, hash) {
  const { rows } = await primary().query(`select 1 from identity_history where user_id = $1 and kind = 'avatar' and value = $2 limit 1`, [String(userId), String(hash)]);
  return rows.length > 0;
}

async function clearUser(userId) {
  const { rowCount } = await copies().query('delete from profile_history_images where user_id = $1', [String(userId)]);
  if (movePending) await primary().query('delete from profile_history_images where user_id = $1', [String(userId)]).catch(() => {}); // the ones not moved yet
  return rowCount;
}

/** All the bytes kept, for the total limit. */
async function totalSize() {
  const { rows } = await copies().query('select coalesce(sum(size), 0)::bigint as total from profile_history_images');
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
  const { rows } = await primary().query(
    `with piece as (
       select id, user_id, value from identity_history where kind = 'avatar' and ($1::bigint is null or id < $1::bigint) order by id desc limit $2)
     select (select min(id) from piece)::text as cursor, coalesce((
       select json_agg(json_build_object('user_id', c.user_id, 'hash', c.value) order by c.id desc) from piece c
       where not exists (select 1 from identity_history_optout o where o.user_id = c.user_id)
         -- the same newest KEEP_PER_USER as trim(), or the copy would be deleted as soon as it is stored and tried again on every pass
         and c.value in (select value from identity_history where user_id = c.user_id and kind = 'avatar' group by value order by max(seen_at) desc limit ${KEEP_PER_USER})), '[]'::json) as rows`,
    [beforeId == null ? null : String(beforeId), Math.max(1, Math.min(500, Number(chunk) || 50))],
  );
  const wanted = rows[0]?.rows ?? [];
  const cursor = rows[0]?.cursor ?? null;
  if (!wanted.length) return { rows: [], cursor };
  // Which of them already have a copy (or a mark that Discord no longer has it, or too many failed tries) is asked of the place that keeps the copies.
  const sql = 'select user_id, hash, size, missing, attempts from profile_history_images where (user_id, hash) in (select * from unnest($1::text[], $2::text[]))';
  const args = [wanted.map((row) => row.user_id), wanted.map((row) => row.hash)];
  const known = new Map();
  for (const row of (await copies().query(sql, args)).rows) known.set(`${row.user_id}:${row.hash}`, row);
  if (movePending) for (const row of (await primary().query(sql, args)).rows) if (!known.has(`${row.user_id}:${row.hash}`)) known.set(`${row.user_id}:${row.hash}`, row);
  return { rows: wanted.filter((row) => { const have = known.get(`${row.user_id}:${row.hash}`); return !have || (have.size === 0 && !have.missing && have.attempts < MAX_ATTEMPTS); }), cursor };
}

/** The next copies made when the quality was higher (not packed yet), with their bytes. */
async function unpacked(limit = 40) {
  const { rows } = await copies().query('select user_id, hash, size, bytes from profile_history_images where not packed and bytes is not null order by updated_at limit $1', [limit]);
  return rows;
}

/** Writes the smaller copy (`bytes` null keeps the old one) and marks it as packed, whatever happened, so it is not tried again. Keeps updated_at. */
async function markPacked(userId, hash, bytes = null) {
  if (bytes) await copies().query('update profile_history_images set bytes = $3, size = $4, packed = true where user_id = $1 and hash = $2', [String(userId), String(hash), bytes, bytes.length]);
  else await copies().query('update profile_history_images set packed = true where user_id = $1 and hash = $2', [String(userId), String(hash)]);
}

/**
 * Deletes the copies whose entry is not in the history any more (or whose person turned the history off), a page of `batch` copies at a time after
 * `after` ({ user_id, hash } or null). Returns { looked, removed, after } with `after` null when the whole table was read. This is what the triggers
 * of the main database did when the copies were in it.
 */
async function reconcile({ after = null, batch = 500 } = {}) {
  const page = (await copies().query(
    `select user_id, hash from profile_history_images where ($1::text is null or (user_id, hash) > ($1::text, $2::text)) order by user_id, hash limit $3`,
    [after?.user_id ?? null, after?.hash ?? null, batch])).rows;
  if (!page.length) return { looked: 0, removed: 0, after: null };
  const alive = new Set((await primary().query(
    `select h.user_id, h.value as hash from identity_history h
      where h.kind = 'avatar' and (h.user_id, h.value) in (select * from unnest($1::text[], $2::text[]))
        and not exists (select 1 from identity_history_optout o where o.user_id = h.user_id) group by 1, 2`,
    [page.map((row) => row.user_id), page.map((row) => row.hash)])).rows.map((row) => `${row.user_id}:${row.hash}`));
  const gone = page.filter((row) => !alive.has(`${row.user_id}:${row.hash}`));
  if (gone.length) await copies().query('delete from profile_history_images where (user_id, hash) in (select * from unnest($1::text[], $2::text[]))', [gone.map((row) => row.user_id), gone.map((row) => row.hash)]);
  return { looked: page.length, removed: gone.length, after: page.length < batch ? null : page.at(-1) };
}

module.exports = { setMovePending, reconcile, unpacked, markPacked, KEEP_PER_USER, MAX_BYTES, MAX_ATTEMPTS, HASH, store, markFailed, trim, status, recorded, get, getMany, clearUser, totalSize, backfillCandidates };
