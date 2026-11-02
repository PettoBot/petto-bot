const { Events } = require('discord.js');
const joinRolesDb = require('../db/joinRoles');
const { giveJoinRoles, canGiveRoles } = require('../utils/joinRoles');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    const guild = member.guild;
    if (!canGiveRoles(guild)) return;

    try {
      const configured = await joinRolesDb.listRoles(guild.id);
      if (!configured.length) return;
      // A member who has not accepted the rules yet (Membership Screening) gets the roles that do not wait for them; the others come when they accept
      // (events/guildMemberUpdateJoinRoles.js).
      const pending = member.pending === true;
      await giveJoinRoles(member, configured.filter((row) => !(pending && row.after_rules)));
    } catch (err) {
      logger.error(`Join role handling failed for ${member.id} in guild ${guild.id}:`, err);
    }
  },
};
