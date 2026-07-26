const { getTemplate } = require('../db/embedTemplates');
const { build } = require('./embedBuilder');
const { resolve } = require('./embedVariables');
const logger = require('./logger');

// Admin-authored announcement text (staff decided what it says, e.g. "{user} welcome!") —
// unlike auto-generated content, it's fine (expected, even) for this to actually ping.
const ANNOUNCEMENT_MENTIONS = { parse: ['users', 'roles'] };

/**
 * Sends a welcome/leave/boost/boost_level announcement: a saved /embed template
 * (resolved with variables) if configured, otherwise plain text (also variable-
 * resolved), sent as an ordinary message with no embed/card wrapper. No-ops
 * silently if neither is set — matches the source bots, where "channel +
 * message both required" is how a trigger gets turned off without a separate
 * enabled flag.
 */
async function sendMemberEvent({ guild, channel, kind, messageText, embedTemplateName, ctx }) {
  if (!messageText && !embedTemplateName) return;

  try {
    if (embedTemplateName) {
      const doc = await getTemplate(guild.id, embedTemplateName);
      if (doc) {
        const payload = await build(doc.data, ctx);
        await channel.send({ content: payload.content, embeds: payload.embeds, components: payload.components, allowedMentions: ANNOUNCEMENT_MENTIONS });
        return;
      }
      logger.warn(`Member event "${kind}" in guild ${guild.id}: embed template "${embedTemplateName}" not found, falling back to plain text.`);
    }

    if (messageText) {
      const resolved = await resolve(messageText, ctx);
      await channel.send({ content: resolved, allowedMentions: ANNOUNCEMENT_MENTIONS });
    }
  } catch (err) {
    logger.error(`Failed to send member event "${kind}" in guild ${guild.id}:`, err);
  }
}

module.exports = { sendMemberEvent };
