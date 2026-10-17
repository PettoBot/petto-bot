// Reads the member behind a dashboard request. A Petto developer can open the dashboard of a server they are not in (a read-only
// view), and Discord answers that fetch with Unknown Member (10007) or Unknown User (10013): that is "not a member", not an error, so it
// is not logged, and the answer is remembered for a minute so the same page does not ask Discord again for each card it loads.

const NOT_MEMBER_CODES = new Set([10007, 10013]);
const NEGATIVE_TTL_MS = 60_000;
const NEGATIVE_LIMIT = 5_000;

/** @type {Map<string, number>} */
const notMembers = new Map();

/** @param {unknown} err */
function isNotMemberError(err) {
  const code = /** @type {{ code?: unknown }} */ (err ?? {}).code;
  return typeof code === 'number' && NOT_MEMBER_CODES.has(code);
}

/**
 * The member, or null when the user is not in the server. Other errors (the guild is gone, Discord is down) are thrown.
 * @param {{ id: string, members: { cache?: Map<string, any>, fetch: (id: string) => Promise<any> } }} guild
 * @param {string} userId
 * @param {number} [now]
 */
async function fetchDashboardMember(guild, userId, now = Date.now()) {
  const key = `${guild.id}:${userId}`;
  const until = notMembers.get(key);
  if (until !== undefined) {
    if (until > now) return null;
    notMembers.delete(key);
  }
  try {
    return await guild.members.fetch(userId);
  } catch (err) {
    if (!isNotMemberError(err)) throw err;
    if (notMembers.size >= NEGATIVE_LIMIT) {
      for (const [k, expires] of notMembers) if (expires <= now) notMembers.delete(k);
      if (notMembers.size >= NEGATIVE_LIMIT) notMembers.delete(notMembers.keys().next().value ?? '');
    }
    notMembers.set(key, now + NEGATIVE_TTL_MS);
    return null;
  }
}

module.exports = { fetchDashboardMember, isNotMemberError, NEGATIVE_TTL_MS };
