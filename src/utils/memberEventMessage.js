const { MessageFlags } = require('discord.js');
const { getTemplate } = require('../db/embedTemplates');
const { build } = require('./embedBuilder');
const { resolve } = require('./embedVariables');
const { textCard } = require('./caseCard');
const logger = require('./logger');

const COLORS = { welcome: 0xa5ea7a, leave: 0xfe6465, boost: 0xfed53c, boost_level: 0xfed53c };

// Admin-authored announcement text (staff decided what it says, e.g. "{user} welcome!") —
// unlike auto-generated content, it's fine (expected, even) for this to actually ping.
const ANNOUNCEMENT_MENTIONS = { parse: ['users', 'roles'] };

/**
 * Sends a welcome/leave/boost/boost_level announcement: a saved /embed template
 * (resolved with variables) if configured, otherwise plain text (also variable-
 * resolved) rendered as a Components V2 card. No-ops silently if neither is set
 * — matches the source bots, where "channel + message both required" is how a
 * trigger gets turned off without a separate enabled flag.
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
      await channel.send({ components: [textCard(resolved, COLORS[kind] ?? 0x8399ff)], flags: MessageFlags.IsComponentsV2, allowedMentions: ANNOUNCEMENT_MENTIONS });
    }
  } catch (err) {
    logger.error(`Failed to send member event "${kind}" in guild ${guild.id}:`, err);
  }
}

module.exports = { sendMemberEvent };
