const { Events } = require('discord.js');
const autoThreadsDb = require('../db/autoThreads');
const { resolve } = require('../utils/embedVariables');
const { sendMemberEvent } = require('../utils/memberEventMessage');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild || !message.member) return;
    if (message.channel.isThread()) return;

    try {
      const config = await autoThreadsDb.getThread(message.guild.id, message.channel.id);
      if (!config) return;

      if (!message.guild.members.me.permissions.has('CreatePublicThreads')) return;

      const ctx = { member: message.member, guild: message.guild, channel: message.channel, message };
      const name = (await resolve(config.name_template || '{user_name}', ctx)).slice(0, 100) || 'Thread';

      const thread = await message.startThread({ name, autoArchiveDuration: config.archive_minutes }).catch((err) => {
        logger.warn(`Auto-thread creation failed in guild ${message.guild.id}:`, err.message);
        return null;
      });
      if (!thread) return;

      await sendMemberEvent({
        guild: message.guild,
        channel: thread,
        kind: 'autothread',
        messageText: config.message_text,
        embedTemplateName: config.embed_template,
        ctx: { ...ctx, channel: thread },
      });
    } catch (err) {
      logger.error(`Auto-thread handling failed for message ${message.id} in guild ${message.guild.id}:`, err);
    }
  },
};
