// i18n-ignore-file: database layer; nothing here reaches a member.
// How many questions each member asked the AI (`ask`) on each UTC day. Table ask_usage (schema.sql): a number and nothing else, never the
// question or the answer.
//
// The count is atomic: ONE statement adds 1 only while `used` is under the limit (`where ask_usage.used < $3`), so two questions that arrive at
// the same time cannot both pass the last one. A question that could not be answered gives its use back (`refund`). If the database cannot be
// reached the functions throw: the caller refuses the question (it never gives free answers without counting).
const { getPrimaryPool } = require('./postgres');

/** The statements, exported so the checks can assert what they say. */
const SQL = Object.freeze({
  // The first question of the day inserts the row with 1; the next ones add 1 only while the count is under the limit. No row comes back when the limit is reached.
  consume: `insert into ask_usage (user_id, day, used) values ($1, $2::date, 1)
on conflict (user_id, day) do update set used = ask_usage.used + 1 where ask_usage.used < $3::int
returning used`,
  refund: 'update ask_usage set used = ask_usage.used - 1 where user_id = $1 and day = $2::date and used > 0 returning used',
  used: 'select used from ask_usage where user_id = $1 and day = $2::date',
  purge: "delete from ask_usage where day < ($1::date - interval '7 days')",
});

const PURGE_EVERY_MS = 60 * 60 * 1000;

/**
 * The store over a `query(sql, params)` function (the pool of the bot, or a fake in the checks).
 * - consume(userId, day, limit): `{ ok: true, used }` or `{ ok: false, used: limit }`; day is `YYYY-MM-DD` (UTC).
 * - refund(userId, day): gives one use back (never below 0).
 * - usedOn(userId, day): the questions of that day.
 */
function createStore(query) {
  let purgedAt = 0;
  return {
    async consume(userId, day, limit) {
      const max = Math.floor(Number(limit));
      if (!(max >= 1)) return { ok: false, used: 0 };
      const { rows } = await query(SQL.consume, [String(userId), day, max]);
      const used = Number(rows?.[0]?.used);
      if (rows?.length && Number.isFinite(used)) {
        purgeLater(day);
        return { ok: true, used };
      }
      return { ok: false, used: max };
    },
    async refund(userId, day) {
      await query(SQL.refund, [String(userId), day]);
    },
    async usedOn(userId, day) {
      const { rows } = await query(SQL.used, [String(userId), day]);
      return Number(rows?.[0]?.used ?? 0) || 0;
    },
  };
  /** Old rows are deleted now and then, by whoever asks next (no job): at most once an hour in this process, and its failure is nobody's problem. */
  function purgeLater(day) {
    const now = Date.now();
    if (now - purgedAt < PURGE_EVERY_MS) return;
    purgedAt = now;
    Promise.resolve(query(SQL.purge, [day])).catch(() => {});
  }
}

const store = createStore((sql, params) => getPrimaryPool().query(sql, params));

module.exports = { SQL, createStore, consume: store.consume, refund: store.refund, usedOn: store.usedOn };
