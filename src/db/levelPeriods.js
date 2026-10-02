// XP earned in the current week or month, for the weekly and monthly rankings. A period is a key such as `2026-W40` or
// `2026-10`, so when the week or the month changes the board starts empty without anything having to be reset.
const { getPrimaryPool } = require('./postgres');
const { periodKeys } = require('../utils/levelRules');

const KINDS = new Set(['week', 'month']);
const KEEP_WEEKS = 10;
const KEEP_MONTHS = 14;

async function addPeriodXp(guildId, userId, { textXp = 0, voiceXp = 0 }, at = new Date()) {
  if (!textXp && !voiceXp) return;
  const keys = periodKeys(at);
  await getPrimaryPool().query('select add_period_xp($1, $2, $3, $4, $5, $6)', [String(guildId), String(userId), keys.week, keys.month, Math.max(0, textXp), Math.max(0, voiceXp)]);
}

const column = (source) => (source === 'voice' ? 'voice_xp' : 'text_xp');

/** One page of a ranking, best first. */
async function boardPage(guildId, kind, source, { offset, limit }, at = new Date()) {
  if (!KINDS.has(kind)) return [];
  const key = periodKeys(at)[kind];
  const { rows } = await getPrimaryPool().query(
    `select user_id, ${column(source)} as xp from level_period_xp where guild_id = $1 and kind = $2 and period_key = $3 and ${column(source)} > 0
     order by ${column(source)} desc, user_id limit $4 offset $5`,
    [String(guildId), kind, key, limit, offset],
  );
  return rows.map((row) => ({ user_id: row.user_id, xp: Number(row.xp) }));
}

async function boardCount(guildId, kind, source, at = new Date()) {
  if (!KINDS.has(kind)) return 0;
  const key = periodKeys(at)[kind];
  const { rows } = await getPrimaryPool().query(
    `select count(*)::int as total from level_period_xp where guild_id = $1 and kind = $2 and period_key = $3 and ${column(source)} > 0`,
    [String(guildId), kind, key],
  );
  return rows[0]?.total ?? 0;
}

/** The XP of one member in the period and their position, or null when they have none yet. */
async function memberStanding(guildId, userId, kind, source, at = new Date()) {
  if (!KINDS.has(kind)) return null;
  const key = periodKeys(at)[kind];
  const { rows } = await getPrimaryPool().query(
    `select ${column(source)} as xp, (select count(*)::int + 1 from level_period_xp o where o.guild_id = $1 and o.kind = $3 and o.period_key = $4 and o.${column(source)} > p.${column(source)}) as position
     from level_period_xp p where guild_id = $1 and user_id = $2 and kind = $3 and period_key = $4`,
    [String(guildId), String(userId), kind, key],
  );
  const row = rows[0];
  return row && Number(row.xp) > 0 ? { xp: Number(row.xp), position: row.position } : null;
}

/** Deletes the rows of periods that are over, keeping a few for a look back. */
async function pruneOldPeriods(at = new Date()) {
  const weekCut = periodKeys(new Date(at.getTime() - KEEP_WEEKS * 7 * 86_400_000)).week;
  const monthCut = periodKeys(new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - KEEP_MONTHS, 1))).month;
  const { rowCount } = await getPrimaryPool().query(
    "delete from level_period_xp where (kind = 'week' and period_key < $1) or (kind = 'month' and period_key < $2)",
    [weekCut, monthCut],
  );
  return rowCount;
}

module.exports = { addPeriodXp, boardPage, boardCount, memberStanding, pruneOldPeriods };
