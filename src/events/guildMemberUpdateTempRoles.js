// A temporary role (`/role temp`) that somebody takes away by hand before its time is up is forgotten: otherwise the expiry would take it away again
// if the member is given the role later, for good or for another while.
const { Events } = require('discord.js');
const tempRolesDb = require('../db/tempRoles');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    try {
      // Only when the old copy of the member is known and a role is gone from it (nothing is asked of the database for any other update).
      if (oldMember.partial || !oldMember.roles?.cache?.size) return;
      const removed = [...oldMember.roles.cache.keys()].filter((id) => id !== newMember.guild.id && !newMember.roles.cache.has(id));
      if (removed.length) await tempRolesDb.clearTempRoles(newMember.guild.id, newMember.id, removed);
    } catch (err) {
      logger.warn(`Temporary roles: could not forget the removed roles of ${newMember?.id} in guild ${newMember?.guild?.id}:`, err);
    }
  },
};
