const { Events } = require('discord.js');
const { handlePollVote } = require('../logging/moreLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessagePollVoteAdd,
  execute(...args) {
    const run = (answer, userId, client) => handlePollVote('voteAdded', answer, userId, client);
    return run(...args).catch((err) => logger.error('[messagePollVoteAddLog]', err));
  },
};
