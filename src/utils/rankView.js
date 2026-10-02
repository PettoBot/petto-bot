// What /rank answers: the rank card, the embed with the progress bar, or both, as the server chose.
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { renderRankCard, CARD_FILE_NAME } = require('./cardService');
const { buildProgressBar } = require('./levelProgressBar');

const FALLBACK_COLOR = 0x8399ff;
const VOICE_COLOR = 0x3ddc97;

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
 * The embed of a rank. `data` is the member's `levelData`; `week` is their weekly standing (`{ xp, position }`) or null.
 * With `withCard` the card is the picture and the avatar thumbnail is left out.
 */
function buildRankEmbed({ data, name, avatarUrl, color, week = null, withCard = false, date = new Date() }) {
  const voice = data.source === 'voice';
  const rankText = data.rank ? `Rank **#${n(data.rank)}**${data.total ? ` of ${n(data.total)}` : ''}` : 'Not ranked yet';
  const lines = [
    `## ${voice ? 'Voice level' : 'Level'} ${n(data.level)}`,
    rankText,
    '',
    `${buildProgressBar(data.progress)} **${data.progress}%**`,
    `\`${n(data.xpCurrent)} / ${n(data.xpNeeded)} XP\` · ${n(data.xpToNext)} to level ${n(data.level + 1)}`,
  ];
  const embed = new EmbedBuilder()
    .setColor(color ?? (voice ? VOICE_COLOR : FALLBACK_COLOR))
    .setAuthor({ name, iconURL: avatarUrl })
    .setDescription(lines.join('\n'));

  const fields = [{ name: 'Total XP', value: n(data.xp), inline: true }];
  fields.push(voice
    ? { name: 'Time in voice', value: formatMinutes(data.voiceMinutes), inline: true }
    : { name: 'Messages', value: n(data.messages), inline: true });
  if (data.streak > 0) fields.push({ name: 'Streak', value: `${n(data.streak)} day${data.streak === 1 ? '' : 's'}${data.bestStreak > data.streak ? ` (best ${n(data.bestStreak)})` : ''}`, inline: true });
  if (week) fields.push({ name: 'This week', value: `#${n(week.position)} · ${n(week.xp)} XP`, inline: true });
  embed.addFields(fields);

  if (withCard) embed.setImage(`attachment://${CARD_FILE_NAME}`);
  else if (avatarUrl) embed.setThumbnail(avatarUrl);
  embed.setFooter({ text: `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` });
  return embed;
}

/**
 * The message for /rank. `style` is `card`, `embed` or `both`. A card that cannot be drawn leaves the embed, so a rank is
 * always answered.
 */
async function buildRankReply({ style, ctx, data, name, avatarUrl, color, week, cardName, source }) {
  let file = null;
  if (style !== 'embed') file = await renderRankCard(ctx, cardName, source);
  const useCard = Boolean(file);
  if (style === 'card' && useCard) return { files: [new AttachmentBuilder(file.buffer, { name: file.name })] };
  const embed = buildRankEmbed({ data, name, avatarUrl, color, week, withCard: useCard });
  return useCard ? { embeds: [embed], files: [new AttachmentBuilder(file.buffer, { name: file.name })] } : { embeds: [embed] };
}

module.exports = { formatMinutes, buildRankEmbed, buildRankReply };
