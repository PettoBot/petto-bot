"use strict";
// i18n-ignore-file: database layer, nothing here is shown to anyone.
// The activity leaderboards a server asked for (table `activity_leaderboards`): one row for each server and kind (chat or voice) with the channel and the three messages
// (daily, weekly, monthly) that Petto edits every hour, and the top of the members read from `activity_members` (counts only, never what was said).
// Written in TypeScript: `npm run build:ts` compiles it over src/db/activityLeaderboards.js, which is what the bot loads.
Object.defineProperty(exports, "__esModule", { value: true });
exports.REFRESH_MINUTES = exports.KINDS = void 0;
exports.listBoards = listBoards;
exports.getBoard = getBoard;
exports.upsertBoard = upsertBoard;
exports.removeBoard = removeBoard;
exports.saveMessages = saveMessages;
exports.markRefreshed = markRefreshed;
exports.markError = markError;
exports.listDue = listDue;
exports.readTop = readTop;
exports.KINDS = ['chat', 'voice'];
// The project is JavaScript: its modules are read with `require` and given the shape that is used here.
const { getPrimaryPool } = require('./postgres');
const { ensureGuild } = require('./guilds');
/** A board that has not been refreshed for this long is due. */
exports.REFRESH_MINUTES = 55;
const pool = () => getPrimaryPool();
const asRow = (row) => (row ? row : null);
async function listBoards(guildId) {
    const { rows } = await pool().query('select * from activity_leaderboards where guild_id = $1 order by kind', [guildId]);
    return rows;
}
async function getBoard(guildId, kind) {
    const { rows } = await pool().query('select * from activity_leaderboards where guild_id = $1 and kind = $2', [guildId, kind]);
    return asRow(rows[0]);
}
/**
 * Chooses the channel of a board. The messages are kept when it is the same channel (Petto goes on editing them) and forgotten when it changes (they are in the
 * old one); either way the board is due now, so it is written at the next look or at once by the command.
 */
async function upsertBoard(guildId, kind, channelId) {
    await ensureGuild(guildId);
    const { rows } = await pool().query(`insert into activity_leaderboards (guild_id, kind, channel_id) values ($1, $2, $3)
     on conflict (guild_id, kind) do update set
       channel_id = excluded.channel_id,
       daily_message_id = case when activity_leaderboards.channel_id = excluded.channel_id then activity_leaderboards.daily_message_id end,
       weekly_message_id = case when activity_leaderboards.channel_id = excluded.channel_id then activity_leaderboards.weekly_message_id end,
       monthly_message_id = case when activity_leaderboards.channel_id = excluded.channel_id then activity_leaderboards.monthly_message_id end,
       last_refreshed_at = null, last_error = null
     returning *`, [guildId, kind, channelId]);
    return rows[0];
}
/** Takes a board away and answers the row it had (to delete its messages), or null when there was none. */
async function removeBoard(guildId, kind) {
    const { rows } = await pool().query('delete from activity_leaderboards where guild_id = $1 and kind = $2 returning *', [guildId, kind]);
    return asRow(rows[0]);
}
/** Remembers the three messages of a board (null forgets one). */
async function saveMessages(guildId, kind, ids) {
    await pool().query('update activity_leaderboards set daily_message_id = $3, weekly_message_id = $4, monthly_message_id = $5 where guild_id = $1 and kind = $2', [guildId, kind, ids.daily, ids.weekly, ids.monthly]);
}
async function markRefreshed(guildId, kind) {
    await pool().query('update activity_leaderboards set last_refreshed_at = now(), last_error = null where guild_id = $1 and kind = $2', [guildId, kind]);
}
/** Saves why a board could not be written (a short code) and counts it as looked at, so it is tried again in an hour and not at every round. */
async function markError(guildId, kind, code) {
    await pool().query('update activity_leaderboards set last_error = $3, last_refreshed_at = now() where guild_id = $1 and kind = $2', [guildId, kind, code]);
}
/** The boards that were never written or were last written `REFRESH_MINUTES` ago, the oldest first. */
async function listDue(limit = 20) {
    const { rows } = await pool().query(`select * from activity_leaderboards
      where last_refreshed_at is null or last_refreshed_at <= now() - make_interval(mins => $2)
      order by last_refreshed_at asc nulls first limit $1`, [Math.max(1, Math.min(200, limit)), exports.REFRESH_MINUTES]);
    return rows;
}
/**
 * The most active members from `sinceDay` (`YYYY-MM-DD`, in the day of Petto) until now: messages for `chat`, seconds in voice for `voice`.
 * Members with nothing in the period are not listed.
 */
async function readTop(guildId, kind, sinceDay, limit = 30) {
    const column = kind === 'voice' ? 'voice_seconds' : 'messages'; // chosen here, never from the outside
    const { rows } = await pool().query(`select user_id, sum(${column})::bigint as amount from activity_members
      where guild_id = $1 and day >= $2 group by user_id having sum(${column}) > 0
      order by sum(${column}) desc, user_id limit $3`, [guildId, sinceDay, Math.max(1, Math.min(100, limit))]);
    return rows.map((row) => ({ user_id: String(row.user_id), amount: Number(row.amount) }));
}
