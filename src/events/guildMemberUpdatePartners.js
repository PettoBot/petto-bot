// When the Partner Manager role is given to a member, they are welcomed in the welcome channel of the server (if it has one).
// Discord does not always say what roles the member had before (the member can be a partial one that was not in memory), so when it does
// not, the welcome is decided by whether this member was already welcomed, and not skipped.
const { Events } = require('discord.js');
const partnersDb = require('../db/partners');
const { sendManagerWelcome } = require('../utils/partnerWelcome');
const logger = require('../utils/logger');

const inFlight = new Set();

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    const key = `${newMember.guild?.id}:${newMember.id}`;
    let claimed = false;
    try {
      if (!newMember.guild || newMember.user?.bot) return;
      const config = await partnersDb.getConfigCached(newMember.guild.id);
      if (!config?.enabled || !config.manager_role_id) return;
      const roleId = config.manager_role_id;
      const has = newMember.roles.cache.has(roleId);
      const knew = !oldMember.partial;
      const had = knew && oldMember.roles.cache.has(roleId);
      // The role was taken away: a new one later is welcomed again.
      if (!has) {
        if (had) await partnersDb.forgetWelcomed(newMember.guild.id, newMember.id).catch(() => {});
        return;
      }
      if (had || !config.welcome_channel_id) return;
      if (inFlight.has(key)) return;
      inFlight.add(key);
      claimed = true;
      // Without the old roles, this is only a welcome if the member was not welcomed before.
      if (!knew && await partnersDb.wasWelcomed(newMember.guild.id, newMember.id).catch(() => false)) return;
      const sent = await sendManagerWelcome({ guild: newMember.guild, member: newMember, config });
      if (sent) await partnersDb.markWelcomed(newMember.guild.id, newMember.id).catch(() => {});
    } catch (error) {
      logger.error(`Partner Manager welcome failed in guild ${newMember.guild?.id}:`, error);
    } finally {
      if (claimed) inFlight.delete(key);
    }
  },
};
