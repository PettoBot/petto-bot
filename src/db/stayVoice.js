"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_STATUS = void 0;
exports.cleanStatus = cleanStatus;
exports.getStay = getStay;
exports.listEnabled = listEnabled;
exports.saveStay = saveStay;
const { getPrimaryPool } = require('./postgres');
const { ensureGuild } = require('./guilds');
exports.MAX_STATUS = 120;
const rowTo = (row) => ({
    guildId: String(row.guild_id), channelId: String(row.channel_id), status: row.status === null || row.status === undefined ? null : String(row.status),
    deaf: row.deaf !== false, enabled: row.enabled !== false,
});
/** The text of a status as it is kept: trimmed, one line, at most 120 characters; empty (or "default") is null, the default text of the language. */
function cleanStatus(text) {
    const value = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!value || value.toLowerCase() === 'default')
        return null;
    return value.length > exports.MAX_STATUS ? value.slice(0, exports.MAX_STATUS - 1).trimEnd() + '…' : value;
}
async function getStay(guildId) {
    const { rows } = await getPrimaryPool().query('select guild_id, channel_id, status, deaf, enabled from stay_voice where guild_id = $1', [guildId]);
    return rows[0] ? rowTo(rows[0]) : null;
}
/** Every server that has the switch on (the job asks for them once a minute). */
async function listEnabled() {
    const { rows } = await getPrimaryPool().query('select guild_id, channel_id, status, deaf, enabled from stay_voice where enabled');
    return rows.map(rowTo);
}
/** Saves what changed. A first save needs a channel; the switch is turned on by saving a channel, and `enabled: false` turns it off and keeps the channel. */
async function saveStay(guildId, patch, updatedBy) {
    const current = await getStay(guildId);
    const channelId = patch.channelId ?? current?.channelId;
    if (!channelId)
        return null;
    await ensureGuild(guildId);
    const next = {
        channelId,
        status: patch.status === undefined ? (current?.status ?? null) : cleanStatus(patch.status),
        deaf: patch.deaf ?? current?.deaf ?? true,
        enabled: patch.enabled ?? (patch.channelId ? true : (current?.enabled ?? true)),
    };
    const { rows } = await getPrimaryPool().query(`insert into stay_voice (guild_id, channel_id, status, deaf, enabled, updated_by) values ($1, $2, $3, $4, $5, $6)
     on conflict (guild_id) do update set channel_id = excluded.channel_id, status = excluded.status, deaf = excluded.deaf, enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()
     returning guild_id, channel_id, status, deaf, enabled`, [guildId, next.channelId, next.status, next.deaf, next.enabled, updatedBy ?? null]);
    return rows[0] ? rowTo(rows[0]) : null;
}
