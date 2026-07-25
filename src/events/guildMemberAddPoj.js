const { Events } = require('discord.js');
const pojDb = require('../db/poj');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (member.user.bot) return;

    try {
      const config = await pojDb.getConfig(member.guild.id);
      if (!config?.enabled) return;

      const channels = await pojDb.listChannels(member.guild.id);
      if (!channels.length) return;

      for (const entry of channels) {
        const channel = await member.guild.channels.fetch(entry.channel_id).catch(() => null);
        if (!channel) continue;

        const msg = await channel.send({ content: `<@${member.id}>` }).catch(() => null);
        if (!msg) continue;

        // In-memory timeout instead of a persisted "pending delete" row + polling job — these
        // messages live at most a few minutes, so a missed delete on a mid-window restart is a
        // fully acceptable, rare trade-off for not needing another table/job.
        setTimeout(() => msg.delete().catch(() => {}), entry.delete_after_ms);
      }
    } catch (err) {
      logger.error(`Ping-on-join failed for ${member.id} in guild ${member.guild.id}:`, err);
    }
  },
};
