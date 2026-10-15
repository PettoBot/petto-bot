const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { sendAs } = require('./senderIdentity');
const { getTemplate } = require('../db/embedTemplates');
const { build } = require('./embedBuilder');
const { resolve } = require('./embedVariables');
const { extractReactReplies, applyReactReplies } = require('./messageFlags');
const logger = require('./logger');
const { t, tn, currentLanguage } = require('../i18n');

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
  lang = currentLanguage(),
}) {
  const enterText = entryMode === 'reaction'
    ? t(lang, 'giveaways.card.enterHint.reaction', { reaction })
    : t(lang, 'giveaways.card.enterHint.click', { button: t(lang, 'giveaways.card.enter.button') });
  const time = `<t:${endsAtUnix}:R>`;

  const lines = [
    `• ${ended ? t(lang, 'giveaways.card.ended') : enterText}`,
    `• ${ended ? t(lang, 'giveaways.card.endedAt', { time }) : t(lang, 'giveaways.card.endsAt', { time })}`,
    `• ${t(lang, 'giveaways.card.host', { host: `<@${hostId}>` })}`,
  ];

  if (presetText) {
    lines.push('', t(lang, 'giveaways.card.extraEntries'), presetText);
  }

  const embed = new EmbedBuilder()
    .setColor(GIVEAWAY_COLOR)
    .setTitle(`🎉 ${t(lang, 'giveaways.card.title')}`)
    .setDescription(lines.join('\n'))
    .setAuthor({
      name: String(prize).slice(0, 256),
      ...(hostAvatar ? { iconURL: hostAvatar } : {}),
    })
    .setFooter({
      text: `${tn(lang, 'giveaways.card.luckyWinners', winnersCount, { count: winnersCount })} • ${tn(lang, 'giveaways.card.entries', entriesCount, { count: entriesCount })}`,
    });

  if (hostName) embed.setTimestamp();
  return embed;
}

function buildEnterRow(giveawayId, { disabled = false, lang = currentLanguage() } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gw_enter::${giveawayId}`).setLabel(t(lang, 'giveaways.card.enter.button')).setStyle(ButtonStyle.Primary).setDisabled(disabled),
  );
}

function buildClaimRow(winnerId, lang = currentLanguage()) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gw_accept::${winnerId}`).setLabel(t(lang, 'giveaways.card.accept.button')).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`gw_deny::${winnerId}`).setLabel(t(lang, 'giveaways.card.deny.button')).setStyle(ButtonStyle.Danger),
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
        const sent = await sendAs(target, 'giveaways', { content: payload.content, embeds: payload.embeds, components: payload.components, files: payload.files });
        if (reactReplies.length) await applyReactReplies(sent, reactReplies);
        return;
      }
      logger.warn(`Giveaway response template "${embedTemplateName}" not found in guild ${guildId}, falling back.`);
    }

    const text = cleanedText || fallback;
    if (text) {
      const resolved = await resolve(text, ctx);
      const sent = await sendAs(target, 'giveaways', { content: resolved });
      if (reactReplies.length) await applyReactReplies(sent, reactReplies);
    }
  } catch (err) {
    logger.error(`Failed to send giveaway response in guild ${guildId}:`, err);
  }
}

module.exports = { buildEntryCard, buildEnterRow, buildClaimRow, sendGiveawayResponse, GIVEAWAY_COLOR };
