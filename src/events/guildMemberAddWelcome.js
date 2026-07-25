const { Events } = require('discord.js');
const { getConfig } = require('../db/memberEvents');
const { sendMemberEvent } = require('../utils/memberEventMessage');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      const config = await getConfig(member.guild.id);
      if (!config?.welcome_channel_id) return;

      const channel = await member.guild.channels.fetch(config.welcome_channel_id).catch(() => null);
      if (!channel) return;

      await sendMemberEvent({
        guild: member.guild,
        channel,
        kind: 'welcome',
        messageText: config.welcome_message,
        embedTemplateName: config.welcome_embed_template,
        ctx: { member, guild: member.guild, channel },
      });
    } catch (err) {
      logger.error(`Welcome message failed for ${member.id} in guild ${member.guild.id}:`, err);
    }
  },
};
