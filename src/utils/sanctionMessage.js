const { sanctionPayload } = require('./sanctionDesign');

/**
 * The message a sanctioned user is sent when the server has no saved DM for the sanction: a Components V2 card with the
 * server's picture, what happened, who did it, how long and why. Goes straight into `.send(...)`.
 */
function buildSanctionDM({ type, guild, reason, duration, moderator = null, caseNumber = null, expiresAt = null }) {
  return sanctionPayload({ type, guild, reason, duration, moderator: moderator ?? guild?.client?.user ?? 'Petto', caseNumber, expiresAt, audience: 'member' });
}

module.exports = { buildSanctionDM };
