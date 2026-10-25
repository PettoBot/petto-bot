const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');
const { EMOJI, TYPE_EMOJI } = require('./emojis');
const { semanticColor, colorFromText } = require('./colors');
const { t, tn, currentLanguage } = require('../i18n');
const { typeName, displayReason, reasonText, capitalize } = require('./caseFormat');

const COLORS = {
  ban: 0xfe6465,
  hardban: 0xfe6465,
  tempban: 0xfe6465,
  softban: 0xfe6465,
  unban: 0xa5ea7a,
  kick: 0xfed53c,
  mute: 0xfed53c,
  tempmute: 0xfed53c,
  unmute: 0xa5ea7a,
  warn: 0xfed53c,
  jail: 0xfed53c,
  unjail: 0xa5ea7a,
};

// The sanctions that have their own sentence in the confirmation; any other type uses `moderation.card.unknown`.
const CONFIRM_TYPES = new Set(['ban', 'hardban', 'tempban', 'softban', 'unban', 'kick', 'mute', 'tempmute', 'unmute', 'warn', 'jail', 'unjail']);

/** The confirmation of a sanction: a line of plain text, with the hammer (the alert for a warn) and the case number small under it. */
function buildCaseCard({ caseNumber, type, target, reason, duration, lang = currentLanguage() }) {
  const emoji = type === 'warn' ? EMOJI.ALERT : EMOJI.HAMMER;
  const name = target?.username ?? target?.user?.username ?? String(target?.id ?? target);
  const mention = target?.id ? ` (<@${target.id}>)` : '';
  const vars = { emoji, name, mention, duration, reason: displayReason(reason, lang) || t(lang, 'moderation.card.noReason') };
  const sentence = t(lang, `moderation.card.${CONFIRM_TYPES.has(type) ? type : 'unknown'}${duration ? 'Timed' : ''}`, vars);
  return new TextDisplayBuilder().setContent(`${sentence}${caseNumber != null ? `\n${t(lang, 'moderation.card.caseNumber', { number: caseNumber })}` : ''}`);
}

/** A single-block Components V2 card for plain status text (errors, confirmations) once a reply is already in V2 mode. */
function textCard(text, color, { keep = false } = {}) {
  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  // Only green and red (given, or from the icon the text starts with); `keep` is for the sanction cards, which keep their own colors.
  // `null` is a card with no color at all; with no color given, the icon the text starts with decides.
  const accent = keep && Number.isInteger(color) ? color : (semanticColor(color) ?? (color === undefined ? colorFromText(text) : null));
  return accent === null ? container : container.setAccentColor(accent);
}

// The list of cases has no color, except when it is the list of one member: it then takes the color of their latest sanction.
const LIST_ACCENT = null;
const REASON_PREVIEW_LENGTH = 180;

function unixSeconds(value) {
  return Math.floor(new Date(value).getTime() / 1000);
}

function previewReason(reason, lang) {
  const text = String(reasonText(reason, lang)).replace(/\s+/g, ' ').trim();
  return text.length > REASON_PREVIEW_LENGTH ? `${text.slice(0, REASON_PREVIEW_LENGTH - 1)}…` : text;
}

/** Status shown next to a case: only timed sanctions can be running or over. */
function caseStatus(row, lang) {
  if (!row.expires_at) return row.active === false ? t(lang, 'moderation.caseList.inactive') : null;
  if (row.active === false) return t(lang, 'moderation.caseList.ended');
  return Date.parse(row.expires_at) > Date.now() ? t(lang, 'moderation.caseList.activeEnds', { time: `<t:${unixSeconds(row.expires_at)}:R>` }) : t(lang, 'moderation.caseList.ended');
}

function buildCaseListEntry(row, { showUser, lang }) {
  const emoji = TYPE_EMOJI[row.type] ?? '';
  const status = caseStatus(row, lang);
  const people = [showUser ? `<@${row.user_id}>` : null, t(lang, 'moderation.caseList.by', { moderator: `<@${row.moderator_id}>` })].filter(Boolean).join(' · ');
  return [
    `### ${[emoji, `#${row.case_number} · ${capitalize(typeName(row.type, lang))}`].filter(Boolean).join(' ')}`,
    `${people} · <t:${unixSeconds(row.created_at)}:R>${status ? ` · *${status}*` : ''}`,
    `> ${previewReason(row.reason, lang)}`,
  ].join('\n');
}

/**
 * Components V2 card for `case list`: a header (server or user), one block per
 * case, and page controls. `ids` carries the previous/next custom ids so the
 * command that owns the collector stays in charge of them.
 */
function buildCaseListCard({ rows, count, page, perPage, guild, user = null, ids = null, lang = currentLanguage() }) {
  const totalPages = Math.max(1, Math.ceil(count / perPage));
  const title = t(lang, user ? 'moderation.caseList.titleUser' : 'moderation.caseList.titleServer');
  const subject = user ? `${user} · \`${user.id}\`` : guild.name;
  const iconUrl = user
    ? user.displayAvatarURL?.({ extension: 'png', size: 256 })
    : guild.iconURL?.({ extension: 'png', size: 256 });

  const headerText = new TextDisplayBuilder().setContent([
    `### ${EMOJI.HAMMER} ${title}`,
    subject,
    tn(lang, 'moderation.caseList.summary', count, { count, page: page + 1, pages: totalPages }),
  ].join('\n'));

  const card = new ContainerBuilder().setAccentColor(user && rows[0] ? COLORS[rows[0].type] ?? LIST_ACCENT : LIST_ACCENT);

  if (iconUrl) card.addSectionComponents(new SectionBuilder().addTextDisplayComponents(headerText).setThumbnailAccessory(new ThumbnailBuilder().setURL(iconUrl)));
  else card.addTextDisplayComponents(headerText);

  card.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large));

  rows.forEach((row, index) => {
    if (index > 0) card.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    card.addTextDisplayComponents(new TextDisplayBuilder().setContent(buildCaseListEntry(row, { showUser: !user, lang })));
  });

  if (ids && totalPages > 1) {
    card
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(ids.previous).setLabel(t(lang, 'moderation.caseList.previous.button')).setEmoji(EMOJI.PREV).setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
          new ButtonBuilder().setCustomId(`${ids.previous}:page`).setLabel(`${page + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId(ids.next).setLabel(t(lang, 'moderation.caseList.next.button')).setEmoji(EMOJI.NEXT).setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
        ),
      );
  }

  return card;
}

module.exports = { buildCaseCard, buildCaseListCard, textCard, COLORS };
