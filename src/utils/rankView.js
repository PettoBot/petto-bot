// What /rank answers: the rank card, the embed with the progress bar, or both, as the server chose.
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { renderRankCard, CARD_FILE_NAME } = require('./cardService');
const { buildProgressBar } = require('./levelProgressBar');
const { t, formatNumber, currentLanguage } = require('../i18n');

/** `1h 20m` for a number of minutes. */
function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * The embed of a rank, laid out like the ones of other level bots: the member on top, the avatar at the side, one field for each
 * number (level, rank, experience, progress with the bar) and the total experience with the time at the bottom. It has no color.
 * `data` is the member's `levelData`. With `withCard` the card is
 * the picture and the avatar thumbnail is left out.
 */
function buildRankEmbed({ data, name, avatarUrl, withCard = false, date = new Date(), lang = currentLanguage() }) {
  const voice = data.source === 'voice';
  const n = (value) => formatNumber(lang, value);
  let rank = t(lang, 'leveling.rankView.notRanked');
  if (data.rank) rank = data.total ? t(lang, 'leveling.rankView.positionOf', { rank: n(data.rank), total: n(data.total) }) : `#${n(data.rank)}`;
  const embed = new EmbedBuilder().setAuthor({ name, iconURL: avatarUrl });

  const fields = [
    { name: t(lang, voice ? 'leveling.rankView.voiceLevel' : 'leveling.rankView.level'), value: n(data.level) },
    { name: t(lang, voice ? 'leveling.rankView.voiceRank' : 'leveling.rankView.serverRank'), value: rank },
    { name: t(lang, 'leveling.rankView.experience'), value: `${n(data.xpCurrent)}/${n(data.xpNeeded)} XP` },
    { name: t(lang, 'leveling.rankView.progress', { percent: data.progress }), value: buildProgressBar(data.progress) },
  ];
  if (voice) fields.push({ name: t(lang, 'leveling.rankView.voiceTime'), value: formatMinutes(data.voiceMinutes) });
  embed.addFields(fields);

  if (withCard) embed.setImage(`attachment://${CARD_FILE_NAME}`);
  else if (avatarUrl) embed.setThumbnail(avatarUrl);
  embed.setFooter({ text: t(lang, 'leveling.rankView.totalXp', { xp: n(data.xp) }) }).setTimestamp(date);
  return embed;
}

/**
 * The message for /rank. `style` is `card`, `embed` or `both`. A card that cannot be drawn leaves the embed, so a rank is
 * always answered.
 */
async function buildRankReply({ style, ctx, data, name, avatarUrl, cardName, source, lang = currentLanguage() }) {
  let file = null;
  if (style !== 'embed') file = await renderRankCard(ctx, cardName, source);
  const useCard = Boolean(file);
  if (style === 'card' && useCard) return { files: [new AttachmentBuilder(file.buffer, { name: file.name })] };
  const embed = buildRankEmbed({ data, name, avatarUrl, withCard: useCard, lang });
  return useCard ? { embeds: [embed], files: [new AttachmentBuilder(file.buffer, { name: file.name })] } : { embeds: [embed] };
}

module.exports = { formatMinutes, buildRankEmbed, buildRankReply };
