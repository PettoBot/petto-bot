const { Events } = require('discord.js');
const pojDb = require('../db/poj');
const logger = require('../utils/logger');

// A ping that cannot be posted (the bot may not see the channel or write in it) used to fail without a word: the log says it, once an hour for each channel.
const noted = new Map(); // `${guild}:${channel}` -> when it was last said
function noteProblem(guildId, channelId, why) {
  const key = `${guildId}:${channelId}`;
  if (Date.now() - (noted.get(key) ?? 0) < 60 * 60_000) return;
  if (noted.size > 500) noted.clear();
  noted.set(key, Date.now());
  logger.warn(`Ping-on-join: could not post in channel ${channelId} of guild ${guildId}: ${why}`); // i18n-ignore: a log line for the operator
}

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
        if (!channel) { noteProblem(member.guild.id, entry.channel_id, 'the channel does not exist any more'); continue; } // i18n-ignore: part of a log line for the operator

        const msg = await channel.send({ content: `<@${member.id}>` }).catch((error) => { noteProblem(member.guild.id, entry.channel_id, error.message); return null; });
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
