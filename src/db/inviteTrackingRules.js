// The rules of the invite tracker, apart from the database so they can be checked on their own.
const FAKE_ACCOUNT_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** What a server has until it changes a setting (the same as before the settings existed). */
const DEFAULT_SETTINGS = Object.freeze({ fakeDays: 3, quickLeaveMinutes: 0, ignoreBots: false, subtractLeaves: true });
const LIMITS = Object.freeze({ fakeDays: [0, 365], quickLeaveMinutes: [0, 1440] });

/**
 * A join is "fake" when the account is younger than the days the server set (3 by default, 0 turns it off) or the member had joined this server before (it came back):
 * those are counted apart, so leaving and rejoining does not raise anybody's invites.
 */
function isFakeJoin({ accountCreatedAt, previousRow, fakeDays = 3 }) {
  if (previousRow) return true;
  return fakeDays > 0 && accountCreatedAt != null && Date.now() - accountCreatedAt < fakeDays * 86_400_000;
}

/** True when a member left within `quickLeaveMinutes` of joining (0 is off): that join is moved to fake instead of staying a real one. */
function isQuickLeave({ joinedAt, leftAt = Date.now(), quickLeaveMinutes = 0 }) {
  if (!(quickLeaveMinutes > 0) || joinedAt == null) return false;
  return new Date(leftAt).getTime() - new Date(joinedAt).getTime() <= quickLeaveMinutes * 60_000;
}

/**
 * THE total of invites of a person, used by the commands, the dashboard, the rewards and `{inviter.invites}`:
 * joins, minus the leaves when the server counts them (the default), plus the bonus.
 */
function inviteTotal(stats, subtractLeaves = DEFAULT_SETTINGS.subtractLeaves) {
  const n = (value) => Number(value) || 0;
  return n(stats?.joins) - (subtractLeaves ? n(stats?.leaves) : 0) + n(stats?.bonus);
}

/** The same total as an SQL expression, for the leaderboards that sort by it. `flag` is the placeholder of subtract_leaves (`$3`). */
function inviteTotalSql({ joins = 'joins', leaves = 'leaves', bonus = 'bonus' } = {}, flag) {
  return `(${joins} - case when ${flag}::boolean then ${leaves} else 0 end + ${bonus})`; // i18n-ignore: SQL, not a text for people
}

/** Cleans the settings a person sent (the dashboard, a command): only known ones, in range. Returns `{ values }` or `{ error: <name of the bad one> }`. */
function readSettingsPatch(input = {}) {
  const values = {};
  for (const key of ['fakeDays', 'quickLeaveMinutes']) {
    if (input[key] === undefined || input[key] === null) continue;
    const [min, max] = LIMITS[key];
    const number = typeof input[key] === 'string' && input[key].trim() === '' ? NaN : Number(input[key]);
    if (!Number.isInteger(number) || number < min || number > max) return { error: key };
    values[key] = number;
  }
  for (const key of ['ignoreBots', 'subtractLeaves']) {
    if (input[key] === undefined || input[key] === null) continue;
    if (typeof input[key] !== 'boolean') return { error: key };
    values[key] = input[key];
  }
  return { values };
}

module.exports = { isFakeJoin, isQuickLeave, inviteTotal, inviteTotalSql, readSettingsPatch, DEFAULT_SETTINGS, LIMITS, FAKE_ACCOUNT_AGE_MS };
