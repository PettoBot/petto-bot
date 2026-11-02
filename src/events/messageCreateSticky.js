const { Events } = require('discord.js');
const stickyDb = require('../db/stickyMessages');
const { stickyPayload } = require('../utils/stickyPayload');
const { applyReactReplies } = require('../utils/messageFlags');
const { createStickyReposter } = require('../utils/stickyRepost');
const logger = require('../utils/logger');

// The timings are STICKY_QUIET_MS and STICKY_MAX_WAIT_MS (src/config.js); the flow is in utils/stickyRepost.js. Read on first use so
// a check that only loads this file does not need the bot's environment.
let reposter = null;
function getReposter() {
  if (!reposter) {
    const config = require('../config');
    reposter = createStickyReposter({
      getSticky: stickyDb.getSticky,
      setMessageId: stickyDb.setMessageId,
      buildPayload: stickyPayload,
      react: applyReactReplies,
      logger,
      quietMs: config.stickyQuietMs,
      maxWaitMs: config.stickyMaxWaitMs,
    });
  }
  return reposter;
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild) return;
    const sticky = await stickyDb.getSticky(message.guild.id, message.channel.id).catch(() => null);
    if (!sticky || message.id === sticky.message_id) return;
    const active = getReposter();
    if (active.isOwn(message)) return;
    active.schedule(message);
  },
};
