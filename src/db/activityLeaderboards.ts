// i18n-ignore-file: database layer, nothing here is shown to anyone.
// The activity leaderboards a server asked for (table `activity_leaderboards`): one row for each server and kind (chat or voice) with the channel, the periods the server chose
// and their one message (a card for each period in it) that Petto edits every few minutes, and the top of the members read from `activity_members` (counts only, never what was said).
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

/** The memory of the message of a board: `h` is a short hash of the text it was written with, `at` the moment (milliseconds). The older memory, one for each card, has no `h` and is not used. */
export interface CardState { h?: string; at?: number }

/** A row of `activity_leaderboards`. */
export interface BoardRow {
  guild_id: string;
  kind: Kind;
  channel_id: string;
  /** The one message of the board, with the card of each period in it. */
  message_id: string | null;
  /** The messages of a board written as one message for each period (before this): they are replaced by `message_id` and deleted. */
  daily_message_id: string | null;
  weekly_message_id: string | null;
  monthly_message_id: string | null;
  periods: Period[];
  /** What the message said when it was last written: a short hash of its text and the moment (milliseconds). */
  card_state: CardState | null;
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
 * A board that has not been refreshed for this long is due. The job looks every 15 seconds, so a board is looked at every 5 minutes (a little less than that
 * after the last time, so the look that follows is the one that finds it due).
 */
export const REFRESH_SECONDS = 270;
/** The most boards one look reads. */
export const MAX_DUE = 500;

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
       message_id = case when activity_leaderboards.channel_id = excluded.channel_id then activity_leaderboards.message_id end,
       daily_message_id = case when activity_leaderboards.channel_id = excluded.channel_id then activity_leaderboards.daily_message_id end,
       weekly_message_id = case when activity_leaderboards.channel_id = excluded.channel_id then activity_leaderboards.weekly_message_id end,
       monthly_message_id = case when activity_leaderboards.channel_id = excluded.channel_id then activity_leaderboards.monthly_message_id end,
       card_state = case when activity_leaderboards.channel_id = excluded.channel_id then activity_leaderboards.card_state else '{}'::jsonb end,
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
    [Math.max(1, Math.min(MAX_DUE, limit)), REFRESH_SECONDS],
  );
  return (rows as unknown as BoardRow[]).map(withPeriods);
}

/**
 * What a look found about a board, written together with the others of its round (`flushRefreshed`). `messageId` is the one message of the board; `clearOld` says that the messages of
 * the older way (one for each period) were deleted, so their ids are forgotten; `state` is the memory of the message when it changed.
 */
export interface Refreshed {
  guildId: string;
  kind: Kind;
  messageId: string | null;
  clearOld: boolean;
  state: CardState | null;
}

/**
 * Marks boards as looked at, with their message and the memory of it, in one statement (a round looks at hundreds of boards, and one statement for each would be most of what
 * the database does for them). A board whose message was not written keeps the memory it had.
 */
export async function flushRefreshed(entries: readonly Refreshed[]): Promise<void> {
  if (!entries.length) return;
  await pool().query(
    `update activity_leaderboards b set
        last_refreshed_at = now(), last_error = null,
        message_id = nullif(v.message, ''),
        daily_message_id = case when v.clear = 'true' then null else b.daily_message_id end,
        weekly_message_id = case when v.clear = 'true' then null else b.weekly_message_id end,
        monthly_message_id = case when v.clear = 'true' then null else b.monthly_message_id end,
        card_state = case when v.state = '' then b.card_state else v.state::jsonb end
      from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[]) as v(guild_id, kind, message, clear, state)
      where b.guild_id = v.guild_id and b.kind = v.kind`,
    [
      entries.map((entry) => entry.guildId),
      entries.map((entry) => entry.kind),
      entries.map((entry) => entry.messageId ?? ''),
      entries.map((entry) => String(entry.clearOld)),
      entries.map((entry) => (entry.state ? JSON.stringify(entry.state) : '')),
    ],
  );
}

/**
 * The top of each period asked for, read in one round trip: the days from the earliest `startDay` are read once and every period adds up its own days from them (the month
 * contains the week and the day, so reading each period on its own read the same rows up to three times). Members with nothing in a period are not listed.
 */
export async function readTops(guildId: string, kind: Kind, periods: readonly { period: Period; startDay: string }[], limit = 30): Promise<Record<Period, TopRow[]>> {
  const result: Record<Period, TopRow[]> = { daily: [], weekly: [], monthly: [] };
  if (!periods.length) return result;
  const column = kind === 'voice' ? 'voice_seconds' : 'messages'; // chosen here, never from the outside
  const earliest = periods.map((each) => each.startDay).sort()[0];
  const params: unknown[] = [guildId, earliest, Math.max(1, Math.min(100, limit))];
  const parts = periods.map((each) => {
    params.push(each.period, each.startDay);
    return `(select $${params.length - 1}::text as period, user_id, sum(${column})::bigint as amount from days where day >= $${params.length}::date group by user_id having sum(${column}) > 0 order by sum(${column}) desc, user_id limit $3)`;
  });
  const { rows } = await pool().query(`with days as materialized (select user_id, day, ${column} from activity_members where guild_id = $1 and day >= $2::date) ${parts.join(' union all ')}`, params);
  for (const row of rows) {
    const period = String(row.period) as Period;
    if (period in result) result[period].push({ user_id: String(row.user_id), amount: Number(row.amount) });
  }
  for (const period of PERIODS) result[period].sort((a, b) => b.amount - a.amount || (a.user_id < b.user_id ? -1 : 1));
  return result;
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
