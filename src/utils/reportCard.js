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
const { COLORS, semanticColor } = require('./colors');
const { categoryLabel } = require('./reportCategories');
const { t, currentLanguage } = require('../i18n');

const REPORT_BUTTON_PREFIX = 'rpt:';

const STATUS_STYLE = {
  open: { color: 0xfe6465, label: t('en', 'reports.status.open') },
  claimed: { color: COLORS.YELLOW, label: t('en', 'reports.status.claimed') },
  resolved: { color: COLORS.GREEN, label: t('en', 'reports.status.resolved') },
  dismissed: { color: COLORS.DEFAULT, label: t('en', 'reports.status.dismissed') },
};

/** The name of a status in `lang` ("Open", "Being handled"...). */
function statusLabel(status, lang = currentLanguage()) {
  return t(lang, `reports.status.${STATUS_STYLE[status] ? status : 'open'}`);
}

function unix(value) {
  return Math.floor(new Date(value).getTime() / 1000);
}

function reportButtonId(action, reportNumber) {
  return `${REPORT_BUTTON_PREFIX}${action}:${reportNumber}`;
}

/** The buttons staff see depend on where the report is in its life. */
function buildReportActions(row, lang = currentLanguage()) {
  const button = (action, label, style) => new ButtonBuilder().setCustomId(reportButtonId(action, row.report_number)).setLabel(label).setStyle(style);
  const closed = row.status === 'resolved' || row.status === 'dismissed';
  if (closed) return new ActionRowBuilder().addComponents(button('reopen', t(lang, 'reports.card.reopen.button'), ButtonStyle.Secondary));

  const buttons = row.status === 'open'
    ? [button('claim', t(lang, 'reports.card.claim.button'), ButtonStyle.Primary), button('resolve', t(lang, 'reports.card.resolve.button'), ButtonStyle.Success), button('dismiss', t(lang, 'reports.card.dismiss.button'), ButtonStyle.Secondary)]
    : [button('resolve', t(lang, 'reports.card.resolve.button'), ButtonStyle.Success), button('dismiss', t(lang, 'reports.card.dismiss.button'), ButtonStyle.Secondary), button('release', t(lang, 'reports.card.release.button'), ButtonStyle.Secondary)];

  // Inviting the reporter to the thread only makes sense when there is a thread and the reporter is not hidden.
  if (row.thread_id && !row.anonymous) {
    buttons.push(row.reporter_invited_at
      ? button('invite', t(lang, 'reports.card.invited.button'), ButtonStyle.Secondary).setDisabled(true)
      : button('invite', t(lang, 'reports.card.invite.button'), ButtonStyle.Secondary));
  }
  return new ActionRowBuilder().addComponents(buttons);
}

function statusLine(row, lang = currentLanguage()) {
  const status = statusLabel(row.status, lang);
  const reasonLine = (text) => `\n${t(lang, 'reports.card.reason', { reason: text.slice(0, 500) })}`;
  if (row.status === 'open') {
    const head = row.reopened_by ? t(lang, 'reports.card.statusReopened', { status, user: `<@${row.reopened_by}>` }) : t(lang, 'reports.card.status', { status });
    return `${head}${row.reopened_by && row.reopen_note ? reasonLine(row.reopen_note) : ''}`;
  }
  const when = row.handled_at ? ` <t:${unix(row.handled_at)}:R>` : '';
  const note = row.resolution_note && (row.status === 'resolved' || row.status === 'dismissed') ? reasonLine(row.resolution_note) : '';
  const head = row.handled_by ? t(lang, 'reports.card.statusBy', { status, user: `<@${row.handled_by}>` }) : t(lang, 'reports.card.status', { status });
  return `${head}${when}${note}`;
}

/**
 * Components V2 card for one report. Built from the stored row, so it can be rebuilt each time staff change the
 * status. `pingRoleIds` are mentioned at the top of a new report and left out of later edits.
 */
function buildReportCard(row, { pingRoleIds = [], withActions = true, lang = currentLanguage() } = {}) {
  const style = STATUS_STYLE[row.status] ?? STATUS_STYLE.open;
  const lines = [`### ${t(lang, 'reports.card.title', { emoji: row.urgent ? EMOJI.REPORT_IMPORTANT : EMOJI.REPORT, number: row.report_number, category: categoryLabel(row.category, lang) })}`];

  if (pingRoleIds.length) lines.push(pingRoleIds.map((id) => `<@&${id}>`).join(' '));
  lines.push(t(lang, 'reports.card.reportedUser', { user: `<@${row.reported_user_id}>`, id: row.reported_user_id }));
  lines.push(row.anonymous ? t(lang, 'reports.card.reportedByAnonymous') : t(lang, 'reports.card.reportedBy', { user: `<@${row.reporter_id}>`, id: row.reporter_id }));
  if (row.source_channel_id) lines.push(t(lang, 'reports.card.channel', { channel: `<#${row.source_channel_id}>` }));
  if (row.message_link) lines.push(t(lang, 'reports.card.message', { link: row.message_link }));
  if (row.message_content) lines.push(t(lang, 'reports.card.content', { content: row.message_content.slice(0, 500).replace(/\n/g, '\n> ') }));
  lines.push(row.reason ? t(lang, 'reports.card.context', { context: row.reason.slice(0, 500) }) : t(lang, 'reports.card.noContext'));
  lines.push(`-# ${t(lang, 'reports.card.reportedAt', { time: `<t:${unix(row.created_at)}:R>` })}`);

  const card = new ContainerBuilder()
    .setAccentColor(row.urgent && row.status === 'open' ? 0xff2d2d : semanticColor(style.color))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  const images = [...new Set(row.image_urls ?? [])].filter(Boolean).slice(0, 10);
  if (images.length) {
    card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(images.map((url) => new MediaGalleryItemBuilder().setURL(url))));
  }

  card.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusLine(row, lang)));
  if (withActions) card.addActionRowComponents(buildReportActions(row, lang));
  return card;
}

/** Message payload for a report. Only the roles that should be pinged are allowed to be. */
function buildReportPayload(row, { pingRoleIds = [], withActions = true, lang = currentLanguage() } = {}) {
  return {
    components: [buildReportCard(row, { pingRoleIds, withActions, lang })],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: pingRoleIds.length ? { parse: [], roles: pingRoleIds } : { parse: [] },
  };
}

module.exports = { REPORT_BUTTON_PREFIX, STATUS_STYLE, statusLabel, reportButtonId, buildReportCard, buildReportPayload };
