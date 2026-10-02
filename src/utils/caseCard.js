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

const COLORS = {
  ban: 0xfe6465,
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

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Components V2 case card — used for both the command reply and the mod-log channel. */
function buildCaseCard({ caseNumber, type, target, moderator, reason, duration }) {
  const emoji = TYPE_EMOJI[type] ?? '';
  const lines = [
    `### ${emoji} Case #${caseNumber} · ${capitalize(type)}`.trim(),
    `**User:** ${target} (\`${target.id ?? target}\`)`,
    `**Moderator:** ${moderator}`,
  ];
  if (duration) lines.push(`**Duration:** ${duration}`);
  lines.push(`**Reason:** ${reason || 'No reason provided.'}`);

  return new ContainerBuilder()
    .setAccentColor(COLORS[type] ?? 0x4b4f59)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
}

/** A single-block Components V2 card for plain status text (errors, confirmations) once a reply is already in V2 mode. */
function textCard(text, color = 0x4b4f59) {
  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  return color === null ? container : container.setAccentColor(color); // null: a card with no color
}

const LIST_ACCENT = 0x8c7cff;
const REASON_PREVIEW_LENGTH = 180;

function unixSeconds(value) {
  return Math.floor(new Date(value).getTime() / 1000);
}

function previewReason(reason) {
  const text = String(reason || 'No reason provided.').replace(/\s+/g, ' ').trim();
  return text.length > REASON_PREVIEW_LENGTH ? `${text.slice(0, REASON_PREVIEW_LENGTH - 1)}…` : text;
}

/** Status shown next to a case: only timed sanctions can be running or over. */
function caseStatus(row) {
  if (!row.expires_at) return row.active === false ? 'Inactive' : null;
  if (row.active === false) return 'Ended';
  return Date.parse(row.expires_at) > Date.now() ? `Active · ends <t:${unixSeconds(row.expires_at)}:R>` : 'Ended';
}

function buildCaseListEntry(row, { showUser }) {
  const emoji = TYPE_EMOJI[row.type] ?? '';
  const status = caseStatus(row);
  const people = [showUser ? `<@${row.user_id}>` : null, `by <@${row.moderator_id}>`].filter(Boolean).join(' · ');
  return [
    `### ${[emoji, `#${row.case_number} · ${capitalize(row.type)}`].filter(Boolean).join(' ')}`,
    `${people} · <t:${unixSeconds(row.created_at)}:R>${status ? ` · *${status}*` : ''}`,
    `> ${previewReason(row.reason)}`,
  ].join('\n');
}

/**
 * Components V2 card for `case list`: a header (server or user), one block per
 * case, and page controls. `ids` carries the previous/next custom ids so the
 * command that owns the collector stays in charge of them.
 */
function buildCaseListCard({ rows, count, page, perPage, guild, user = null, ids = null }) {
  const totalPages = Math.max(1, Math.ceil(count / perPage));
  const title = user ? 'Infractions' : 'Moderation cases';
  const subject = user ? `${user} · \`${user.id}\`` : guild.name;
  const iconUrl = user
    ? user.displayAvatarURL?.({ extension: 'png', size: 256 })
    : guild.iconURL?.({ extension: 'png', size: 256 });

  const headerText = new TextDisplayBuilder().setContent([
    `## ${EMOJI.HAMMER} ${title}`,
    subject,
    `-# ${count} ${count === 1 ? 'case' : 'cases'} · Page ${page + 1} of ${totalPages}`,
  ].join('\n'));

  const card = new ContainerBuilder().setAccentColor(user && rows[0] ? COLORS[rows[0].type] ?? LIST_ACCENT : LIST_ACCENT);

  if (iconUrl) card.addSectionComponents(new SectionBuilder().addTextDisplayComponents(headerText).setThumbnailAccessory(new ThumbnailBuilder().setURL(iconUrl)));
  else card.addTextDisplayComponents(headerText);

  card.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large));

  rows.forEach((row, index) => {
    if (index > 0) card.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    card.addTextDisplayComponents(new TextDisplayBuilder().setContent(buildCaseListEntry(row, { showUser: !user })));
  });

  if (ids && totalPages > 1) {
    card
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(ids.previous).setLabel('Previous').setEmoji(EMOJI.PREV).setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
          new ButtonBuilder().setCustomId(`${ids.previous}:page`).setLabel(`${page + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId(ids.next).setLabel('Next').setEmoji(EMOJI.NEXT).setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
        ),
      );
  }

  return card;
}

module.exports = { buildCaseCard, buildCaseListCard, textCard, COLORS };
