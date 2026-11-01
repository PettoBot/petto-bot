const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { infoPayload, noticePayload } = require('./infoCard');
const { EMOJI } = require('./emojis');
const { t, tn, formatNumber, currentLanguage, languageOf } = require('../i18n');

// Long lists (roles, emojis, channels...) shown a page at a time with buttons. Nothing is stored: the buttons carry what
// the page needs (list, who asked, page, how it is sorted or filtered), and the list is built again from the server each
// time, so the buttons keep working after a restart and always show fresh data.
//   button  pg::<kind>::<userId>::<page>::<option>::<arg>::<which>   (which: first, back, next, last, so that two buttons that
//           go to the same page still have ids of their own, as Discord does not allow repeated ids)
//   select  pgo::<kind>::<userId>::<arg>

const PER_PAGE = 15;
const LIST_LIMIT = 3200;
const kinds = new Map();

/**
 * Teaches the pager a list.
 * @param {string} kind  Short name without `::`.
 * `accent` is the color of the card's side bar (the info purple when left out); null draws the list with no color at all.
 * @param {{ perPage?: number, accent?: number|null, load: (guild: import('discord.js').Guild, state: { option: string, arg: string, lang: string }) => Promise<{
 *   items: string[], title: string, subtitle?: string[], thumbnail?: string|null, footer?: string, empty?: string,
 *   options?: { label: string, value: string, emoji?: string }[], placeholder?: string }> }} definition
 */
function register(kind, definition) {
  if (kind.includes('::')) throw new Error(`Pager kind "${kind}" cannot contain "::".`); // i18n-ignore: internal error
  kinds.set(kind, definition);
}

const safePart = (value) => String(value ?? '').replace(/:/g, '').slice(0, 40);

function buttonId(kind, userId, page, option, arg, which) {
  return `pg::${kind}::${userId}::${page}::${safePart(option)}::${safePart(arg)}::${which}`;
}

/** Cuts the entries of one page so that they fit a text block of the card, never in the middle of an entry. */
function fitPage(items) {
  const lines = [];
  let length = 0;
  for (const item of items) {
    if (length + item.length + 1 > LIST_LIMIT) break;
    lines.push(item);
    length += item.length + 1;
  }
  return lines;
}

/** The card of one page of a list, with its buttons. */
async function buildPage(kind, { guild, userId, page = 0, option = '', arg = '', lang = currentLanguage() }) {
  const definition = kinds.get(kind);
  if (!definition) return noticePayload(t(lang, 'core.pager.gone'));

  const data = await definition.load(guild, { option, arg, lang });
  const colorless = definition.accent === null;
  if (!data.items.length) return noticePayload(data.empty ?? t(lang, 'core.pager.empty'), colorless ? null : undefined);

  const perPage = definition.perPage ?? PER_PAGE;
  const pages = Math.max(1, Math.ceil(data.items.length / perPage));
  const current = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const shown = fitPage(data.items.slice(current * perPage, (current + 1) * perPage));
  const start = current * perPage + 1;
  const rows = [];

  if (data.options?.length) {
    const selected = data.options.some((entry) => entry.value === option) ? option : data.options[0].value;
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`pgo::${kind}::${userId}::${safePart(arg)}`)
        .setPlaceholder(data.placeholder ?? t(lang, 'core.pager.show.menu'))
        .addOptions(data.options.slice(0, 25).map((entry) => { const built = new StringSelectMenuOptionBuilder().setLabel(entry.label).setValue(entry.value).setDefault(entry.value === selected); return entry.emoji ? built.setEmoji(entry.emoji) : built; })),
    ));
    option = selected;
  }

  if (pages > 1) {
    const go = (target, which) => buttonId(kind, userId, target, option, arg, which);
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(go(0, 'first')).setEmoji(EMOJI.FIRST).setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
      new ButtonBuilder().setCustomId(go(current - 1, 'back')).setEmoji(EMOJI.PREV).setStyle(ButtonStyle.Primary).setDisabled(current === 0),
      new ButtonBuilder().setCustomId('pg_label').setLabel(`${current + 1} / ${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(go(current + 1, 'next')).setEmoji(EMOJI.NEXT).setStyle(ButtonStyle.Primary).setDisabled(current >= pages - 1),
      new ButtonBuilder().setCustomId(go(pages - 1, 'last')).setEmoji(EMOJI.LAST).setStyle(ButtonStyle.Secondary).setDisabled(current >= pages - 1),
    ));
  }

  const counted = tn(lang, 'core.pager.entries', data.items.length);
  return infoPayload({
    ...(definition.accent !== undefined ? { accent: definition.accent } : {}),
    title: data.title,
    thumbnail: data.thumbnail,
    subtitle: data.subtitle,
    sections: [{ lines: shown, limit: LIST_LIMIT + 200 }],
    footer: [pages > 1 ? t(lang, 'core.pager.showing', { start, end: start + shown.length - 1, total: formatNumber(lang, data.items.length) }) : counted, data.footer].filter(Boolean).join(' · '),
    rows,
  });
}

/** Answers a command with the first page of a list. */
async function sendPager(interaction, kind, options = {}) {
  const payload = await buildPage(kind, { guild: interaction.guild, userId: interaction.user.id, lang: await languageOf(interaction), ...options });
  return interaction.reply(payload);
}

/** Handles the buttons and the select menu of a list. Only the person who asked can turn the pages. */
async function handlePager(interaction) {
  const parts = interaction.customId.split('::');
  const isSelect = parts[0] === 'pgo';
  const [, kind, userId] = parts;
  const lang = await languageOf(interaction);
  if (interaction.user.id !== userId) {
    await interaction.reply({ content: t(lang, 'core.pager.onlyOwner', { user: userId }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  if (!interaction.guild) {
    await interaction.reply({ content: t(lang, 'core.pager.guildOnly'), flags: MessageFlags.Ephemeral });
    return;
  }
  const state = isSelect
    ? { page: 0, option: interaction.values?.[0] ?? '', arg: parts[3] ?? '' }
    : { page: Number(parts[3]) || 0, option: parts[4] ?? '', arg: parts[5] ?? '' };
  await interaction.update(await buildPage(kind, { guild: interaction.guild, userId, lang, ...state }));
}

const isPagerId = (customId) => customId.startsWith('pg::') || customId.startsWith('pgo::');

module.exports = { register, buildPage, sendPager, handlePager, isPagerId, PER_PAGE };
