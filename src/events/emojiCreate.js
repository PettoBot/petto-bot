const { Events } = require('discord.js');
const { handleEmojiCreate } = require('../logging/emojiLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildEmojiCreate,
  execute(emoji, client) {
    return handleEmojiCreate(emoji, client).catch((err) => logger.error('[emojiCreate]', err));
  },
};
