// Premium that is over is deleted, not kept as history with a "reactivate" button.
//   - A manual grant (given by the owner) goes as soon as it is revoked or its end date has passed.
//   - Any other plan (the paid ones) goes 7 days after it ended (expired or canceled, and past its end date), so a late webhook or a
//     payment question still finds the row.
// Before a row goes, the servers it still held have their Premium profile reset (like a release does) and, afterwards, the Premium roles of
// its owner are synced again (a person with no row left would never be looked at by the role job otherwise). The slot assignments go
// with it (`on delete cascade`). A plan that is still running is never touched.
const { getPrimaryPool } = require('../db/postgres');
const { resetGuildPremiumProfile } = require('../db/premium');
const { syncPremiumRoleForUser } = require('./premiumRoleJob');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const INTERVAL_MS = 10 * 60_000;
const PAID_GRACE_DAYS = 7;

// The rows that are over. `$1` is the grace of the paid plans, in days.
const ENDED_SQL = `
  select id, user_id, provider
    from premium_entitlements
   where (provider = 'manual'
          and (status <> 'active' or (current_period_end is not null and current_period_end < now())))
      or (provider <> 'manual'
          and status in ('expired', 'canceled')
          and updated_at < now() - make_interval(days => $1)
          and (current_period_end is null or current_period_end < now()))
   order by id
   limit 200`;

/**
 * Deletes what ended. `deps` can be replaced in tests: { pool, resetProfile, syncRole, graceDays }.
 * Returns { removed, userIds }.
 */
async function purgeEndedPremium(client = null, deps = {}) {
  const pool = deps.pool ?? getPrimaryPool();
  const resetProfile = deps.resetProfile ?? ((guildId) => resetGuildPremiumProfile(guildId, client));
  const syncRole = deps.syncRole ?? ((userId) => syncPremiumRoleForUser(client, userId));
  const graceDays = deps.graceDays ?? PAID_GRACE_DAYS;

  const { rows } = await pool.query(ENDED_SQL, [graceDays]);
  if (!rows.length) return { removed: 0, userIds: [] };

  const userIds = new Set();
  let removed = 0;
  for (const row of rows) {
    const { rows: held } = await pool.query(
      `select distinct guild_id from premium_slot_assignments where entitlement_id = $1 and status = 'active'`,
      [row.id],
    );
    for (const assignment of held) await Promise.resolve(resetProfile(assignment.guild_id)).catch((error) => logger.warn(`Premium cleanup: could not reset the profile of ${assignment.guild_id}:`, error.message));
    // One statement removes the row and (by cascade) its assignments; the conditions are repeated so a grant extended or edited since the read stays.
    const { rowCount } = await pool.query(
      `delete from premium_entitlements
        where id = $1
          and ((provider = 'manual' and (status <> 'active' or (current_period_end is not null and current_period_end < now())))
            or (provider <> 'manual' and status in ('expired', 'canceled') and updated_at < now() - make_interval(days => $2)
                and (current_period_end is null or current_period_end < now())))`,
      [row.id, graceDays],
    );
    if (rowCount) {
      removed += rowCount;
      if (row.user_id) userIds.add(String(row.user_id));
    }
  }
  for (const userId of userIds) await Promise.resolve(syncRole(userId)).catch((error) => logger.warn(`Premium cleanup: roles of ${userId} were not synced:`, error.message));
  return { removed, userIds: [...userIds] };
}

function startPremiumCleanupJob(client) {
  const run = exclusiveTask(async () => {
    const { removed } = await purgeEndedPremium(client);
    if (removed) logger.info(`Premium: removed ${removed} plan(s) that had ended.`);
  });
  const tick = () => run().catch((error) => logger.error('Premium cleanup job failed:', error));
  setTimeout(tick, 60_000).unref?.();
  setInterval(tick, INTERVAL_MS).unref?.();
}

module.exports = { startPremiumCleanupJob, purgeEndedPremium, ENDED_SQL, PAID_GRACE_DAYS };
