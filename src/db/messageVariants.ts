// i18n-ignore-file: database layer, nothing here is shown to anyone.
// More than one message for the welcome, the goodbye and the boost announcement. The first message of each is the one saved in `member_events_config`; the others are rows of
// `member_event_variants` (at most 24, so 25 with the first). Each time the event happens `pickMessage` picks one of them at random and never the same one twice in a row.
// Written in TypeScript: `npm run build:ts` compiles it over src/db/messageVariants.js. The choice of one message is in utils/messageVariants.ts.
interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };
const { createExpiringCache } = require('../utils/expiringCache') as { createExpiringCache: <T>(ttl: number, options: { invalidateOn: string[] }) => { get(key: string, loader: () => Promise<T>): Promise<T>; delete(key: string): void } };

export const KINDS = ['welcome', 'leave', 'boost'] as const;
export type Kind = (typeof KINDS)[number];
/** The first message counts too: 25 in all for each kind. */
export const MAX_MESSAGES = 25;
export const MAX_EXTRA = MAX_MESSAGES - 1;

export interface Message { message: string | null; template: string | null }
export interface StoredVariant extends Message { id: number; position: number }

const isKind = (value: unknown): value is Kind => (KINDS as readonly unknown[]).includes(value);
const filled = (m: Message | null | undefined): m is Message => Boolean(m && ((m.message && m.message.trim()) || (m.template && m.template.trim())));

const cache = createExpiringCache<Record<Kind, StoredVariant[]>>(15_000, { invalidateOn: ['member_event_variants'] });

async function loadAll(guildId: string): Promise<Record<Kind, StoredVariant[]>> {
  const { rows } = await getPrimaryPool().query('select id, kind, position, message, embed_template from member_event_variants where guild_id = $1 order by position, id', [guildId]);
  const all: Record<Kind, StoredVariant[]> = { welcome: [], leave: [], boost: [] };
  for (const row of rows) {
    if (!isKind(row.kind)) continue;
    all[row.kind].push({ id: Number(row.id), position: Number(row.position), message: (row.message as string | null) ?? null, template: (row.embed_template as string | null) ?? null });
  }
  return all;
}

/** The other messages of a kind, in order (not the first one, which is in the settings). A server with none costs one cached read. */
export async function variantsOf(guildId: string, kind: Kind): Promise<StoredVariant[]> {
  return (await cache.get(String(guildId), () => loadAll(String(guildId))))[kind];
}


// ---- What the commands do (the dashboard writes the same table) ----

/** Adds a message to a kind. `full` when there is no room (25 in all, the first included). */
export async function addVariant(guildId: string, kind: Kind, message: Message): Promise<{ ok: true; total: number } | { ok: false; reason: 'full' | 'empty' }> {
  if (!filled(message)) return { ok: false, reason: 'empty' };
  const pool = getPrimaryPool();
  const { rows } = await pool.query('select count(*)::int as n, coalesce(max(position), 0)::int as last from member_event_variants where guild_id = $1 and kind = $2', [guildId, kind]);
  const have = Number(rows[0]?.n ?? 0);
  if (have >= MAX_EXTRA) return { ok: false, reason: 'full' };
  await pool.query('insert into member_event_variants (guild_id, kind, position, message, embed_template) values ($1, $2, $3, $4, $5)',
    [guildId, kind, Number(rows[0]?.last ?? 0) + 1, message.message?.trim() ? message.message : null, message.template?.trim() ? message.template : null]);
  cache.delete(String(guildId));
  return { ok: true, total: have + 2 };
}

/** Takes away the other message that is number `number` in the list (2 is the first of the others: number 1 is the first message and it is changed with setup). */
export async function removeVariant(guildId: string, kind: Kind, number: number): Promise<boolean> {
  const list = await variantsOf(guildId, kind);
  const row = list[number - 2];
  if (!row) return false;
  await getPrimaryPool().query('delete from member_event_variants where guild_id = $1 and kind = $2 and id = $3', [guildId, kind, row.id]);
  cache.delete(String(guildId));
  return true;
}
