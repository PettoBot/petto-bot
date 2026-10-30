const { Events } = require('discord.js');
const { expandMessageLinks, createLimiter, mayHaveLink } = require('../utils/messageLinks');
const { getSettings } = require('../db/messageLinks');
const { peekGuildLanguage } = require('../i18n');
const logger = require('../utils/logger');

const limiter = createLimiter();

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    // Most messages have no link: they are answered here, without a lookup or a database query.
    if (!message.guild || message.author?.bot || !mayHaveLink(message.content)) return;
    try {
      await expandMessageLinks(message, { getSettings, limiter, lang: message.pettoLang ?? peekGuildLanguage(message.guild.id), logger });
    } catch (err) {
      logger.warn(`Message link embeds failed in guild ${message.guild.id}: ${err?.message ?? err}`);
    }
  },
};
