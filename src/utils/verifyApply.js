// Lets a member in once they passed the check, however they did it (the page of the link, or the letters inside Discord): the single-use
// claim, the roles, the log and the confirmation DM.
const { claimRedemption, releaseRedemption } = require('../db/verificationRedemptions');
const { logVerification } = require('./verificationLog');
const { sendVerifiedDM } = require('./verifyMessage');
const logger = require('./logger');
const { t, guildLanguage } = require('../i18n');

/** `{ ok: true }`, `{ ok: false, reason: 'claimed' }` (that pass was already used) or throws when the roles could not be changed. */
async function applyVerification({ client, guild, member, settings, jti }) {
  if (!(await claimRedemption({ jti, guildId: guild.id, userId: member.id }))) return { ok: false, reason: 'claimed' };
  const lang = await guildLanguage(guild.id);
  try {
    if (settings?.unverified_role_id && member.roles.cache.has(settings.unverified_role_id)) await member.roles.remove(settings.unverified_role_id, t(lang, 'verify.reason.passed'));
    if (settings?.verified_role_id) await member.roles.add(settings.verified_role_id, t(lang, 'verify.reason.passed'));
  } catch (err) {
    await releaseRedemption(jti).catch((releaseErr) => logger.error('Failed to release verification claim after role failure:', releaseErr));
    throw err;
  }
  // The member is in; none of this may turn a success into an error.
  await logVerification(client, guild, member.user, lang).catch((err) => logger.error('Failed to log verification:', err));
  await sendVerifiedDM(member, { guild, lang }).catch(() => logger.warn(`Could not DM verified confirmation to ${member.id} in guild ${guild.id}.`));
  return { ok: true };
}

module.exports = { applyVerification };
