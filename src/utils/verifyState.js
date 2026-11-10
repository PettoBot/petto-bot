// Whether a member is verified does not depend only on the roles: the passes are kept (`verification_redemptions`), and a member who passed
// in this stay of the server is verified even if somebody gave them the gate role by mistake (or took the verified role away). A new stay
// (they left and joined again) is not covered: that one has to verify again, as always. The staff can ask for a new check with `/verify send`.
const { lastVerifiedAt } = require('../db/verificationRedemptions');
const { applyVerificationRoles } = require('./verifyApply');

// A pass is "of this stay" when it is not older than the join (a little slack for the clocks of Discord and the database).
const SLACK_MS = 60_000;

/** Whether the member passed the verification after they joined this server. False when it cannot be known. */
async function verifiedThisStay(guildId, member, lookup = lastVerifiedAt) {
  const joined = member?.joinedTimestamp;
  if (!joined) return false;
  const last = await lookup(guildId, member.id).catch(() => null);
  return Boolean(last) && last.getTime() >= joined - SLACK_MS;
}

/**
 * A member who holds the gate role although they already passed in this stay gets their roles back with no new check.
 * Returns `{ restored: true, noRole }` (`noRole`: there was no role to give), or null when nothing was done (they are not gated, or they did not pass).
 */
async function restoreVerified({ client, guild, member, settings, lang }, deps = {}) {
  if (!settings?.unverified_role_id || !member.roles.cache.has(settings.unverified_role_id)) return null;
  if (!(await verifiedThisStay(guild.id, member, deps.lookup))) return null;
  const { noRole } = await (deps.apply ?? applyVerificationRoles)({ client, guild, member, settings, lang });
  return { restored: true, noRole };
}

module.exports = { verifiedThisStay, restoreVerified };
