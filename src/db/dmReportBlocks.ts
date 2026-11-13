// i18n-ignore-file: database layer, nothing here is shown to anyone.
// The people the Petto team blocked from sending DM reports (table `dm_report_blocks`): a report of a direct message that Petto sent goes to the Petto team only, and a person who sends false
// or abusive ones can be blocked. A blocked person is told, when they press the report button, that they cannot send reports right now (no reason, and not who decided); nothing reaches the team.
// It does not touch the reports of the servers: it is only the reports to the Petto team.
// Written in TypeScript: `npm run build:ts` compiles it over src/db/dmReportBlocks.js, which is what the bot loads.

/** A row of `dm_report_blocks`. */
export interface BlockRow {
  user_id: string;
  user_tag: string | null;
  reason: string;
  blocked_by: string;
  report_id: string | number | null;
  created_at: string | Date;
}

export interface BlockInput {
  userId: string;
  userTag?: string | null;
  reason: string;
  by: string;
  reportId?: string | number | null;
}

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/** The reason is for the team (the blocked person never reads it). `DEFAULT_REASON` is what the form of the card suggests. */
export const LIMITS = Object.freeze({ reasonMin: 3, reasonMax: 300, perPage: 10 });
export const DEFAULT_REASON = 'False or abusive DM reports';

/** The statements, exported so the checks can assert what they say. */
export const SQL = Object.freeze({
  insert: 'insert into dm_report_blocks (user_id, user_tag, reason, blocked_by, report_id) values ($1, $2, $3, $4, $5) on conflict (user_id) do nothing returning *',
  remove: 'delete from dm_report_blocks where user_id = $1 returning *',
  get: 'select * from dm_report_blocks where user_id = $1',
  list: 'select * from dm_report_blocks order by created_at desc, user_id limit $1 offset $2',
  count: 'select count(*)::int as total from dm_report_blocks',
  ids: 'select user_id from dm_report_blocks',
});

/**
 * The store over a `query(sql, params)` function (the pool of the bot, or a fake in the checks).
 * - `load()`: reads who is blocked into memory (when the bot starts), so the button can answer without asking the database.
 * - `isBlockedCached(id)`: from memory (false until loaded); `isBlocked(id)`: from the database, the one that decides (it also keeps the memory right).
 * - `add(input)`: the new row, or null when that person was already blocked. `remove(id)`: the row that was taken away, or null.
 */
export function createStore(query: Query) {
  let known: Set<string> | null = null;
  const remember = (id: string, blocked: boolean): void => {
    if (!known) return;
    if (blocked) known.add(id);
    else known.delete(id);
  };
  return {
    async load(): Promise<number> {
      const { rows } = await query(SQL.ids);
      known = new Set(rows.map((row) => String(row.user_id)));
      return known.size;
    },
    isBlockedCached(userId: string): boolean {
      return known?.has(String(userId)) ?? false;
    },
    async isBlocked(userId: string): Promise<boolean> {
      const id = String(userId);
      const { rows } = await query(SQL.get, [id]);
      const blocked = rows.length > 0;
      remember(id, blocked);
      return blocked;
    },
    async add(input: BlockInput): Promise<BlockRow | null> {
      const id = String(input.userId);
      const { rows } = await query(SQL.insert, [id, input.userTag ?? null, String(input.reason), String(input.by), input.reportId ?? null]);
      remember(id, true);
      return (rows[0] as unknown as BlockRow | undefined) ?? null;
    },
    async remove(userId: string): Promise<BlockRow | null> {
      const id = String(userId);
      const { rows } = await query(SQL.remove, [id]);
      remember(id, false);
      return (rows[0] as unknown as BlockRow | undefined) ?? null;
    },
    async get(userId: string): Promise<BlockRow | null> {
      const { rows } = await query(SQL.get, [String(userId)]);
      return (rows[0] as unknown as BlockRow | undefined) ?? null;
    },
    async list({ limit = LIMITS.perPage, offset = 0 }: { limit?: number; offset?: number } = {}): Promise<BlockRow[]> {
      const { rows } = await query(SQL.list, [Math.max(1, Math.min(100, Math.floor(limit) || LIMITS.perPage)), Math.max(0, Math.floor(offset) || 0)]);
      return rows as unknown as BlockRow[];
    },
    async count(): Promise<number> {
      const { rows } = await query(SQL.count);
      return Number(rows[0]?.total ?? 0) || 0;
    },
  };
}

// The project is JavaScript: its modules are read with `require` and given the shape that is used here.
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => { query: Query } };

const store = createStore((sql, params) => getPrimaryPool().query(sql, params));

export const load = store.load;
export const isBlockedCached = store.isBlockedCached;
export const isBlocked = store.isBlocked;
export const add = store.add;
export const remove = store.remove;
export const get = store.get;
export const list = store.list;
export const count = store.count;
