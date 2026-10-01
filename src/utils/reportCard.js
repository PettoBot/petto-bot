const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} = require('discord.js');
const { EMOJI } = require('./emojis');
const { COLORS } = require('./colors');
const { categoryLabel } = require('./reportCategories');

const REPORT_BUTTON_PREFIX = 'rpt:';

const STATUS_STYLE = {
  open: { color: 0xfe6465, label: 'Open' },
  claimed: { color: COLORS.YELLOW, label: 'Being handled' },
  resolved: { color: COLORS.GREEN, label: 'Resolved' },
  dismissed: { color: COLORS.DEFAULT, label: 'Dismissed' },
};

function unix(value) {
  return Math.floor(new Date(value).getTime() / 1000);
}

function reportButtonId(action, reportNumber) {
  return `${REPORT_BUTTON_PREFIX}${action}:${reportNumber}`;
}

/** The buttons staff see depend on where the report is in its life. */
function buildReportActions(row) {
  const button = (action, label, style) => new ButtonBuilder().setCustomId(reportButtonId(action, row.report_number)).setLabel(label).setStyle(style);
  if (row.status === 'open') {
    return new ActionRowBuilder().addComponents(button('claim', 'Claim', ButtonStyle.Primary), button('resolve', 'Resolve', ButtonStyle.Success), button('dismiss', 'Dismiss', ButtonStyle.Secondary));
  }
  if (row.status === 'claimed') {
    return new ActionRowBuilder().addComponents(button('resolve', 'Resolve', ButtonStyle.Success), button('dismiss', 'Dismiss', ButtonStyle.Secondary), button('release', 'Release', ButtonStyle.Secondary));
  }
  return new ActionRowBuilder().addComponents(button('reopen', 'Reopen', ButtonStyle.Secondary));
}

function statusLine(row) {
  const style = STATUS_STYLE[row.status] ?? STATUS_STYLE.open;
  if (row.status === 'open') return `**Status:** ${style.label}`;
  const when = row.handled_at ? ` <t:${unix(row.handled_at)}:R>` : '';
  return `**Status:** ${style.label}${row.handled_by ? ` by <@${row.handled_by}>` : ''}${when}`;
}

/**
 * Components V2 card for one report. Built from the stored row, so it can be rebuilt each time staff change the
 * status. `pingRoleIds` are mentioned at the top of a new report and left out of later edits.
 */
function buildReportCard(row, { pingRoleIds = [], withActions = true } = {}) {
  const style = STATUS_STYLE[row.status] ?? STATUS_STYLE.open;
  const lines = [`### ${row.urgent ? EMOJI.REPORT_IMPORTANT : EMOJI.REPORT} Report #${row.report_number} · ${categoryLabel(row.category)}`];

  if (pingRoleIds.length) lines.push(pingRoleIds.map((id) => `<@&${id}>`).join(' '));
  lines.push(`**Reported user:** <@${row.reported_user_id}> (\`${row.reported_user_id}\`)`);
  lines.push(`**Reported by:** ${row.anonymous ? 'Anonymous' : `<@${row.reporter_id}> (\`${row.reporter_id}\`)`}`);
  if (row.source_channel_id) lines.push(`**Channel:** <#${row.source_channel_id}>`);
  if (row.message_link) lines.push(`**Message:** [Jump to message](${row.message_link})`);
  if (row.message_content) lines.push(`**Content:**\n> ${row.message_content.slice(0, 500).replace(/\n/g, '\n> ')}`);
  lines.push(`**Additional context:** ${row.reason ? row.reason.slice(0, 500) : 'No additional context provided.'}`);
  lines.push(`-# Reported <t:${unix(row.created_at)}:R>`);

  const card = new ContainerBuilder()
    .setAccentColor(row.urgent && row.status === 'open' ? 0xff2d2d : style.color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  const images = [...new Set(row.image_urls ?? [])].filter(Boolean).slice(0, 10);
  if (images.length) {
    card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(images.map((url) => new MediaGalleryItemBuilder().setURL(url))));
  }

  card.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusLine(row)));
  if (withActions) card.addActionRowComponents(buildReportActions(row));
  return card;
}

/** Message payload for a report. Only the roles that should be pinged are allowed to be. */
function buildReportPayload(row, { pingRoleIds = [], withActions = true } = {}) {
  return {
    components: [buildReportCard(row, { pingRoleIds, withActions })],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: pingRoleIds.length ? { parse: [], roles: pingRoleIds } : { parse: [] },
  };
}

module.exports = { REPORT_BUTTON_PREFIX, STATUS_STYLE, reportButtonId, buildReportCard, buildReportPayload };
