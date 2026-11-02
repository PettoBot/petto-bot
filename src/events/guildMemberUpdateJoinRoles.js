// The join roles that wait for the rules (`/role join add wait:rules`) are given when the member accepts them (Membership Screening: they stop being `pending`).
const { Events } = require('discord.js');
const joinRolesDb = require('../db/joinRoles');
const { giveJoinRoles, canGiveRoles, FRESH_MS } = require('../utils/joinRoles');
const logger = require('../utils/logger');

/** The member went from pending to accepted. When the old copy of the member is not known (after a restart) a member who joined today and has no roles counts. */
function justAccepted(oldMember, newMember) {
  if (newMember.pending !== false) return false;
  if (oldMember.pending === true) return true;
  if (oldMember.pending === false) return false;
  return Boolean(newMember.joinedTimestamp) && Date.now() - newMember.joinedTimestamp < FRESH_MS && newMember.roles.cache.size <= 1;
}

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    try {
      if (!justAccepted(oldMember, newMember) || !canGiveRoles(newMember.guild)) return;
      const waiting = (await joinRolesDb.listRoles(newMember.guild.id)).filter((row) => row.after_rules);
      if (waiting.length) await giveJoinRoles(newMember, waiting);
    } catch (err) {
      logger.error(`Join roles after the rules failed for ${newMember.id} in guild ${newMember.guild.id}:`, err);
    }
  },
};
