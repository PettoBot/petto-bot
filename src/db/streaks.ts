// i18n-ignore-file: database layer, nothing here is shown to anyone.
// What the streaks read: the days of a person in a server (activity_members) and the rules of a server (streak_config).
// Written in TypeScript: `npm run build:ts` compiles it over db/streaks.js.
interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };

export interface Config { enabled: boolean; minMessages: number; minVoiceMinutes: number }
export const DEFAULT_CONFIG: Config = { enabled: true, minMessages: 1, minVoiceMinutes: 0 };

export async function getConfig(guildId: string): Promise<Config> {
  const { rows } = await getPrimaryPool().query(`select enabled, min_messages, min_voice_minutes from streak_config where guild_id = $1`, [guildId]);
  const row = rows[0];
  return row ? { enabled: Boolean(row.enabled), minMessages: Number(row.min_messages), minVoiceMinutes: Number(row.min_voice_minutes) } : { ...DEFAULT_CONFIG };
}

/** The days of a person in a server over the last 400 days. */
export async function daysOf(guildId: string, userId: string): Promise<{ day: string; messages: number; voiceSeconds: number }[]> {
  const { rows } = await getPrimaryPool().query(
    `select to_char(day, 'YYYY-MM-DD') as day, messages, voice_seconds from activity_members where guild_id = $1 and user_id = $2 and day >= current_date - 400 order by day`, [guildId, userId]);
  return rows.map((row) => ({ day: String(row.day), messages: Number(row.messages), voiceSeconds: Number(row.voice_seconds) }));
}

/** The servers where a person has been active, the latest first (at most 10). */
export async function guildsOf(userId: string): Promise<string[]> {
  const { rows } = await getPrimaryPool().query(`select guild_id from activity_members where user_id = $1 group by guild_id order by max(day) desc limit 10`, [userId]);
  return rows.map((row) => String(row.guild_id));
}
