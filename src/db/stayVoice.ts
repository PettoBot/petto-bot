// i18n-ignore-file: database layer, nothing here is shown to anyone.
// Stay in voice: the row of `stay_voice` of a server (the voice channel Petto stays in, the text of the status of that channel, whether it joins with the sound off, and the switch).
// The commands (`/247`), the dashboard and the job (jobs/stayVoiceJob.ts) read and write it. Written in TypeScript: `npm run build:ts` compiles it over db/stayVoice.js.
interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };
const { ensureGuild } = require('./guilds') as { ensureGuild: (guildId: string) => Promise<unknown> };

export const MAX_STATUS = 120;
export interface StayVoice { guildId: string; channelId: string; status: string | null; deaf: boolean; enabled: boolean }
export type StayPatch = { channelId?: string; status?: string | null; deaf?: boolean; enabled?: boolean };

const rowTo = (row: Record<string, unknown>): StayVoice => ({
  guildId: String(row.guild_id), channelId: String(row.channel_id), status: row.status === null || row.status === undefined ? null : String(row.status),
  deaf: row.deaf !== false, enabled: row.enabled !== false,
});

/** The text of a status as it is kept: trimmed, one line, at most 120 characters; empty (or "default") is null, the default text of the language. */
export function cleanStatus(text: unknown): string | null {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!value || value.toLowerCase() === 'default') return null;
  return value.length > MAX_STATUS ? value.slice(0, MAX_STATUS - 1).trimEnd() + '…' : value;
}

export async function getStay(guildId: string): Promise<StayVoice | null> {
  const { rows } = await getPrimaryPool().query('select guild_id, channel_id, status, deaf, enabled from stay_voice where guild_id = $1', [guildId]);
  return rows[0] ? rowTo(rows[0]) : null;
}

/** Every server that has the switch on (the job asks for them once a minute). */
export async function listEnabled(): Promise<StayVoice[]> {
  const { rows } = await getPrimaryPool().query('select guild_id, channel_id, status, deaf, enabled from stay_voice where enabled');
  return rows.map(rowTo);
}

/** Saves what changed. A first save needs a channel; the switch is turned on by saving a channel, and `enabled: false` turns it off and keeps the channel. */
export async function saveStay(guildId: string, patch: StayPatch, updatedBy?: string | null): Promise<StayVoice | null> {
  const current = await getStay(guildId);
  const channelId = patch.channelId ?? current?.channelId;
  if (!channelId) return null;
  await ensureGuild(guildId);
  const next = {
    channelId,
    status: patch.status === undefined ? (current?.status ?? null) : cleanStatus(patch.status),
    deaf: patch.deaf ?? current?.deaf ?? true,
    enabled: patch.enabled ?? (patch.channelId ? true : (current?.enabled ?? true)),
  };
  const { rows } = await getPrimaryPool().query(
    `insert into stay_voice (guild_id, channel_id, status, deaf, enabled, updated_by) values ($1, $2, $3, $4, $5, $6)
     on conflict (guild_id) do update set channel_id = excluded.channel_id, status = excluded.status, deaf = excluded.deaf, enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()
     returning guild_id, channel_id, status, deaf, enabled`,
    [guildId, next.channelId, next.status, next.deaf, next.enabled, updatedBy ?? null]);
  return rows[0] ? rowTo(rows[0]) : null;
}
