// i18n-ignore-file: database layer, nothing here is shown to anyone.
// The permission problems Petto found in each server (table `permission_alerts`): what is missing and where, how many times it happened, and when the staff was told.
// The same problem is one row, however many times it happens, and the staff is told about it once every 24 hours at most: `claimNotice` decides that in the database,
// so two shards (or two events at the same time) never send it twice.
// Written in TypeScript: `npm run build:ts` compiles it over src/db/permissionAlerts.js, which is what the bot loads.

export interface NeedRow { flag: string; scope: 'server' | 'channel'; channelId: string | null }

/** A row of `permission_alerts`. */
export interface AlertRow {
  guild_id: string;
  problem_key: string;
  feature: string;
  kind: 'missing' | 'hierarchy';
  needs: NeedRow[];
  channel_id: string | null;
  role_id: string | null;
  role_name: string | null;
  role_managed: boolean;
  member_id: string | null;
  occurrences: number;
  first_seen: string | Date;
  last_seen: string | Date;
  last_notified: string | Date | null;
}

export interface AlertInput {
  guildId: string;
  key: string;
  feature: string;
  kind: 'missing' | 'hierarchy';
  needs: NeedRow[];
  channelId?: string | null;
  roleId?: string | null;
  roleName?: string | null;
  roleManaged?: boolean;
  memberId?: string | null;
  /** How many times it happened since it was last saved (the same problem is saved once a minute at the most, the rest is added up). */
  count?: number;
}

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;

/** A server keeps this many problems at the most (the oldest go first), and a problem nobody saw again for this many days is forgotten. */
export const LIMITS = Object.freeze({ perGuild: 40, forgetDays: 14, notifyHours: 24 });

/** The statements, exported so the checks can assert what they say. */
export const SQL = Object.freeze({
  upsert: `insert into permission_alerts (guild_id, problem_key, feature, kind, needs, channel_id, role_id, role_name, role_managed, member_id, occurrences)
           values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11::int)
           on conflict (guild_id, problem_key) do update set occurrences = permission_alerts.occurrences + $11::int, last_seen = now(), needs = excluded.needs,
             role_name = excluded.role_name, role_managed = excluded.role_managed
           returning *`,
  claim: `update permission_alerts set last_notified = now()
          where guild_id = $1 and problem_key = $2 and (last_notified is null or last_notified < now() - make_interval(hours => $3::int))
          returning *`,
  list: 'select * from permission_alerts where guild_id = $1 order by last_seen desc limit $2',
  remove: 'delete from permission_alerts where guild_id = $1 and problem_key = $2 returning problem_key',
  removeAll: 'delete from permission_alerts where guild_id = $1',
  trim: `delete from permission_alerts where guild_id = $1 and problem_key in (
           select problem_key from permission_alerts where guild_id = $1 order by last_seen desc offset $2)`,
  forget: "delete from permission_alerts where last_seen < now() - make_interval(days => $1::int)",
});

/**
 * The store over a `query(sql, params)` function (the pool of the bot, or a fake in the checks).
 * - `record(input)`: saves the problem (or counts it once more) and returns its row.
 * - `claimNotice(guildId, key)`: the row when the staff has not been told in the last 24 hours (and marks it told, at once), or null.
 * - `list(guildId)`, `remove(guildId, key)`, `removeAll(guildId)`, `forgetOld()`.
 */
export function createStore(query: Query) {
  return {
    async record(input: AlertInput): Promise<AlertRow> {
      const guildId = String(input.guildId);
      const { rows } = await query(SQL.upsert, [
        guildId, input.key.slice(0, 400), input.feature.slice(0, 80), input.kind, JSON.stringify(input.needs ?? []),
        input.channelId ?? null, input.roleId ?? null, input.roleName ? input.roleName.slice(0, 100) : null, Boolean(input.roleManaged), input.memberId ?? null, Math.max(1, Math.floor(input.count ?? 1) || 1),
      ]);
      // A server with a lot of problems keeps the newest ones: nothing grows without a limit.
      if (Number(rows[0]?.occurrences) === Math.max(1, Math.floor(input.count ?? 1) || 1)) await query(SQL.trim, [guildId, LIMITS.perGuild]);
      return rows[0] as unknown as AlertRow;
    },
    async claimNotice(guildId: string, key: string): Promise<AlertRow | null> {
      const { rows } = await query(SQL.claim, [String(guildId), key.slice(0, 400), LIMITS.notifyHours]);
      return (rows[0] as unknown as AlertRow | undefined) ?? null;
    },
    async list(guildId: string): Promise<AlertRow[]> {
      const { rows } = await query(SQL.list, [String(guildId), LIMITS.perGuild]);
      return rows as unknown as AlertRow[];
    },
    async remove(guildId: string, key: string): Promise<boolean> {
      const { rows } = await query(SQL.remove, [String(guildId), key]);
      return rows.length > 0;
    },
    async removeAll(guildId: string): Promise<void> {
      await query(SQL.removeAll, [String(guildId)]);
    },
    async forgetOld(): Promise<void> {
      await query(SQL.forget, [LIMITS.forgetDays]);
    },
  };
}

// The project is JavaScript: its modules are read with `require` and given the shape that is used here.
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => { query: Query } };

const store = createStore((sql, params) => getPrimaryPool().query(sql, params));

export const record = store.record;
export const claimNotice = store.claimNotice;
export const list = store.list;
export const remove = store.remove;
export const removeAll = store.removeAll;
export const forgetOld = store.forgetOld;
