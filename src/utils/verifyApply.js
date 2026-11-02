// Lets a member in once they passed the check, however they did it (the page of the link, or the letters inside Discord): the single-use
// claim, the roles, the log and the confirmation DM.
const { claimRedemption, releaseRedemption } = require('../db/verificationRedemptions');
const { logVerification } = require('./verificationLog');
const { sendVerifiedDM } = require('./verifyMessage');
const { giveVerifiedRole } = require('./verifyHeal');
const { isUnknownRole } = require('./deadRoles');
const logger = require('./logger');
const { t, guildLanguage } = require('../i18n');

/**
 * The roles of a member who passed: the gate role comes off and the role for who passes goes on. A role that was deleted never fails it
 * (utils/verifyHeal.js makes it again, or tells the staff). Returns { noRole }: true when the member is verified but has no role to show for it.
 * Throws when Discord refuses for another reason (the caller gives the claim back).
 */
async function applyVerificationRoles({ client, guild, member, settings, lang }) {
  const reason = t(lang, 'verify.reason.passed');
  if (settings?.unverified_role_id && member.roles.cache.has(settings.unverified_role_id)) {
    try {
      await member.roles.remove(settings.unverified_role_id, reason);
    } catch (error) {
      if (!isUnknownRole(error)) throw error; // the gate role was deleted meanwhile: nothing holds the member back
    }
  }
  const result = await giveVerifiedRole({ client, guild, member, settings, lang, reason });
  return { noRole: !result.given };
}

/** `{ ok: true, noRole }`, `{ ok: false, reason: 'claimed' }` (that pass was already used) or throws when the roles could not be changed. */
async function applyVerification({ client, guild, member, settings, jti }) {
  if (!(await claimRedemption({ jti, guildId: guild.id, userId: member.id }))) return { ok: false, reason: 'claimed' };
  const lang = await guildLanguage(guild.id);
  let noRole = false;
  try {
    ({ noRole } = await applyVerificationRoles({ client, guild, member, settings, lang }));
  } catch (err) {
    await releaseRedemption(jti).catch((releaseErr) => logger.error('Failed to release verification claim after role failure:', releaseErr));
    throw err;
  }
  // The member is in; none of this may turn a success into an error.
  await logVerification(client, guild, member.user, lang).catch((err) => logger.error('Failed to log verification:', err));
  // "You now have full access" is not said when there was no role to give.
  if (!noRole) await sendVerifiedDM(member, { guild, lang }).catch(() => logger.warn(`Could not DM verified confirmation to ${member.id} in guild ${guild.id}.`));
  return { ok: true, noRole };
}

module.exports = { applyVerification, applyVerificationRoles };
