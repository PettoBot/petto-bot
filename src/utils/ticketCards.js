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
  const container = new ContainerBuilder().setAccentColor(Number.isInteger(color) ? color : null);
  if (imageUrl && /^https:\/\//i.test(imageUrl)) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl)));
  const lines = [];
  if (title) lines.push(`### ${title}`);
  lines.push(description || t(lang, 'tickets.panel.defaultDescription', { emoji: EMOJI.TICKET }));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  // A footer the server wrote, or (only on the usual panel, with no text of its own) a short line on how tickets work.
  const small = footer ? String(footer).slice(0, 300) : description ? null : t(lang, 'tickets.panel.defaultHint');
  if (small) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${small}`));
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

const padNumber = (number) => String(number ?? '').padStart(4, '0');

function pictureOf(target) {
  try { return target?.displayAvatarURL?.({ extension: 'png', size: 256 }) ?? null; } catch { return null; }
}

/** Text with a small picture on its right when there is one (a Section), else the text alone. */
function withThumbnail(container, text, picture) {
  const display = new TextDisplayBuilder().setContent(text);
  if (picture && /^https:\/\//i.test(picture)) return container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(display).setThumbnailAccessory(new ThumbnailBuilder().setURL(picture)));
  return container.addTextDisplayComponents(display);
}

/**
 * The usual welcome inside a new ticket (Components V2), when the category has no saved embed: the category and number, the
 * category's own text (or Petto's), who opened it and a short hint. The roles to ping go first, inside the card.
 */
function buildWelcomeFallbackCard({ opener, categoryLabel, pingText, welcomeMessage, guildName, ticketNumber, lang = currentLanguage() }) {
  const container = new ContainerBuilder().setAccentColor(0xa5ea7a);
  if (pingText) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(pingText));
  const text = welcomeMessage
    ? renderWelcomeText(welcomeMessage, { opener, categoryLabel, guildName, ticketNumber })
    : t(lang, 'tickets.welcome.default', { user: String(opener) });
  const heading = ticketNumber != null ? t(lang, 'tickets.welcome.title', { emoji: EMOJI.TICKET, category: categoryLabel, number: padNumber(ticketNumber) }) : `### ${EMOJI.TICKET} ${categoryLabel}`;
  withThumbnail(container, `${heading}\n${text}`, pictureOf(opener));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${t(lang, 'tickets.welcome.facts', { user: String(opener), category: categoryLabel })}\n-# ${t(lang, 'tickets.welcome.hint', { claim: EMOJI.TICKET_CLAIM, close: EMOJI.TICKET_CLOSE })}`));
  return container;
}

/** The notice in the ticket when a staff member claims it: who handles it now, for the member who opened it. */
function buildClaimCard({ staffId, openerId, lang = currentLanguage() }) {
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${t(lang, 'tickets.claim.cardTitle', { emoji: EMOJI.TICKET_CLAIM })}\n${t(lang, 'tickets.claim.cardText', { user: staffId })}${openerId ? `\n-# ${t(lang, 'tickets.claim.cardHint', { opener: openerId })}` : ''}`),
  );
}

/** The notice when the claim is released: any staff member can take the ticket again. */
function buildUnclaimCard({ staffId, lang = currentLanguage() }) {
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${t(lang, 'tickets.unclaim.cardTitle')}\n${t(lang, 'tickets.unclaim.cardText', { user: staffId })}`),
  );
}

/** The notice left in the channel when a ticket is closed: who closed it, the reason and what staff can do next. */
function buildTicketClosedNotice({ ticketNumber, closedByLine, reason, lang = currentLanguage() }) {
  return new ContainerBuilder().setAccentColor(0xfe6465).addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      t(lang, 'tickets.close.cardTitle', { emoji: EMOJI.TICKET_CLOSE, number: padNumber(ticketNumber) }),
      closedByLine,
      t(lang, 'tickets.log.reason', { reason }),
      `-# ${t(lang, 'tickets.close.cardHint')}`,
    ].join('\n')),
  );
}

/** Control row for an open ticket: claim, close, on-demand transcript. */
function buildTicketControlRow(ticketId, lang = currentLanguage()) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tk_claim::${ticketId}`).setLabel(t(lang, 'tickets.controls.claim.button')).setEmoji(EMOJI.TICKET_CLAIM).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tk_close::${ticketId}`).setLabel(t(lang, 'tickets.controls.close.button')).setEmoji(EMOJI.TICKET_CLOSE).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`tk_transcript::${ticketId}`).setLabel(t(lang, 'tickets.controls.transcript.button')).setEmoji(EMOJI.TICKET_TRANSCRIPT).setStyle(ButtonStyle.Secondary),
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
    new ButtonBuilder().setCustomId(`tk_addmember::${ticketId}`).setLabel(t(lang, 'tickets.controls.addMember.button')).setEmoji(EMOJI.TICKET_ADD).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tk_removemember::${ticketId}`).setLabel(t(lang, 'tickets.controls.removeMember.button')).setEmoji(EMOJI.TICKET_REMOVE).setStyle(ButtonStyle.Secondary),
  );
}

/**
 * Components V2 DM card sent to the ticket opener when their ticket is closed: the server, the category, who handled and closed it,
 * the reason, and what comes with it (the transcript, the stars to rate it). `hideCloser` drops the "Closed by" line and uses the
 * server icon instead of the closer's picture, for servers that don't want individual staff called out.
 */
function buildTicketClosedCard({ ticket, guild, actor, reason, channel, hideCloser = false, category = null, rating = false, transcript = true, lang = currentLanguage() }) {
  const facts = [
    t(lang, 'tickets.closedDm.server', { server: guild.name }),
    ...(category ? [t(lang, 'tickets.closedDm.category', { category })] : []),
    ...(ticket.claimed_by && !hideCloser ? [t(lang, 'tickets.closedDm.claimedBy', { user: `<@${ticket.claimed_by}>` })] : []),
    ...(hideCloser ? [] : [t(lang, 'tickets.closedDm.closedBy', { user: `${actor}` })]),
    t(lang, 'tickets.closedDm.reason', { reason: reason || t(lang, 'tickets.close.noReason') }),
    ...(ticket.created_at ? [t(lang, 'tickets.closedDm.opened', { time: `<t:${Math.floor(new Date(ticket.created_at).getTime() / 1000)}:R>` })] : []),
    ...(channel ? [t(lang, 'tickets.closedDm.channel', { channel: `<#${channel.id}>` })] : []),
  ];
  const hints = [
    ...(transcript ? [t(lang, 'tickets.closedDm.transcript')] : []),
    ...(rating ? [t(lang, 'tickets.closedDm.rate')] : []),
    t(lang, 'tickets.closedDm.again'),
  ];
  const picture = hideCloser ? guild.iconURL?.({ extension: 'png', size: 256 }) : pictureOf(actor);
  const container = new ContainerBuilder().setAccentColor(0xfe6465);
  withThumbnail(container, `${t(lang, 'tickets.closedDm.title', { emoji: EMOJI.TICKET_CLOSE, number: padNumber(ticket.ticket_number) })}\n${facts.join('\n')}`, picture);
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(hints.map((line) => `-# ${line}`).join('\n')));
  return container;
}

/** Five star-rating buttons, sent alongside the closed-ticket DM when rating is enabled. */
function buildRatingRow(ticketId) {
  const row = new ActionRowBuilder();
  for (let n = 1; n <= 5; n++) {
    row.addComponents(new ButtonBuilder().setCustomId(`tk_rate::${ticketId}::${n}`).setLabel(String(n)).setEmoji(EMOJI.STAR_FULL).setStyle(n >= 4 ? ButtonStyle.Success : ButtonStyle.Secondary));
  }
  return row;
}

/**
 * The stars of a rating of 4: four full stars of Petto and one empty one. `plain` gives ★★★★☆ instead, for the places where
 * an emoji of Petto cannot show (plain text, labels, pages outside Discord).
 */
function starsText(rating, { plain = false } = {}) {
  const n = Math.max(0, Math.min(5, Number(rating) || 0));
  if (plain) return `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;
  return `${EMOJI.STAR_FULL.repeat(n)}${EMOJI.STAR_EMPTY_RATE.repeat(5 - n)}`;
}

/** The card that takes the place of the rating buttons once the member rated (or had rated already). */
function buildRatedCard(rating, lang = currentLanguage()) {
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${t(lang, 'tickets.rating.doneCard', { emoji: EMOJI.STAR_FULL, stars: starsText(rating) })}
-# ${t(lang, 'tickets.rating.doneHint')}`),
  );
}

const isRatingRow = (component) => component?.type === 1 && (component.components ?? []).some((button) => String(button.custom_id ?? '').startsWith('tk_rate::'));

/**
 * The components of a message with rating buttons, after the rating: in a Components V2 message the row becomes the "thanks" card;
 * in an older message (no V2) the buttons stay but cannot be pressed, the chosen one in green. Everything else is kept as it was.
 */
function componentsAfterRating(components, rating, { v2 = true, lang = currentLanguage() } = {}) {
  const json = [...(components ?? [])].map((component) => (typeof component?.toJSON === 'function' ? component.toJSON() : component));
  return json.map((component) => {
    if (!isRatingRow(component)) return component;
    if (v2) return buildRatedCard(rating, lang).toJSON();
    return {
      ...component,
      components: component.components.map((button) => ({ ...button, disabled: true, style: String(button.custom_id ?? '').endsWith(`::${rating}`) ? ButtonStyle.Success : ButtonStyle.Secondary })),
    };
  });
}

/** A single Link-style button pointing at the web transcript viewer, or null if no link is available (web server not configured). Link buttons need no customId — clicking just navigates, no interaction fires. */
function buildTranscriptLinkRow(link, lang = currentLanguage()) {
  if (!link) return null;
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(t(lang, 'tickets.controls.viewTranscript.button')).setEmoji(EMOJI.TICKET_TRANSCRIPT).setStyle(ButtonStyle.Link).setURL(link));
}

/** Control row shown once a ticket is closed (locked): reopen, hard-delete, and (if available) view the transcript online. */
function buildClosedControlRow(ticketId, transcriptLink, lang = currentLanguage()) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tk_reopen::${ticketId}`).setLabel(t(lang, 'tickets.controls.reopen.button')).setEmoji(EMOJI.TICKET_REOPEN).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tk_delete::${ticketId}`).setLabel(t(lang, 'tickets.controls.delete.button')).setEmoji(EMOJI.TICKET_DELETE).setStyle(ButtonStyle.Danger),
  );
  if (transcriptLink) row.addComponents(new ButtonBuilder().setLabel(t(lang, 'tickets.controls.viewTranscript.button')).setEmoji(EMOJI.TICKET_TRANSCRIPT).setStyle(ButtonStyle.Link).setURL(transcriptLink));
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
  buildTicketClosedNotice,
  buildClaimCard,
  buildUnclaimCard,
  buildRatingRow,
  buildRatedCard,
  componentsAfterRating,
  starsText,
};
