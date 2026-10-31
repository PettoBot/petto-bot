// Forum support: a post made by hand in a forum whose setup adopts them is kept, gets the guidelines and, when a tag is required, is asked for one.
const { Events } = require('discord.js');
const { adoptPost } = require('../utils/forumAutomation');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ThreadCreate,
  async execute(thread, newlyCreated) {
    if (!newlyCreated || !thread.guild) return;
    try {
      await adoptPost(thread);
    } catch (error) {
      logger.warn(`Forums: could not adopt the post ${thread.id}: ${error.message}`);
    }
  },
};
