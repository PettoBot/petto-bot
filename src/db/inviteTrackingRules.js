// The rule for a fake join, apart from the database so it can be checked on its own.
const FAKE_ACCOUNT_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * A join is "fake" when the account is younger than the days the server set (3 by default, 0 turns it off) or the member had joined this server before (it came back):
 * those are counted apart, so leaving and rejoining does not raise anybody's invites.
 */
function isFakeJoin({ accountCreatedAt, previousRow, fakeDays = 3 }) {
  if (previousRow) return true;
  return fakeDays > 0 && accountCreatedAt != null && Date.now() - accountCreatedAt < fakeDays * 86_400_000;
}

module.exports = { isFakeJoin, FAKE_ACCOUNT_AGE_MS };
