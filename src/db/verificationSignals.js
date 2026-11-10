// i18n-ignore-file: SQL for the signals of the verification, no text anybody reads
// What the alt check compares: for each member who verified, a keyed hash of the connection and of the email (never the IP or the email themselves,
// utils/verifyChecks.js `signalHash`), one row for each member of a server. Rows older than 90 days are deleted (jobs/verifyChecksJob.js).
const { getPrimaryPool } = require('./postgres');

const KEEP_DAYS = 90;

/** Writes (or renews) the signals of a member in a server. A signal that is null keeps what was there. */
async function record({ guildId, userId, ipHash = null, emailHash = null }) {
  if (!ipHash && !emailHash) return;
  await getPrimaryPool().query(
    `insert into verification_signals (guild_id, user_id, ip_hash, email_hash) values ($1, $2, $3, $4)
     on conflict (guild_id, user_id) do update set ip_hash = coalesce(excluded.ip_hash, verification_signals.ip_hash), email_hash = coalesce(excluded.email_hash, verification_signals.email_hash), seen_at = now()`,
    [String(guildId), String(userId), ipHash, emailHash],
  );
}

/** The other members of the server with the same connection or email: `[{ user_id, by: 'ip' | 'email' }]`. */
async function findMatches(guildId, userId, { ipHash = null, emailHash = null } = {}) {
  if (!ipHash && !emailHash) return [];
  const { rows } = await getPrimaryPool().query(
    `select user_id, (email_hash is not null and email_hash = $4) as by_email
       from verification_signals
      where guild_id = $1 and user_id <> $2 and ((ip_hash is not null and ip_hash = $3) or (email_hash is not null and email_hash = $4))
      order by seen_at desc limit 10`,
    [String(guildId), String(userId), ipHash, emailHash],
  );
  return rows.map((row) => ({ user_id: row.user_id, by: row.by_email ? 'email' : 'ip' }));
}

/** Deletes the signals that are older than `days`. Returns how many. */
async function purgeOlderThan(days = KEEP_DAYS) {
  const { rowCount } = await getPrimaryPool().query('delete from verification_signals where seen_at < now() - make_interval(days => $1)', [days]);
  return rowCount;
}

module.exports = { record, findMatches, purgeOlderThan, KEEP_DAYS };
