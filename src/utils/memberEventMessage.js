const { getTemplate } = require('../db/embedTemplates');
const { build } = require('./embedBuilder');
const { resolve } = require('./embedVariables');
const { extractReactReplies, applyReactReplies } = require('./messageFlags');
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

  // {reactreply:emoji} can appear in the message text regardless of whether it ends up sent
  // as plain text or an embed template takes over — strip it out before either path runs.
  const { text: cleanedText, emojis } = messageText ? extractReactReplies(messageText) : { text: '', emojis: [] };

  try {
    if (embedTemplateName) {
      const doc = await getTemplate(guild.id, embedTemplateName);
      if (doc) {
        const payload = await build(doc.data, ctx);
        const sent = await channel.send({ content: payload.content, embeds: payload.embeds, components: payload.components, allowedMentions: ANNOUNCEMENT_MENTIONS });
        if (emojis.length) await applyReactReplies(sent, emojis);
        return;
      }
      logger.warn(`Member event "${kind}" in guild ${guild.id}: embed template "${embedTemplateName}" not found, falling back to plain text.`);
    }

    if (cleanedText) {
      const resolved = await resolve(cleanedText, ctx);
      const sent = await channel.send({ content: resolved, allowedMentions: ANNOUNCEMENT_MENTIONS });
      if (emojis.length) await applyReactReplies(sent, emojis);
    } else if (emojis.length) {
      // Reactions were the only thing configured (no other text) — nothing to react to without
      // a message, so this is a no-op by design rather than sending an empty message just to react to it.
      logger.warn(`Member event "${kind}" in guild ${guild.id}: {reactreply} with no other text has nothing to react to.`);
    }
  } catch (err) {
    logger.error(`Failed to send member event "${kind}" in guild ${guild.id}:`, err);
  }
}

module.exports = { sendMemberEvent };
