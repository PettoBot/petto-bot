// i18n-ignore-file: database layer; nothing here reaches a member.
// The reports of direct messages (table dm_reports in schema.sql): who reported which message of Petto, from which server, why, and what the Petto team
// did with it. They are for the Petto team only. One report per message: the unique key makes the second one fail, so two clicks at the same time
// cannot send two.
const { getPrimaryPool } = require('./postgres');

/** The statements, exported so the checks can assert what they say. */
const SQL = Object.freeze({
  insert: `insert into dm_reports (reporter_id, reporter_tag, message_id, channel_id, guild_id, guild_name, kind, category, details, message_text, deleted_dm)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
on conflict (message_id) do nothing
returning *`,
  recentCount: "select count(*)::int as total from dm_reports where reporter_id = $1 and created_at > now() - ($2::int * interval '1 second')",
  oldestRecent: "select created_at from dm_reports where reporter_id = $1 and created_at > now() - ($2::int * interval '1 second') order by created_at asc limit 1",
  delivered: 'update dm_reports set delivered_message_id = $2 where id = $1',
  deleted: 'update dm_reports set deleted_dm = true where id = $1',
  handle: "update dm_reports set status = 'handled', handled_by = $2, handled_at = now() where id = $1 and status = 'open' returning *",
  reopen: "update dm_reports set status = 'open', handled_by = null, handled_at = null where id = $1 and status = 'handled' returning *",
  get: 'select * from dm_reports where id = $1',
});

/**
 * The store over a `query(sql, params)` function (the pool of the bot, or a fake in the checks).
 * - add(report): the stored row, or null when that message was already reported.
 * - recent(reporterId, seconds): `{ total, oldest }` the reports of that person in the last seconds (oldest: Date or null).
 */
function createStore(query) {
  return {
    async add(report) {
      const { rows } = await query(SQL.insert, [
        report.reporterId, report.reporterTag ?? null, report.messageId, report.channelId, report.guildId ?? null, report.guildName ?? null,
        report.kind, report.category, report.details, report.messageText ?? null, report.deletedDm === true,
      ]);
      return rows?.[0] ?? null;
    },
    async recent(reporterId, seconds) {
      const window = Math.max(1, Math.floor(Number(seconds)) || 1);
      const { rows } = await query(SQL.recentCount, [String(reporterId), window]);
      const total = Number(rows?.[0]?.total ?? 0) || 0;
      if (!total) return { total: 0, oldest: null };
      const first = await query(SQL.oldestRecent, [String(reporterId), window]);
      const at = first.rows?.[0]?.created_at;
      return { total, oldest: at ? new Date(at) : null };
    },
    async setDelivered(id, messageId) { await query(SQL.delivered, [id, String(messageId)]); },
    async setDeleted(id) { await query(SQL.deleted, [id]); },
    async handle(id, userId) { return (await query(SQL.handle, [id, String(userId)])).rows?.[0] ?? null; },
    async reopen(id) { return (await query(SQL.reopen, [id])).rows?.[0] ?? null; },
    async get(id) { return (await query(SQL.get, [id])).rows?.[0] ?? null; },
  };
}

const store = createStore((sql, params) => getPrimaryPool().query(sql, params));

module.exports = { SQL, createStore, ...store };
