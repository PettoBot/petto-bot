// The rule for a fake join, apart from the database so it can be checked on its own.
const FAKE_ACCOUNT_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * A join is "fake" when the account is less than 3 days old or the member had joined this server before (it came back):
 * those are counted apart, so leaving and rejoining does not raise anybody's invites.
 */
function isFakeJoin({ accountCreatedAt, previousRow }) {
  if (previousRow) return true;
  return accountCreatedAt != null && Date.now() - accountCreatedAt < FAKE_ACCOUNT_AGE_MS;
}

module.exports = { isFakeJoin, FAKE_ACCOUNT_AGE_MS };
