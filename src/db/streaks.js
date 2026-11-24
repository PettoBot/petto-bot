"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = void 0;
exports.getConfig = getConfig;
exports.daysOf = daysOf;
exports.totalsOf = totalsOf;
exports.guildsOf = guildsOf;
const { getPrimaryPool } = require('./postgres');
exports.DEFAULT_CONFIG = { enabled: true, minMessages: 1, minVoiceMinutes: 0 };
async function getConfig(guildId) {
    const { rows } = await getPrimaryPool().query(`select enabled, min_messages, min_voice_minutes from streak_config where guild_id = $1`, [guildId]);
    const row = rows[0];
    return row ? { enabled: Boolean(row.enabled), minMessages: Number(row.min_messages), minVoiceMinutes: Number(row.min_voice_minutes) } : { ...exports.DEFAULT_CONFIG };
}
/** The days of a person in a server over the last 400 days. */
async function daysOf(guildId, userId) {
    const { rows } = await getPrimaryPool().query(`select to_char(day, 'YYYY-MM-DD') as day, messages, voice_seconds from activity_members where guild_id = $1 and user_id = $2 and day >= current_date - 400 order by day`, [guildId, userId]);
    return rows.map((row) => ({ day: String(row.day), messages: Number(row.messages), voiceSeconds: Number(row.voice_seconds) }));
}
/** What a person did in every server: messages and seconds in voice (activity_members already leaves out who asked not to be counted). */
async function totalsOf(userId) {
    const { rows } = await getPrimaryPool().query(`select coalesce(sum(messages), 0) as messages, coalesce(sum(voice_seconds), 0) as voice from activity_members where user_id = $1`, [userId]);
    return { messages: Number(rows[0]?.messages ?? 0), voiceSeconds: Number(rows[0]?.voice ?? 0) };
}
/** The servers where a person has been active, the latest first (at most 10). */
async function guildsOf(userId) {
    const { rows } = await getPrimaryPool().query(`select guild_id from activity_members where user_id = $1 group by guild_id order by max(day) desc limit 10`, [userId]);
    return rows.map((row) => String(row.guild_id));
}
