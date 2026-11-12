// i18n-ignore-file: database layer, nothing here is shown to anyone.
// The activity leaderboards a server asked for (table `activity_leaderboards`): one row for each server and kind (chat or voice) with the channel, the periods the server chose
// and their messages (daily, weekly, monthly) that Petto edits every few minutes, and the top of the members read from `activity_members` (counts only, never what was said).
// Written in TypeScript: `npm run build:ts` compiles it over src/db/activityLeaderboards.js, which is what the bot loads.

export type Kind = 'chat' | 'voice';
export const KINDS: readonly Kind[] = ['chat', 'voice'];

export type Period = 'daily' | 'weekly' | 'monthly';
/** The order the cards are posted in, and so the order they read in: the longest first. */
export const PERIODS: readonly Period[] = ['monthly', 'weekly', 'daily'];

/** The periods in the order of `PERIODS`, once each, and only the ones that exist; what is not a period is dropped. A list with none of them is every period. */
export function cleanPeriods(value: unknown): Period[] {
  const wanted = new Set(Array.isArray(value) ? value.map(String) : []);
  const chosen = PERIODS.filter((period) => wanted.has(period));
  return chosen.length ? [...chosen] : [...PERIODS];
}

/** A row of `activity_leaderboards`. */
export interface BoardRow {
  guild_id: string;
  kind: Kind;
  channel_id: string;
  daily_message_id: string | null;
  weekly_message_id: string | null;
  monthly_message_id: string | null;
  periods: Period[];
  last_refreshed_at: string | Date | null;
  last_error: string | null;
  created_at: string | Date;
}

/** One member of a top: the number is messages (chat) or seconds of voice (voice). */
export interface TopRow { user_id: string; amount: number }

interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }

// The project is JavaScript: its modules are read with `require` and given the shape that is used here.
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };
const { ensureGuild } = require('./guilds') as { ensureGuild: (guildId: string) => Promise<unknown> };

/**
 * A board that has not been refreshed for this long is due. The job looks every minute, so a board is written about every 5 minutes (a little less than that
 * after the last time, so the look that follows is the one that finds it due).
 */
export const REFRESH_SECONDS = 270;

const pool = (): Pool => getPrimaryPool();
const asRow = (row: Record<string, unknown> | undefined): BoardRow | null => (row ? (row as unknown as BoardRow) : null);

/** What the database holds is never trusted to be well formed: the periods of a row are always the clean list. */
const withPeriods = (row: BoardRow): BoardRow => ({ ...row, periods: cleanPeriods(row.periods) });

export async function listBoards(guildId: string): Promise<BoardRow[]> {
  const { rows } = await pool().query('select * from activity_leaderboards where guild_id = $1 order by kind', [guildId]);
  return (rows as unknown as BoardRow[]).map(withPeriods);
}

export async function getBoard(guildId: string, kind: Kind): Promise<BoardRow | null> {
  const { rows } = await pool().query('select * from activity_leaderboards where guild_id = $1 and kind = $2', [guildId, kind]);
  const row = asRow(rows[0]);
  return row ? withPeriods(row) : null;
}

/**
 * Chooses the channel of a board. The messages are kept when it is the same channel (Petto goes on editing them) and forgotten when it changes (they are in the
 * old one); either way the board is due now, so it is written at the next look or at once by the command. `periods` chooses the cards; left out, a new board has all of
 * them and an old one keeps the ones it had.
 */
export async function upsertBoard(guildId: string, kind: Kind, channelId: string, periods?: readonly Period[]): Promise<BoardRow> {
  await ensureGuild(guildId);
  const chosen = periods ? cleanPeriods(periods) : null;
  const { rows } = await pool().query(
    `insert into activity_leaderboards (guild_id, kind, channel_id, periods) values ($1, $2, $3, coalesce($4::text[], '{monthly,weekly,daily}'::text[]))
     on conflict (guild_id, kind) do update set
       channel_id = excluded.channel_id,
       periods = coalesce($4::text[], activity_leaderboards.periods),
       daily_message_id = case when activity_leaderboards.channel_id = excluded.channel_id then activity_leaderboards.daily_message_id end,
       weekly_message_id = case when activity_leaderboards.channel_id = excluded.channel_id then activity_leaderboards.weekly_message_id end,
       monthly_message_id = case when activity_leaderboards.channel_id = excluded.channel_id then activity_leaderboards.monthly_message_id end,
       last_refreshed_at = null, last_error = null
     returning *`,
    [guildId, kind, channelId, chosen],
  );
  return withPeriods(rows[0] as unknown as BoardRow);
}

/** Takes a board away and answers the row it had (to delete its messages), or null when there was none. */
export async function removeBoard(guildId: string, kind: Kind): Promise<BoardRow | null> {
  const { rows } = await pool().query('delete from activity_leaderboards where guild_id = $1 and kind = $2 returning *', [guildId, kind]);
  return asRow(rows[0]);
}

/** Remembers the three messages of a board (null forgets one). */
export async function saveMessages(guildId: string, kind: Kind, ids: { daily: string | null; weekly: string | null; monthly: string | null }): Promise<void> {
  await pool().query(
    'update activity_leaderboards set daily_message_id = $3, weekly_message_id = $4, monthly_message_id = $5 where guild_id = $1 and kind = $2',
    [guildId, kind, ids.daily, ids.weekly, ids.monthly],
  );
}

export async function markRefreshed(guildId: string, kind: Kind): Promise<void> {
  await pool().query('update activity_leaderboards set last_refreshed_at = now(), last_error = null where guild_id = $1 and kind = $2', [guildId, kind]);
}

/** Saves why a board could not be written (a short code) and counts it as looked at, so it is tried again at the next round (in about 5 minutes) and not at every look. */
export async function markError(guildId: string, kind: Kind, code: string): Promise<void> {
  await pool().query('update activity_leaderboards set last_error = $3, last_refreshed_at = now() where guild_id = $1 and kind = $2', [guildId, kind, code]);
}

/** The boards that were never written or were last written `REFRESH_SECONDS` ago, the oldest first. */
export async function listDue(limit = 20): Promise<BoardRow[]> {
  const { rows } = await pool().query(
    `select * from activity_leaderboards
      where last_refreshed_at is null or last_refreshed_at <= now() - make_interval(secs => $2)
      order by last_refreshed_at asc nulls first limit $1`,
    [Math.max(1, Math.min(200, limit)), REFRESH_SECONDS],
  );
  return (rows as unknown as BoardRow[]).map(withPeriods);
}

/**
 * The most active members from `sinceDay` (`YYYY-MM-DD`, in the day of Petto) until now: messages for `chat`, seconds in voice for `voice`.
 * Members with nothing in the period are not listed.
 */
export async function readTop(guildId: string, kind: Kind, sinceDay: string, limit = 30): Promise<TopRow[]> {
  const column = kind === 'voice' ? 'voice_seconds' : 'messages'; // chosen here, never from the outside
  const { rows } = await pool().query(
    `select user_id, sum(${column})::bigint as amount from activity_members
      where guild_id = $1 and day >= $2 group by user_id having sum(${column}) > 0
      order by sum(${column}) desc, user_id limit $3`,
    [guildId, sinceDay, Math.max(1, Math.min(100, limit))],
  );
  return rows.map((row) => ({ user_id: String(row.user_id), amount: Number(row.amount) }));
}

/**
 * The most active members of the days from `fromDay` up to (not including) `toDay` (`YYYY-MM-DD`, in the day of Petto): a period that has ended, such as last week.
 * Same counts as `readTop`; members with nothing in the period are not listed.
 */
export async function readTopBetween(guildId: string, kind: Kind, fromDay: string, toDay: string, limit = 30): Promise<TopRow[]> {
  const column = kind === 'voice' ? 'voice_seconds' : 'messages'; // chosen here, never from the outside
  const { rows } = await pool().query(
    `select user_id, sum(${column})::bigint as amount from activity_members
      where guild_id = $1 and day >= $2 and day < $3 group by user_id having sum(${column}) > 0
      order by sum(${column}) desc, user_id limit $4`,
    [guildId, fromDay, toDay, Math.max(1, Math.min(100, limit))],
  );
  return rows.map((row) => ({ user_id: String(row.user_id), amount: Number(row.amount) }));
}
