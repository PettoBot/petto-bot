const { Events } = require('discord.js');
const { getConfig } = require('../db/memberEvents');
const { sendMemberEvent } = require('../utils/memberEventMessage');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    try {
      const config = await getConfig(member.guild.id);
      if (!config?.leave_channel_id) return;

      const channel = await member.guild.channels.fetch(config.leave_channel_id).catch(() => null);
      if (!channel) return;

      await sendMemberEvent({
        guild: member.guild,
        channel,
        kind: 'leave',
        messageText: config.leave_message,
        embedTemplateName: config.leave_embed_template,
        ctx: { member, guild: member.guild, channel },
      });
    } catch (err) {
      logger.error(`Leave message failed for ${member.id} in guild ${member.guild.id}:`, err);
    }
  },
};
