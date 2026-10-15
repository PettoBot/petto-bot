const { ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize, SectionBuilder, ThumbnailBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { EMOJI } = require('./emojis');
const { t, currentLanguage } = require('../i18n');

const BUTTON_STYLE_MAP = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };

function buildPanelButtonRow(categories) {
  const row = new ActionRowBuilder();
  for (const cat of categories.slice(0, 5)) {
    const btn = new ButtonBuilder().setCustomId(`tk_open::${cat.key}`).setLabel(cat.label).setStyle(BUTTON_STYLE_MAP[cat.button_style] ?? ButtonStyle.Primary);
    if (cat.emoji) btn.setEmoji(cat.emoji);
    row.addComponents(btn);
  }
  return row;
}

function buildPanelSelectRow(categories, placeholder, lang) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('tk_open_select')
    .setPlaceholder(String(placeholder || t(lang, 'tickets.panel.placeholder.menu')).slice(0, 150))
    .addOptions(
      categories.slice(0, 25).map((cat) => {
        const opt = new StringSelectMenuOptionBuilder().setLabel(cat.label).setValue(cat.key);
        if (cat.description) opt.setDescription(cat.description.slice(0, 100));
        if (cat.emoji) opt.setEmoji(cat.emoji);
        return opt;
      }),
    );
  return new ActionRowBuilder().addComponents(menu);
}

/** Row(s) of open-ticket components for a panel message, given its style + categories. Button style caps at 5 (one row); use select for more. */
function buildPanelRows(style, categories, { placeholder = null, lang = currentLanguage() } = {}) {
  if (!categories.length) return [];
  return style === 'select' ? [buildPanelSelectRow(categories, placeholder, lang)] : [buildPanelButtonRow(categories)];
}

/** The color of a panel when the server picked none: the green of the other cards of Petto. */
const DEFAULT_PANEL_COLOR = 0xa5ea7a;

/**
 * The usual panel (Components V2): a picture on top if there is one, the title, the text, and a small line under it. The buttons or the
 * menu go under the card. `color` is the stripe of the card (a number, or null for the green of Petto).
 */
function buildPanelFallbackCard({ title, description, color = null, imageUrl = null, footer = null, lang = currentLanguage() }) {
  const container = new ContainerBuilder().setAccentColor(Number.isInteger(color) ? color : DEFAULT_PANEL_COLOR);
  if (imageUrl && /^https:\/\//i.test(imageUrl)) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl)));
  const lines = [];
  if (title) lines.push(`### ${title}`);
  lines.push(description || t(lang, 'tickets.panel.defaultDescription'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  if (footer) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${String(footer).slice(0, 300)}`));
  }
  return container;
}

/** Fills {user}, {username}, {category}, {server} and {number} in a category's own welcome text. */
function renderWelcomeText(template, { opener, categoryLabel, guildName, ticketNumber }) {
  return String(template)
    .replace(/\{user\}/gi, String(opener))
    .replace(/\{username\}/gi, opener?.username ?? String(opener))
    .replace(/\{category\}/gi, categoryLabel ?? '')
    .replace(/\{server\}/gi, guildName ?? '')
    .replace(/\{number\}/gi, String(ticketNumber ?? '').padStart(4, '0'))
    .slice(0, 1800);
}

/** Fallback plain-text welcome card (Components V2) when a category has no linked welcome embed template. */
function buildWelcomeFallbackCard({ opener, categoryLabel, pingText, welcomeMessage, guildName, ticketNumber, lang = currentLanguage() }) {
  const lines = [];
  if (pingText) lines.push(pingText);
  const text = welcomeMessage
    ? renderWelcomeText(welcomeMessage, { opener, categoryLabel, guildName, ticketNumber })
    : t(lang, 'tickets.welcome.default', { user: String(opener) });
  lines.push(`### ${EMOJI.STAR} ${categoryLabel}`, text);
  return new ContainerBuilder().setAccentColor(0x4b4f59).addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
}

/** Control row for an open ticket: claim, close, on-demand transcript. */
function buildTicketControlRow(ticketId, lang = currentLanguage()) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tk_claim::${ticketId}`).setLabel(t(lang, 'tickets.controls.claim.button')).setEmoji(EMOJI.STAR).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tk_close::${ticketId}`).setLabel(t(lang, 'tickets.controls.close.button')).setEmoji(EMOJI.DENY).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`tk_transcript::${ticketId}`).setLabel(t(lang, 'tickets.controls.transcript.button')).setStyle(ButtonStyle.Secondary),
  );
}

/** Yes/no buttons under a staff member's request to close: only the person who opened the ticket can answer. */
function buildCloseRequestRow(ticketId, lang = currentLanguage()) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tk_closeyes::${ticketId}`).setLabel(t(lang, 'tickets.controls.closeYes.button')).setEmoji(EMOJI.APPROVE).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tk_closeno::${ticketId}`).setLabel(t(lang, 'tickets.controls.closeNo.button')).setStyle(ButtonStyle.Secondary),
  );
}

/** Second control row for an open ticket: staff-only member management (enforced on click, not by hiding). */
function buildTicketMemberRow(ticketId, lang = currentLanguage()) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tk_addmember::${ticketId}`).setLabel(t(lang, 'tickets.controls.addMember.button')).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tk_removemember::${ticketId}`).setLabel(t(lang, 'tickets.controls.removeMember.button')).setStyle(ButtonStyle.Secondary),
  );
}

/** Components V2 DM card sent to the ticket opener when their ticket is closed — server/closer/reason/channel fields plus the closer's avatar as a large thumbnail. `hideCloser` drops the "Closed by" line and swaps the thumbnail for the server icon, for servers that don't want individual staff called out. */
function buildTicketClosedCard({ ticket, guild, actor, reason, channel, hideCloser = false, lang = currentLanguage() }) {
  const lines = [
    t(lang, 'tickets.closedDm.title', { emoji: EMOJI.DENY, number: String(ticket.ticket_number).padStart(4, '0') }),
    t(lang, 'tickets.closedDm.server', { server: guild.name }),
    ...(hideCloser ? [] : [t(lang, 'tickets.closedDm.closedBy', { user: `${actor}` })]),
    t(lang, 'tickets.closedDm.reason', { reason: reason || t(lang, 'tickets.close.noReason') }),
    t(lang, 'tickets.closedDm.channel', { channel: channel ? `<#${channel.id}>` : t(lang, 'tickets.unknown') }),
    '',
    t(lang, 'tickets.closedDm.transcript'),
  ];

  const text = new TextDisplayBuilder().setContent(lines.join('\n'));
  const avatar = hideCloser ? guild.iconURL({ extension: 'png', size: 256 }) : actor.displayAvatarURL({ extension: 'png', size: 256 });

  const container = new ContainerBuilder().setAccentColor(0xfe6465);
  if (avatar) {
    container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)));
  } else {
    container.addTextDisplayComponents(text);
  }
  return container;
}

/** Five star-rating buttons, sent alongside the closed-ticket DM when rating is enabled. */
function buildRatingRow(ticketId) {
  const row = new ActionRowBuilder();
  for (let n = 1; n <= 5; n++) {
    row.addComponents(new ButtonBuilder().setCustomId(`tk_rate::${ticketId}::${n}`).setLabel(`${n}⭐`).setStyle(ButtonStyle.Secondary));
  }
  return row;
}

/** A single Link-style button pointing at the web transcript viewer, or null if no link is available (web server not configured). Link buttons need no customId — clicking just navigates, no interaction fires. */
function buildTranscriptLinkRow(link, lang = currentLanguage()) {
  if (!link) return null;
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(t(lang, 'tickets.controls.viewTranscript.button')).setStyle(ButtonStyle.Link).setURL(link));
}

/** Control row shown once a ticket is closed (locked): reopen, hard-delete, and (if available) view the transcript online. */
function buildClosedControlRow(ticketId, transcriptLink, lang = currentLanguage()) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tk_reopen::${ticketId}`).setLabel(t(lang, 'tickets.controls.reopen.button')).setEmoji(EMOJI.APPROVE).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tk_delete::${ticketId}`).setLabel(t(lang, 'tickets.controls.delete.button')).setEmoji(EMOJI.HAMMER).setStyle(ButtonStyle.Danger),
  );
  if (transcriptLink) row.addComponents(new ButtonBuilder().setLabel(t(lang, 'tickets.controls.viewTranscript.button')).setStyle(ButtonStyle.Link).setURL(transcriptLink));
  return row;
}

module.exports = {
  DEFAULT_PANEL_COLOR,
  buildPanelRows,
  buildPanelFallbackCard,
  buildWelcomeFallbackCard,
  renderWelcomeText,
  buildTicketControlRow,
  buildTicketMemberRow,
  buildCloseRequestRow,
  buildClosedControlRow,
  buildTranscriptLinkRow,
  buildTicketClosedCard,
  buildRatingRow,
};
