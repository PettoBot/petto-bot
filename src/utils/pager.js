const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { infoPayload, noticePayload } = require('./infoCard');

// Long lists (roles, emojis, channels...) shown a page at a time with buttons. Nothing is stored: the buttons carry what
// the page needs (list, who asked, page, how it is sorted or filtered), and the list is built again from the server each
// time, so the buttons keep working after a restart and always show fresh data.
//   button  pg::<kind>::<userId>::<page>::<option>::<arg>
//   select  pgo::<kind>::<userId>::<arg>

const PER_PAGE = 15;
const LIST_LIMIT = 3200;
const kinds = new Map();

/**
 * Teaches the pager a list.
 * @param {string} kind  Short name without `::`.
 * @param {{ perPage?: number, load: (guild: import('discord.js').Guild, state: { option: string, arg: string }) => Promise<{
 *   items: string[], title: string, subtitle?: string[], thumbnail?: string|null, footer?: string, empty?: string,
 *   options?: { label: string, value: string }[], placeholder?: string }> }} definition
 */
function register(kind, definition) {
  if (kind.includes('::')) throw new Error(`Pager kind "${kind}" cannot contain "::".`);
  kinds.set(kind, definition);
}

const safePart = (value) => String(value ?? '').replace(/:/g, '').slice(0, 40);

function buttonId(kind, userId, page, option, arg) {
  return `pg::${kind}::${userId}::${page}::${safePart(option)}::${safePart(arg)}`;
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
async function buildPage(kind, { guild, userId, page = 0, option = '', arg = '' }) {
  const definition = kinds.get(kind);
  if (!definition) return noticePayload('That list is no longer available.');

  const data = await definition.load(guild, { option, arg });
  if (!data.items.length) return noticePayload(data.empty ?? 'There is nothing to show.');

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
        .setPlaceholder(data.placeholder ?? 'Show…')
        .addOptions(data.options.slice(0, 25).map((entry) => new StringSelectMenuOptionBuilder().setLabel(entry.label).setValue(entry.value).setDefault(entry.value === selected))),
    ));
    option = selected;
  }

  if (pages > 1) {
    const go = (target) => buttonId(kind, userId, target, option, arg);
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(go(0)).setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
      new ButtonBuilder().setCustomId(go(current - 1)).setEmoji('◀️').setStyle(ButtonStyle.Primary).setDisabled(current === 0),
      new ButtonBuilder().setCustomId('pg_label').setLabel(`${current + 1} / ${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(go(current + 1)).setEmoji('▶️').setStyle(ButtonStyle.Primary).setDisabled(current >= pages - 1),
      new ButtonBuilder().setCustomId(go(pages - 1)).setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(current >= pages - 1),
    ));
  }

  const counted = `${data.items.length} ${data.items.length === 1 ? 'entry' : 'entries'}`;
  return infoPayload({
    title: data.title,
    thumbnail: data.thumbnail,
    subtitle: data.subtitle,
    sections: [{ lines: shown, limit: LIST_LIMIT + 200 }],
    footer: [pages > 1 ? `Showing ${start}–${start + shown.length - 1} of ${data.items.length}` : counted, data.footer].filter(Boolean).join(' · '),
    rows,
  });
}

/** Answers a command with the first page of a list. */
async function sendPager(interaction, kind, options = {}) {
  const payload = await buildPage(kind, { guild: interaction.guild, userId: interaction.user.id, ...options });
  return interaction.reply(payload);
}

/** Handles the buttons and the select menu of a list. Only the person who asked can turn the pages. */
async function handlePager(interaction) {
  const parts = interaction.customId.split('::');
  const isSelect = parts[0] === 'pgo';
  const [, kind, userId] = parts;
  if (interaction.user.id !== userId) {
    await interaction.reply({ content: `Only <@${userId}> can use these buttons. Run the command yourself to get your own list.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  if (!interaction.guild) {
    await interaction.reply({ content: 'This list only works inside a server.', flags: MessageFlags.Ephemeral });
    return;
  }
  const state = isSelect
    ? { page: 0, option: interaction.values?.[0] ?? '', arg: parts[3] ?? '' }
    : { page: Number(parts[3]) || 0, option: parts[4] ?? '', arg: parts[5] ?? '' };
  await interaction.update(await buildPage(kind, { guild: interaction.guild, userId, ...state }));
}

const isPagerId = (customId) => customId.startsWith('pg::') || customId.startsWith('pgo::');

module.exports = { register, buildPage, sendPager, handlePager, isPagerId, PER_PAGE };
