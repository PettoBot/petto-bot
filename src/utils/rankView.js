// What /rank answers: the rank card, the embed with the progress bar, or both, as the server chose.
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { renderRankCard, CARD_FILE_NAME } = require('./cardService');
const { buildProgressBar } = require('./levelProgressBar');

const n = (value) => Number(value).toLocaleString('en-US');

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
function buildRankEmbed({ data, name, avatarUrl, withCard = false, date = new Date() }) {
  const voice = data.source === 'voice';
  const embed = new EmbedBuilder().setAuthor({ name, iconURL: avatarUrl });

  const fields = [
    { name: voice ? 'Voice Level' : 'Level', value: n(data.level) },
    { name: voice ? 'Voice Rank' : 'Server Rank', value: data.rank ? `#${n(data.rank)}${data.total ? ` out of ${n(data.total)}` : ''}` : 'Not ranked yet' },
    { name: 'Experience', value: `${n(data.xpCurrent)}/${n(data.xpNeeded)} XP` },
    { name: `Progress (${data.progress}%)`, value: buildProgressBar(data.progress) },
  ];
  if (voice) fields.push({ name: 'Time in voice', value: formatMinutes(data.voiceMinutes) });
  embed.addFields(fields);

  if (withCard) embed.setImage(`attachment://${CARD_FILE_NAME}`);
  else if (avatarUrl) embed.setThumbnail(avatarUrl);
  embed.setFooter({ text: `Total Experience: ${n(data.xp)}` }).setTimestamp(date);
  return embed;
}

/**
 * The message for /rank. `style` is `card`, `embed` or `both`. A card that cannot be drawn leaves the embed, so a rank is
 * always answered.
 */
async function buildRankReply({ style, ctx, data, name, avatarUrl, cardName, source }) {
  let file = null;
  if (style !== 'embed') file = await renderRankCard(ctx, cardName, source);
  const useCard = Boolean(file);
  if (style === 'card' && useCard) return { files: [new AttachmentBuilder(file.buffer, { name: file.name })] };
  const embed = buildRankEmbed({ data, name, avatarUrl, withCard: useCard });
  return useCard ? { embeds: [embed], files: [new AttachmentBuilder(file.buffer, { name: file.name })] } : { embeds: [embed] };
}

module.exports = { formatMinutes, buildRankEmbed, buildRankReply };
