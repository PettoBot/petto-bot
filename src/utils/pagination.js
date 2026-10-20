// Paginated messages (`!pagination`, alias `pn`): one message of Petto with up to 25 pages and buttons to turn them. Each page is a
// saved embed (by name, drawn when it is shown, so its variables are filled then), an embed code, or what the message showed when
// `!pagination set` took it. All the pages of one message are of one kind: classic embeds, or Components V2 designs.
//
// The buttons carry everything they need, so they keep working after a restart (the record is read from the database on each click):
//   button  pgm::<record id>::<page>::<f|p|n|l>   first, previous, next, last (the letter keeps two ids that go to one page apart)
//   label   pgm::<record id>::label               "Page X/Y", disabled
//   select  pgm::<record id>::jump                the page to jump to (more than 5 pages)
//   reset   pgm::reset::<user id>::<yes|no>       the confirmation of `!pagination reset`
// Anyone can turn the pages. A shared message turns for everyone (like other bots do); a private one (`--private`) answers the member
// who clicked with the page only they see, and the buttons of that answer turn it in place.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { parseEmbedScript, toTemplateData } = require('./embedScript');
const { build, hasSendablePayload, formatEmbedError } = require('./embedBuilder');
const { isV2, readV2Code } = require('./embedV2');
const { extractReactRepliesFromTemplate } = require('./messageFlags');
const { t } = require('../i18n');

const PREFIX = 'pgm';
const MAX_PAGES = 25;
// From this many pages the buttons get first and last, and a menu to jump to any page.
const JUMP_FROM = 6;
// A classic message has 5 rows of components; the buttons take one and the jump menu another, so a page keeps at most 3 of its own.
const PAGE_ROWS = 3;
const SNOWFLAKE = /^\d{15,25}$/;

/** What a component id of a paginated message asks for, or null when it is not one. */
function parseCustomId(customId) {
  const parts = String(customId ?? '').split('::');
  if (parts[0] !== PREFIX) return null;
  if (parts[1] === 'reset') {
    if (!SNOWFLAKE.test(parts[2] ?? '') || !['yes', 'no'].includes(parts[3])) return null;
    return { action: 'reset', userId: parts[2], answer: parts[3] };
  }
  if (!/^\d{1,19}$/.test(parts[1] ?? '')) return null;
  const id = parts[1];
  if (parts[2] === 'jump') return { action: 'jump', id };
  if (parts[2] === 'label') return { action: 'label', id };
  if (!/^\d{1,3}$/.test(parts[2] ?? '')) return null;
  return { action: 'go', id, page: Number(parts[2]), which: parts[3] ?? '' };
}

const buttonId = (id, page, which) => `${PREFIX}::${id}::${page}::${which}`;
const isPaginationId = (customId) => String(customId ?? '').startsWith(`${PREFIX}::`);

/** A page number inside the pages there are (0 based). */
function clampPage(page, total) {
  const count = Math.max(0, Math.trunc(Number(total) || 0));
  if (!count) return 0;
  const value = Math.trunc(Number(page));
  return Math.min(Math.max(0, Number.isFinite(value) ? value : 0), count - 1);
}

/** A page number typed by a member (1 based) as an index, or null when it is not one of the pages. */
function pageIndex(typed, total) {
  const value = Number(String(typed ?? '').trim());
  if (!Number.isInteger(value) || value < 1 || value > total) return null;
  return value - 1;
}

/** A short name of a page for lists and the jump menu. */
function pageLabel(source, lang) {
  if (source?.type === 'embed') return t(lang, 'pagination.source.embed', { name: source.name });
  if (source?.type === 'message') return t(lang, 'pagination.source.message');
  const code = String(source?.code ?? '').replace(/\s+/g, ' ').trim();
  return t(lang, 'pagination.source.code', { code: code.length > 40 ? `${code.slice(0, 39)}…` : code });
}

/** The rows of buttons (and the jump menu) for page `page` of `total`. Nothing for a single page. */
function navRows(id, page, total, lang, pages = []) {
  if (total <= 1) return [];
  const current = clampPage(page, total);
  const many = total >= JUMP_FROM;
  const buttons = [];
  if (many) buttons.push(new ButtonBuilder().setCustomId(buttonId(id, 0, 'f')).setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(current === 0));
  buttons.push(
    new ButtonBuilder().setCustomId(buttonId(id, current - 1 < 0 ? 0 : current - 1, 'p')).setEmoji('◀️').setStyle(ButtonStyle.Primary).setDisabled(current === 0),
    new ButtonBuilder().setCustomId(`${PREFIX}::${id}::label`).setLabel(t(lang, 'pagination.button.page', { page: current + 1, total })).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(buttonId(id, Math.min(current + 1, total - 1), 'n')).setEmoji('▶️').setStyle(ButtonStyle.Primary).setDisabled(current >= total - 1),
  );
  if (many) buttons.push(new ButtonBuilder().setCustomId(buttonId(id, total - 1, 'l')).setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(current >= total - 1));
  const rows = [new ActionRowBuilder().addComponents(buttons)];
  if (many) {
    const options = Array.from({ length: Math.min(total, MAX_PAGES) }, (_, index) => {
      const option = new StringSelectMenuOptionBuilder().setLabel(t(lang, 'pagination.jump.option', { page: index + 1 })).setValue(String(index)).setDefault(index === current);
      if (pages[index]) option.setDescription(pageLabel(pages[index], lang).slice(0, 100));
      return option;
    });
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`${PREFIX}::${id}::jump`).setPlaceholder(t(lang, 'pagination.jump.menu')).addOptions(options),
    ));
  }
  return rows;
}

const rowJson = (row) => (typeof row?.toJSON === 'function' ? row.toJSON() : row);
/** Whether a top-level component is a row of the buttons of a paginated message (they are put back on every page, never kept). */
function isNavRow(row) {
  const json = rowJson(row);
  const children = json?.components ?? [];
  return json?.type === 1 && children.length > 0 && children.every((child) => isPaginationId(child.custom_id));
}
const withoutNav = (components) => (components ?? []).filter((row) => !isNavRow(row));

/** The kind of a saved design or a built message: `v2` (Components V2) or `embed`. */
const kindOfData = (data) => (isV2(data) ? 'v2' : 'embed');

/**
 * What a member typed as a page: one word is the name of a saved embed, anything else an embed code (or a p2. code). Answers
 * `{ source, data, kind, warnings }`, or `{ error, vars }` with the key of what is wrong (in the `pagination.error.` group).
 */
async function sourceFromInput(input, { guildId, lang, getTemplate }) {
  const text = String(input ?? '').trim();
  if (!text) return { error: 'noSource' };
  if (!/\s|\{|\}/.test(text) && !text.startsWith('p2.')) {
    const template = await getTemplate(guildId, text).catch(() => null);
    if (!template?.data) return { error: 'noEmbed', vars: { name: text } };
    return { source: { type: 'embed', name: template.name ?? text }, data: template.data, kind: kindOfData(template.data), warnings: [] };
  }
  if (text.length > 6000) return { error: 'tooLong' };
  if (text.startsWith('p2.')) {
    const v2 = readV2Code(text);
    if (!v2) return { error: 'badV2' };
    const data = { content: '', embeds: [], buttons: [], v2 };
    return { source: { type: 'code', code: text }, data, kind: 'v2', warnings: [] };
  }
  const parsed = parseEmbedScript(text, lang);
  if (!parsed.embeds.length && !parsed.content && !parsed.buttons.length) return { error: 'nothing', vars: { problems: parsed.warnings.map((line) => `\n- ${line}`).join('') } };
  return { source: { type: 'code', code: text }, data: toTemplateData(parsed).data, kind: 'embed', warnings: parsed.warnings };
}

/** The design a page draws: the saved embed (read now), the code, or null for a page taken from the message. */
async function dataOfSource(source, { guildId, lang, getTemplate }) {
  if (source?.type === 'embed') {
    const template = await getTemplate(guildId, source.name).catch(() => null);
    return template?.data ? { data: template.data } : { error: 'embedGone', vars: { name: source.name } };
  }
  if (source?.type === 'code') {
    const found = await sourceFromInput(source.code, { guildId, lang, getTemplate });
    return found.error ? found : { data: found.data };
  }
  return { error: 'nothing', vars: { problems: '' } };
}

/** What `!pagination set` keeps of a message of Petto as its first page, without the buttons of a pagination. */
function snapshotMessage(message) {
  const v2 = Boolean((message.flags?.bitfield ?? message.flags ?? 0) & MessageFlags.IsComponentsV2);
  const components = withoutNav(message.components ?? []).map(rowJson);
  const keepFiles = (message.attachments?.size ?? 0) > 0;
  if (v2) {
    if (!components.length) return { error: 'emptyMessage' };
    return { kind: 'v2', source: { type: 'message', v2: true, components, keepFiles } };
  }
  const embeds = (message.embeds ?? []).map((embed) => (typeof embed?.toJSON === 'function' ? embed.toJSON() : embed));
  const content = String(message.content ?? '');
  if (!content && !embeds.length) return { error: 'emptyMessage' };
  if (components.length > PAGE_ROWS) return { error: 'tooManyRows', vars: { max: PAGE_ROWS } };
  return { kind: 'embed', source: { type: 'message', content, embeds, components, keepFiles } };
}

/** The refusal when a page is not of the kind of the message, or null when it fits. */
function mixingProblem(recordKind, pageKind) {
  if (!recordKind || recordKind === pageKind) return null;
  return pageKind === 'v2' ? 'mixV2' : 'mixEmbed';
}

/** Whether the pages leave the message's own attachments alone (a page taken from a message with files keeps them). */
const keepsFiles = (pages) => (pages ?? []).some((page) => page?.type === 'message' && page.keepFiles);

/**
 * The message for page `index` of a record: the page and the buttons. `ctx` is who and where the variables are filled for
 * (member, guild, channel, user, lang). Answers `{ payload }` or `{ error, vars }`.
 */
async function renderPage(record, index, ctx, { getTemplate, navLang = ctx.lang } = {}) {
  const pages = record.pages ?? [];
  if (!pages.length) return { error: 'noPages' };
  const current = clampPage(index, pages.length);
  const source = pages[current];
  const nav = navRows(record.id, current, pages.length, navLang, pages);
  const files = { allowedMentions: { parse: [] } };

  let built;
  if (source.type === 'message') {
    built = source.v2
      ? { components: source.components ?? [], embeds: [], files: [], flags: MessageFlags.IsComponentsV2 }
      : { content: source.content || undefined, embeds: source.embeds ?? [], components: source.components ?? [], files: [] };
  } else {
    const found = await dataOfSource(source, { guildId: ctx.guild?.id, lang: ctx.lang, getTemplate });
    if (found.error) return found;
    if (kindOfData(found.data) !== record.kind) return { error: record.kind === 'v2' ? 'pageIsEmbed' : 'pageIsV2', vars: { page: current + 1 } };
    try {
      built = await build(extractReactRepliesFromTemplate(found.data, []), { ...ctx, allowV2: true });
    } catch (err) {
      return { error: 'refused', vars: { error: formatEmbedError(err, ctx.lang) } };
    }
    if (!hasSendablePayload(built)) return { error: 'emptyPage', vars: { page: current + 1 } };
  }

  const pageFiles = built.files ?? [];
  if (pageFiles.length) files.files = pageFiles;
  // The files of the message are replaced by the page's (an image card), unless a page taken from the message needs its own.
  if (pageFiles.length || !keepsFiles(pages)) files.attachments = [];

  if (record.kind === 'v2') {
    return { page: current, payload: { components: [...(built.components ?? []), ...nav], flags: MessageFlags.IsComponentsV2, ...files } };
  }
  const own = withoutNav(built.components ?? []).slice(0, PAGE_ROWS);
  return { page: current, payload: { content: built.content ?? '', embeds: built.embeds ?? [], components: [...own, ...nav], ...files } };
}

/** A page's own rows of components are more than fit next to the buttons (classic messages only). */
function tooManyRows(kind, builtComponents) {
  return kind === 'embed' && withoutNav(builtComponents ?? []).length > PAGE_ROWS;
}

/** Whether a new page can be shown, built once for the member adding it: null when it can, else `{ error, vars }`. */
async function checkPage(found, ctx) {
  let built;
  try {
    built = await build(extractReactRepliesFromTemplate(found.data, []), { ...ctx, allowV2: true });
  } catch (err) {
    return { error: 'refused', vars: { error: formatEmbedError(err, ctx.lang) } };
  }
  if (!hasSendablePayload(built)) return { error: 'emptySource' };
  if (tooManyRows(found.kind, built.components)) return { error: 'tooManyRows', vars: { max: PAGE_ROWS } };
  return null;
}

/** The permissions Petto is missing in a channel, by name. `send`: it posts a new message there. */
function missingBotPermissions(channel, me, { send = false } = {}) {
  const needed = [['ViewChannel', PermissionFlagsBits.ViewChannel], ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory]];
  if (send) needed.push(['SendMessages', PermissionFlagsBits.SendMessages], ['EmbedLinks', PermissionFlagsBits.EmbedLinks]);
  const permissions = me ? channel?.permissionsFor?.(me) : null;
  return needed.filter(([, flag]) => !permissions?.has(flag)).map(([name]) => name);
}

/** The link of a paginated message. */
const messageLink = (record) => `https://discord.com/channels/${record.guild_id}/${record.channel_id}/${record.message_id}`;

module.exports = {
  PREFIX, MAX_PAGES, JUMP_FROM, PAGE_ROWS, parseCustomId, isPaginationId, clampPage, pageIndex, pageLabel, navRows, isNavRow, withoutNav,
  kindOfData, sourceFromInput, dataOfSource, snapshotMessage, mixingProblem, keepsFiles, renderPage, tooManyRows, checkPage, missingBotPermissions, messageLink,
};
