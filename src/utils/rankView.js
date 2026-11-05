// What /levels rank answers: the rank card, the embed with the progress bar, or both, as the server chose.
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { renderRankCard, CARD_FILE_NAME } = require('./cardService');
const { buildThinBar } = require('./levelProgressBar');
const { renderRankBar } = require('./rankBar');
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
 * the picture and the avatar thumbnail is left out. With `barName` (the file name of the drawn progress bar, attached to the message) the bar
 * is the picture under the fields; without a picture the Progress field holds a thin bar of plain characters.
 */
function buildRankEmbed({ data, name, avatarUrl, withCard = false, barName = null, date = new Date(), lang = currentLanguage() }) {
  const voice = data.source === 'voice';
  const n = (value) => formatNumber(lang, value);
  let rank = t(lang, 'leveling.rankView.notRanked');
  if (data.rank) rank = data.total ? t(lang, 'leveling.rankView.positionOf', { rank: n(data.rank), total: n(data.total) }) : `#${n(data.rank)}`;
  const embed = new EmbedBuilder().setAuthor({ name, iconURL: avatarUrl });

  const fields = [
    { name: t(lang, voice ? 'leveling.rankView.voiceLevel' : 'leveling.rankView.level'), value: n(data.level) },
    { name: t(lang, voice ? 'leveling.rankView.voiceRank' : 'leveling.rankView.serverRank'), value: rank },
    { name: t(lang, 'leveling.rankView.experience'), value: `${n(data.xpCurrent)}/${n(data.xpNeeded)} XP` },
  ];
  // A member who voted for the bot sees the boost they have in this server (it is not in the data when the server turned it off).
  if (data.voteBoost && Number(data.voteBoost.endsAt) > Date.now()) {
    fields.push({ name: t(lang, 'leveling.rankView.voteBoost'), value: t(lang, 'leveling.rankView.voteBoostValue', { percent: data.voteBoost.percent, time: `<t:${Math.floor(Number(data.voteBoost.endsAt) / 1000)}:R>` }) });
  }
  // The picture of the bar goes under all the fields, so the voice time comes before the Progress title that sits just above it. Under the
  // title there is a short line (the XP missing for the next level) when a picture or the card shows the bar, and a thin line of plain characters
  // when nothing does.
  const shown = Boolean(barName) || withCard;
  const progress = { name: t(lang, 'leveling.rankView.progress', { percent: data.progress }), value: shown ? t(lang, 'leveling.rankView.toNext', { xp: n(data.xpToNext), level: n(data.level + 1) }) : buildThinBar(data.progress) };
  const time = voice ? [{ name: t(lang, 'leveling.rankView.voiceTime'), value: formatMinutes(data.voiceMinutes) }] : [];
  embed.addFields(barName && !withCard ? [...fields, ...time, progress] : [...fields, progress, ...time]);

  if (withCard) embed.setImage(`attachment://${CARD_FILE_NAME}`);
  else {
    if (barName) embed.setImage(`attachment://${barName}`);
    if (avatarUrl) embed.setThumbnail(avatarUrl);
  }
  embed.setFooter({ text: t(lang, 'leveling.rankView.totalXp', { xp: n(data.xp) }) }).setTimestamp(date);
  return embed;
}

/**
 * The message for /levels rank. `style` is `card`, `embed` or `both`. A card that cannot be drawn leaves the embed, so a rank is
 * always answered.
 */
async function buildRankReply({ style, ctx, data, name, avatarUrl, cardName, source, color = null, lang = currentLanguage() }) {
  let file = null;
  if (style !== 'embed') file = await renderRankCard(ctx, cardName, source);
  const useCard = Boolean(file);
  if (style === 'card' && useCard) return { files: [new AttachmentBuilder(file.buffer, { name: file.name })] };
  if (useCard) return { embeds: [buildRankEmbed({ data, name, avatarUrl, withCard: true, lang })], files: [new AttachmentBuilder(file.buffer, { name: file.name })] };
  // The embed with the drawn bar; when the bar cannot be drawn the embed is sent with the thin text bar instead.
  const bar = await renderRankBar({ percent: data.progress, color, voice: data.source === 'voice' }).catch(() => null);
  const embed = buildRankEmbed({ data, name, avatarUrl, barName: bar?.name ?? null, lang });
  return bar ? { embeds: [embed], files: [new AttachmentBuilder(bar.buffer, { name: bar.name })] } : { embeds: [embed] };
}

module.exports = { formatMinutes, buildRankEmbed, buildRankReply };
