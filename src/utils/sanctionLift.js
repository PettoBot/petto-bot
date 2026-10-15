const { getCase, createCase, deactivateCase } = require('../db/modActions');
const { getHardBan } = require('../db/hardBans');
const { ensureGuild } = require('../db/guilds');
const { unjailMember } = require('./jail');
const { logSanction } = require('./caseLog');
const logger = require('./logger');
const { t, currentLanguage } = require('../i18n');

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
  const lang = currentLanguage();
  const row = await getCase(guild.id, caseNumber);
  if (!row) throw userError(t(lang, 'moderation.lift.error.noCase'));
  if (!isLiftable(row)) throw userError(t(lang, 'moderation.lift.error.notActive'));
  const reverse = LIFTABLE[row.type];
  // i18n-ignore: saved as the reason of the case in English, like before; caseFormat.displayReason translates it when shown
  const note = reason || `Lifted from the dashboard by ${actor.username ?? actor.id}`;

  if (reverse === 'unban') {
    if (await getHardBan(guild.id, row.user_id).catch(() => null)) throw userError(t(lang, 'moderation.lift.error.hardban'));
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
