const { getCase, createCase, deactivateCase } = require('../db/modActions');
const { getHardBan } = require('../db/hardBans');
const { ensureGuild } = require('../db/guilds');
const { unjailMember } = require('./jail');
const { logSanction } = require('./caseLog');
const logger = require('./logger');

const LIFTABLE = { ban: 'unban', tempban: 'unban', hardban: 'unban', mute: 'unmute', tempmute: 'unmute', jail: 'unjail' };

function userError(message) {
  const err = new Error(message);
  err.userFacing = true;
  return err;
}

/** The sanctions that are on right now and can be lifted, as the dashboard lists them: [{ ...case, liftable }]. */
function isLiftable(row) {
  return Boolean(row && row.active && LIFTABLE[row.type]);
}

/**
 * Lifts an active sanction from its case: unbans, ends a mute (the timeout and the mute role) or releases a jailed member, and
 * writes the case of the lifting. A hardban is never lifted from here, only by the people who may lift it.
 */
async function liftSanction(guild, caseNumber, actor, reason = null) {
  const row = await getCase(guild.id, caseNumber);
  if (!row) throw userError('That case does not exist.');
  if (!isLiftable(row)) throw userError('That sanction is not on anymore.');
  const reverse = LIFTABLE[row.type];
  const note = reason || `Lifted from the dashboard by ${actor.username ?? actor.id}`;

  if (reverse === 'unban') {
    if (await getHardBan(guild.id, row.user_id).catch(() => null)) throw userError('This is a hardban. Only the server owner and the antinuke admins can lift it.');
    await guild.members.unban(row.user_id, note).catch((err) => { if (err.code !== 10026) throw err; });
  } else if (reverse === 'unmute') {
    const member = await guild.members.fetch(row.user_id).catch(() => null);
    if (member) {
      if (member.isCommunicationDisabled?.()) await member.timeout(null, note);
      const settings = await ensureGuild(guild.id);
      if (settings?.mute_role_id && member.roles.cache.has(settings.mute_role_id)) await member.roles.remove(settings.mute_role_id, note);
    }
  } else {
    const result = await unjailMember({ guild, userId: row.user_id, moderator: actor, reason: note });
    if (!result.ok) logger.warn(`Lift: ${row.user_id} was not jailed anymore in ${guild.id}.`);
  }

  await deactivateCase(guild.id, caseNumber);
  const modCase = await createCase({ guildId: guild.id, userId: row.user_id, moderatorId: actor.id, type: reverse, reason: note, source: 'dashboard' });
  await logSanction(guild.client, guild, { modCase, target: { id: row.user_id, username: row.user_id }, moderator: actor, reason: note, source: 'dashboard' });
  return { reverse, caseNumber: modCase.case_number };
}

module.exports = { LIFTABLE, isLiftable, liftSanction };
