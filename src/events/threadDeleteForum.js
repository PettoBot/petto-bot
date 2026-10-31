// Forum support: what Petto keeps about a post that was deleted goes with it (one delete by primary key).
const { Events, ChannelType } = require('discord.js');
const forumsDb = require('../db/forums');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ThreadDelete,
  async execute(thread) {
    if (!thread.guild || (thread.parent && thread.parent.type !== ChannelType.GuildForum)) return;
    try {
      await forumsDb.deletePost(thread.id);
    } catch (error) {
      logger.warn(`Forums: could not forget the post ${thread.id}: ${error.message}`);
    }
  },
};
