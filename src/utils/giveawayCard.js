const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getTemplate } = require('../db/embedTemplates');
const { build } = require('./embedBuilder');
const { resolve } = require('./embedVariables');
const { extractReactReplies, applyReactReplies } = require('./messageFlags');
const logger = require('./logger');

const GIVEAWAY_COLOR = 0xf4a6d7;

/** Default giveaway announcement embed, used when the guild hasn't selected a saved !embed template. */
function buildEntryCard({
  prize,
  hostId,
  hostName,
  hostAvatar,
  winnersCount,
  endsAtUnix,
  entryMode,
  reaction,
  entriesCount,
  ended,
  presetText = '',
}) {
  const enterText = entryMode === 'reaction'
    ? `React with ${reaction} to **enter!**`
    : 'Click **Enter Giveaway** below to enter!';

  const lines = [
    ended ? '• **This giveaway has ended.**' : `• ${enterText}`,
    ended ? `• Ended <t:${endsAtUnix}:R>` : `• Ends <t:${endsAtUnix}:R>`,
    `• Hosted by <@${hostId}>`,
  ];

  if (presetText) {
    lines.push('', '**Extra entries**', presetText);
  }

  const embed = new EmbedBuilder()
    .setColor(GIVEAWAY_COLOR)
    .setTitle('🎉 Giveaway')
    .setDescription(lines.join('\n'))
    .setAuthor({
      name: String(prize).slice(0, 256),
      ...(hostAvatar ? { iconURL: hostAvatar } : {}),
    })
    .setFooter({
      text: `${winnersCount} lucky winner${winnersCount === 1 ? '' : 's'}! • ${entriesCount} ${entriesCount === 1 ? 'entry' : 'entries'}`,
    });

  if (hostName) embed.setTimestamp();
  return embed;
}

function buildEnterRow(giveawayId, { disabled = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gw_enter::${giveawayId}`).setLabel('Enter Giveaway').setStyle(ButtonStyle.Primary).setDisabled(disabled),
  );
}

function buildClaimRow(winnerId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gw_accept::${winnerId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`gw_deny::${winnerId}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
  );
}

/**
 * Sends one of giveaway_config's configurable messages (winner/deny/claim-time/accept/no-entries),
 * each either a saved embed_templates design or plain resolved text — same convention as
 * utils/memberEventMessage.js's sendMemberEvent for welcome/leave/boost.
 */
async function sendGiveawayResponse({ target, guildId, messageText, embedTemplateName, ctx, fallback }) {
  if (!messageText && !embedTemplateName && !fallback) return;
  const { text: cleanedText, emojis: reactReplies } = messageText ? extractReactReplies(messageText) : { text: '', emojis: [] };

  try {
    if (embedTemplateName) {
      const doc = await getTemplate(guildId, embedTemplateName);
      if (doc) {
        const payload = await build(doc.data, ctx);
        const sent = await target.send({ content: payload.content, embeds: payload.embeds, components: payload.components });
        if (reactReplies.length) await applyReactReplies(sent, reactReplies);
        return;
      }
      logger.warn(`Giveaway response template "${embedTemplateName}" not found in guild ${guildId}, falling back.`);
    }

    const text = cleanedText || fallback;
    if (text) {
      const resolved = await resolve(text, ctx);
      const sent = await target.send({ content: resolved });
      if (reactReplies.length) await applyReactReplies(sent, reactReplies);
    }
  } catch (err) {
    logger.error(`Failed to send giveaway response in guild ${guildId}:`, err);
  }
}

module.exports = { buildEntryCard, buildEnterRow, buildClaimRow, sendGiveawayResponse, GIVEAWAY_COLOR };
