// A server that gains or loses the improvement that allows a Server Tag has its members checked again, because no event comes for each member (see withServerTagState in
// service.js): the roles given for showing the tag go when it is lost and come back when it returns. The event of the server and a look every few hours (and at the start)
// both end here.
const db = require('../../db/identity');
const { syncGuild, SyncError } = require('./sync');
const { serverTagsAvailable, ownTagRule } = require('./service');
const logger = require('../logger');

/** Whether the server has a rule about its own tag (the only ones that depend on the improvement). */
async function hasOwnTagRule(guild) {
  const rules = await db.listGuildTagRules(guild.id).catch(() => []);
  return (rules ?? []).some((rule) => rule.enabled !== false && ownTagRule(rule, guild.id));
}

/** Checks everybody of the server again against its Server Tag rules. Returns whether it ran. Never throws. */
async function recheckServerTag(guild, why) {
  try {
    if (!(await hasOwnTagRule(guild))) return false;
    const result = await syncGuild(guild, { source: 'guildtag' });
    logger.info(`Server Tag of guild ${guild.id} (${why}): ${serverTagsAvailable(guild) ? 'available' : 'not available'}, ${result.added} role(s) given and ${result.removed} taken away.`); // i18n-ignore: a log line for the operator
    return true;
  } catch (error) {
    if (error instanceof SyncError) return false; // a sync of this server is already running: it will see the same state
    logger.warn(`Server Tag of guild ${guild.id}: could not check the members: ${error.message}`); // i18n-ignore: a log line for the operator
    return false;
  }
}

module.exports = { recheckServerTag, hasOwnTagRule };
