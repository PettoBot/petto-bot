const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { EMOJI } = require('./emojis');

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

function buildPanelSelectRow(categories) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('tk_open_select')
    .setPlaceholder('Select a ticket category...')
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
function buildPanelRows(style, categories) {
  if (!categories.length) return [];
  return style === 'select' ? [buildPanelSelectRow(categories)] : [buildPanelButtonRow(categories)];
}

/** Fallback plain-text panel card (Components V2) when the panel has no linked /embed template. */
function buildPanelFallbackCard({ title, description }) {
  const lines = [];
  if (title) lines.push(`### ${title}`);
  lines.push(description || 'Click a button below to open a ticket.');
  return new ContainerBuilder().setAccentColor(0x8399ff).addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
}

/** Fallback plain-text welcome card (Components V2) when a category has no linked welcome embed template. */
function buildWelcomeFallbackCard({ opener, categoryLabel, pingText }) {
  const lines = [];
  if (pingText) lines.push(pingText);
  lines.push(`### ${EMOJI.STAR} ${categoryLabel}`, `Welcome ${opener}! Support will be with you shortly. Describe your issue below and a staff member will assist you.`);
  return new ContainerBuilder().setAccentColor(0x8399ff).addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
}

/** Control row for an open ticket: claim, close, on-demand transcript. */
function buildTicketControlRow(ticketId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tk_claim::${ticketId}`).setLabel('Claim').setEmoji(EMOJI.STAR).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tk_close::${ticketId}`).setLabel('Close').setEmoji(EMOJI.DENY).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`tk_transcript::${ticketId}`).setLabel('Transcript').setStyle(ButtonStyle.Secondary),
  );
}

/** Second control row for an open ticket: staff-only member management (enforced on click, not by hiding). */
function buildTicketMemberRow(ticketId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tk_addmember::${ticketId}`).setLabel('Add Member').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tk_removemember::${ticketId}`).setLabel('Remove Member').setStyle(ButtonStyle.Secondary),
  );
}

/** Components V2 DM card sent to the ticket opener when their ticket is closed — server/closer/reason/channel fields plus the closer's avatar as a large thumbnail. */
function buildTicketClosedCard({ ticket, guild, actor, reason, channel }) {
  const lines = [
    `### ${EMOJI.DENY} Your ticket #${String(ticket.ticket_number).padStart(4, '0')} was closed`,
    `**Server:** ${guild.name}`,
    `**Closed by:** ${actor}`,
    `**Reason:** ${reason || 'No reason provided.'}`,
    `**Channel:** ${channel ? `<#${channel.id}>` : 'Unknown'}`,
    '',
    '*Attached below is the full transcript of your ticket.*',
  ];

  const text = new TextDisplayBuilder().setContent(lines.join('\n'));
  const avatar = actor.displayAvatarURL({ extension: 'png', size: 256 });

  return new ContainerBuilder()
    .setAccentColor(0xfe6465)
    .addSectionComponents(new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)));
}

/** A single Link-style button pointing at the web transcript viewer, or null if no link is available (web server not configured). Link buttons need no customId — clicking just navigates, no interaction fires. */
function buildTranscriptLinkRow(link) {
  if (!link) return null;
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('View Transcript').setStyle(ButtonStyle.Link).setURL(link));
}

/** Control row shown once a ticket is closed (locked): reopen, hard-delete, and (if available) view the transcript online. */
function buildClosedControlRow(ticketId, transcriptLink) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tk_reopen::${ticketId}`).setLabel('Reopen').setEmoji(EMOJI.APPROVE).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tk_delete::${ticketId}`).setLabel('Delete').setEmoji(EMOJI.HAMMER).setStyle(ButtonStyle.Danger),
  );
  if (transcriptLink) row.addComponents(new ButtonBuilder().setLabel('View Transcript').setStyle(ButtonStyle.Link).setURL(transcriptLink));
  return row;
}

module.exports = {
  buildPanelRows,
  buildPanelFallbackCard,
  buildWelcomeFallbackCard,
  buildTicketControlRow,
  buildTicketMemberRow,
  buildClosedControlRow,
  buildTranscriptLinkRow,
  buildTicketClosedCard,
};
