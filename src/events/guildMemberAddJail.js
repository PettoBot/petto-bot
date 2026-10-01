const { Events } = require('discord.js');
const jailDb = require('../db/jail');
const { reapplyJail } = require('../utils/jail');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      const row = await jailDb.getJailed(member.guild.id, member.id);
      if (!row) return;
      // A jail whose timer already ran out is released by the expiry job instead of being applied again.
      if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return;
      await reapplyJail(member);
    } catch (err) {
      logger.error(`Jail re-apply failed for ${member.id} in guild ${member.guild.id}:`, err);
    }
  },
};
