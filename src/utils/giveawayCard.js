const { ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getTemplate } = require('../db/giveawayTemplates');
const { build } = require('./embedBuilder');
const { resolve } = require('./embedVariables');
const { extractReactReplies, applyReactReplies } = require('./messageFlags');
const logger = require('./logger');

const GIVEAWAY_COLOR = 0xfed53c;

/** Default Components V2 announcement card, used when the guild hasn't set a custom giveaway_config.embed_template. */
function buildEntryCard({ prize, hostId, winnersCount, endsAtUnix, entryMode, reaction, entriesCount, ended }) {
  const lines = [
    `## ${prize}`,
    '',
    `**Host** <@${hostId}>`,
    `**Winners** ${winnersCount}`,
    ended ? '**Status** Ended' : `**Ends** <t:${endsAtUnix}:R>`,
    `**Entries** ${entriesCount}`,
  ];
  if (!ended) {
    lines.push('', entryMode === 'reaction' ? `React with ${reaction} to enter.` : 'Use the button below to enter or leave.');
  }

  return new ContainerBuilder().setAccentColor(GIVEAWAY_COLOR).addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
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
 * each either a saved giveaway_templates embed or plain resolved text — same convention as
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
