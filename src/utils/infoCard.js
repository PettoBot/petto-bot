const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');
const { COLORS } = require('./colors');

// Accent shared by the info commands; individual commands override it when the subject has its own color.
const INFO_ACCENT = 0x8c7cff;
// Discord allows 4000 characters of text per message across every text display, and 5 buttons per row.
const TEXT_BUDGET = 3800;
const SECTION_LIMIT = 1000;
const MAX_BUTTONS = 5;

function clip(text, max = SECTION_LIMIT) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…` : value;
}

function unix(ms) {
  return Math.floor(Number(ms) / 1000);
}

/** `<t:…:F> (<t:…:R>)` for a millisecond timestamp. */
function stamp(ms) {
  return `<t:${unix(ms)}:F> (<t:${unix(ms)}:R>)`;
}

/** `**Label** value`, or nothing when there is no value to show. */
function line(label, value) {
  if (value === null || value === undefined || value === '') return null;
  return `**${label}** ${value}`;
}

function yesNo(value) {
  return value ? 'Yes' : 'No';
}

function snowflakeTime(id) {
  return Number((BigInt(id) >> 22n) + 1420070400000n);
}

/**
 * Components V2 card shared by the info commands.
 *
 * @param {object} options
 * @param {number} [options.accent]
 * @param {string} options.title          Large heading.
 * @param {string[]} [options.subtitle]   Lines shown under the heading.
 * @param {string} [options.thumbnail]    Picture next to the heading.
 * @param {string} [options.banner]       Wide picture shown under the heading.
 * @param {{title?: string, lines: (string|null)[], limit?: number}[]} [options.sections]  `limit` raises the per-section text cap
 *   for long lists that the command already cuts on a whole entry.
 * @param {string} [options.footer]       Small text at the bottom.
 * @param {{label: string, url: string}[]} [options.buttons]  Link buttons.
 */
function buildInfoCard({ accent = INFO_ACCENT, title, subtitle = [], thumbnail = null, banner = null, sections = [], footer = null, buttons = [] }) {
  let budget = TEXT_BUDGET;
  const take = (text, max = SECTION_LIMIT) => {
    const value = clip(text, Math.min(max, Math.max(0, budget)));
    budget -= value.length;
    return value;
  };

  const headerText = new TextDisplayBuilder().setContent(take([`## ${clip(title, 200)}`, ...subtitle.filter(Boolean)].join('\n'), 1200));
  const card = new ContainerBuilder().setAccentColor(accent);
  if (thumbnail) card.addSectionComponents(new SectionBuilder().addTextDisplayComponents(headerText).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail)));
  else card.addTextDisplayComponents(headerText);

  if (banner) card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(banner)));

  const shown = sections
    .map((section) => ({ title: section.title, limit: section.limit, lines: (section.lines ?? []).filter(Boolean) }))
    .filter((section) => section.lines.length);

  if (shown.length) card.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large));
  shown.forEach((section, index) => {
    if (budget <= 0) return;
    if (index > 0) card.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    const heading = section.title ? `### ${section.title}\n` : '';
    card.addTextDisplayComponents(new TextDisplayBuilder().setContent(heading + take(section.lines.join('\n'), section.limit ?? SECTION_LIMIT)));
  });

  if (footer) {
    card.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${clip(footer, 300)}`));
  }

  const links = buttons.filter((button) => button?.url).slice(0, MAX_BUTTONS);
  if (links.length) {
    card.addActionRowComponents(
      new ActionRowBuilder().addComponents(links.map((button) => new ButtonBuilder().setLabel(button.label).setStyle(ButtonStyle.Link).setURL(button.url))),
    );
  }

  return card;
}

/** Message payload for a card. Mentions inside the card render but never ping. */
function infoPayload(options) {
  return { components: [buildInfoCard(options)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

/** Small one-block card for "nothing found" and similar answers. */
function noticePayload(text, color = COLORS.DEFAULT) {
  const card = new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(clip(text, 1500)));
  return { components: [card], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

module.exports = { INFO_ACCENT, buildInfoCard, infoPayload, noticePayload, clip, stamp, line, yesNo, snowflakeTime };
