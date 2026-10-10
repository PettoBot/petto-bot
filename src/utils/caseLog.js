const { sendLog } = require('../logging/engine');
const { buildSanctionCard } = require('./sanctionDesign');
const { sanctionLogEmbed, previousSanctions } = require('./sanctionTemplates');

/**
 * Logs a single moderation case to the 'sanctions' category of the /logs system
 * (per-channel webhooks, same as messages/members/roles/etc). This is the only
 * place sanction actions get logged — there's no separate mod-log channel setting.
 * The entry is the sanction card in Components V2, or the server's own embed when it saved one.
 */
async function logSanction(client, guild, { modCase, target, moderator, reason, duration, source = 'moderator' }) {
  // The server's own design for the entry, when it has one.
  const custom = await sanctionLogEmbed({ modCase, guild, target, moderator, reason, duration, source });
  if (custom) return sendLog(client, guild.id, 'sanctions', custom);

  const card = buildSanctionCard({
    type: modCase.type, caseNumber: modCase.case_number, guild, target, moderator, reason, duration,
    expiresAt: modCase.expires_at, previous: await previousSanctions(guild.id, target.id, modCase.case_number),
  });
  return sendLog(client, guild.id, 'sanctions', null, { v2: [card] });
}

module.exports = { logSanction };
