// i18n-ignore-file: database layer, nothing here is shown to anyone.
// The role of the most active member a server asked for (table `activity_top_roles`): one row for each server and kind (chat or voice) with the role, who has it now and the
// week it was last given for. The ranking it is given from is read with `readTopBetween` of db/activityLeaderboards.
// Written in TypeScript: `npm run build:ts` compiles it over src/db/activityTopRoles.js, which is what the bot loads.
import type { Kind } from './activityLeaderboards';

/** A row of `activity_top_roles`. `awarded_week` is the first day (`YYYY-MM-DD`, GMT-5) of the week the role was last given for. */
export interface TopRoleRow {
  guild_id: string;
  kind: Kind;
  role_id: string;
  holder_id: string | null;
  awarded_week: string | null;
  last_checked_at: string | Date | null;
  last_error: string | null;
  created_at: string | Date;
}

interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }

// The project is JavaScript: its modules are read with `require` and given the shape that is used here.
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };
const { ensureGuild } = require('./guilds') as { ensureGuild: (guildId: string) => Promise<unknown> };

/** A role that could not be given waits this long before it is tried again. */
export const RETRY_MINUTES = 55;

const pool = (): Pool => getPrimaryPool();
const asRow = (row: Record<string, unknown> | undefined): TopRoleRow | null => (row ? (row as unknown as TopRoleRow) : null);

export async function listRoles(guildId: string): Promise<TopRoleRow[]> {
  const { rows } = await pool().query('select * from activity_top_roles where guild_id = $1 order by kind', [guildId]);
  return rows as unknown as TopRoleRow[];
}

/**
 * Chooses the role of a kind. The holder is kept when it is the same role (Petto takes it from them when the week changes) and forgotten when it changes
 * (the caller takes the old role from the holder first); either way it is due now, so the winner of last week gets it at the next look.
 */
export async function upsertRole(guildId: string, kind: Kind, roleId: string): Promise<TopRoleRow> {
  await ensureGuild(guildId);
  const { rows } = await pool().query(
    `insert into activity_top_roles (guild_id, kind, role_id) values ($1, $2, $3)
     on conflict (guild_id, kind) do update set
       role_id = excluded.role_id,
       holder_id = case when activity_top_roles.role_id = excluded.role_id then activity_top_roles.holder_id end,
       awarded_week = null, last_checked_at = null, last_error = null
     returning *`,
    [guildId, kind, roleId],
  );
  return rows[0] as unknown as TopRoleRow;
}

/** Takes a role away and answers the row it had (to take the role from who has it), or null when there was none. */
export async function removeRole(guildId: string, kind: Kind): Promise<TopRoleRow | null> {
  const { rows } = await pool().query('delete from activity_top_roles where guild_id = $1 and kind = $2 returning *', [guildId, kind]);
  return asRow(rows[0]);
}

/** The week is done: remembers who has the role now (null when nobody) and that this week (`YYYY-MM-DD`) was given. */
export async function markAwarded(guildId: string, kind: Kind, week: string, holderId: string | null): Promise<void> {
  await pool().query(
    'update activity_top_roles set holder_id = $4, awarded_week = $3, last_checked_at = now(), last_error = null where guild_id = $1 and kind = $2',
    [guildId, kind, week, holderId],
  );
}

/** Saves why the role could not be given (a short code) and counts it as looked at, so it is tried again in an hour and not at every round. */
export async function markError(guildId: string, kind: Kind, code: string): Promise<void> {
  await pool().query('update activity_top_roles set last_error = $3, last_checked_at = now() where guild_id = $1 and kind = $2', [guildId, kind, code]);
}

/** The roles not given yet for the week that just ended (`week` is its first day) and not tried in the last hour, the oldest first. */
export async function listDue(week: string, limit = 50): Promise<TopRoleRow[]> {
  const { rows } = await pool().query(
    `select * from activity_top_roles
      where awarded_week is distinct from $1
        and (last_checked_at is null or last_checked_at <= now() - make_interval(mins => $3))
      order by last_checked_at asc nulls first limit $2`,
    [week, Math.max(1, Math.min(200, limit)), RETRY_MINUTES],
  );
  return rows as unknown as TopRoleRow[];
}
