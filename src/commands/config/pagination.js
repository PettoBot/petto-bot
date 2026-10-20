// `!pagination` (aliases `pn`, `pages`; prefix only): messages of Petto with several pages and buttons to turn them. The pages are saved
// embeds or embed codes; see src/utils/pagination.js for how they are drawn and src/interactions/pagination.js for the buttons.
//   create [#channel] <embed or code> [--private]   a new message with its first page
//   set <message> [--private]                       a message Petto already sent becomes page 1
//   add <message> <embed or code>                   one more page (up to 25)
//   update <message> <page> <embed or code>         another embed for a page
//   remove <message> <page>    move <message> <from> <to>    view <message>    list
//   mode <message> shared|private    restore <message>    delete <message> [--message]    reset
// <message> is a message link, `#channel id`, an id in this channel, or nothing when the command replies to the message.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../db/paginations');
const { getTemplate } = require('../../db/embedTemplates');
const { ensureGuild } = require('../../db/guilds');
const { guildLimit } = require('../../db/premium');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { commandRef } = require('../../utils/commandRef');
const { register, sendPager } = require('../../utils/pager');
const { messageTarget, takeFlags } = require('../../utils/codeArgs');
const {
  MAX_PAGES, pageIndex, pageLabel, sourceFromInput, snapshotMessage, mixingProblem, checkPage, missingBotPermissions, messageLink,
} = require('../../utils/pagination');
const { showPage, postPagination, stripButtons, pageContext } = require('../../utils/paginationActions');
const logger = require('../../utils/logger');
const { t, tn, languageOf } = require('../../i18n');

const REPLY_FLAGS = MessageFlags.IsComponentsV2;
const RED = 0xfe6465;
const GREEN = 0xa5ea7a;
const GONE_CODES = new Set([10003, 10008]);

register('paginations', {
  perPage: 10,
  async load(guild, { lang }) {
    const rows = await db.listPaginations(guild.id);
    // A channel deleted while Petto was away: its paginations go now.
    const alive = [];
    for (const row of rows) {
      if (guild.channels.cache.has(row.channel_id)) { alive.push(row); continue; }
      // Not cached is not gone (an archived thread): only Discord's "Unknown Channel" removes it.
      const gone = await guild.channels.fetch(row.channel_id).then(() => false, (err) => GONE_CODES.has(err?.code));
      if (gone) await db.deletePagination(row).catch(() => {});
      else alive.push(row);
    }
    return {
      title: t(lang, 'pagination.list.title'),
      subtitle: [t(lang, 'pagination.list.subtitle')],
      items: alive.map((row, index) => t(lang, row.private ? 'pagination.list.itemPrivate' : 'pagination.list.item', {
        number: index + 1, channel: `<#${row.channel_id}>`, pages: tn(lang, 'pagination.pages', row.pages.length), url: messageLink(row),
      })),
      empty: t(lang, 'pagination.list.empty'),
    };
  },
});

// ---- What is typed after each subcommand (read raw, so an embed code keeps its spaces, quotes and line breaks) ----

/** `<message> rest`: the message (a link, `<#channel> id`, `channel/id` or an id) when the text starts with one. */
function splitTarget(text) {
  const body = String(text ?? '').trim();
  const pair = /^<#(\d{15,25})>\s+(\d{15,25})(?:\s+([\s\S]*))?$/.exec(body);
  if (pair) return { message: `${pair[1]}/${pair[2]}`, rest: (pair[3] ?? '').trim() };
  const first = /^(\S+)(?:\s+([\s\S]*))?$/.exec(body);
  if (first && messageTarget(first[1])) return { message: first[1], rest: (first[2] ?? '').trim() };
  return { message: null, rest: body };
}

/** The values of one subcommand from the raw text. Pure, so the check can read it. */
function parseArgs(sub, text) {
  const { text: body, flags } = takeFlags(text);
  const values = {};
  if (flags.private) values.private = true;
  if (flags.message || flags.purge) values.purge = true;
  if (sub === 'create') {
    const channel = /^(?:<#(\d{15,25})>|(\d{15,25}))(?:\s+([\s\S]*))?$/.exec(body.trim());
    if (channel) {
      values.channel = channel[1] ?? channel[2];
      if (channel[3]?.trim()) values.embed = channel[3].trim();
    } else if (body.trim()) values.embed = body.trim();
    return values;
  }
  if (sub === 'list' || sub === 'reset') return values;
  const { message, rest } = splitTarget(body);
  if (message) values.message = message;
  if (sub === 'add') { if (rest) values.embed = rest; return values; }
  if (sub === 'update') {
    const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest);
    if (match) { values.page = match[1]; if (match[2]?.trim()) values.embed = match[2].trim(); }
    return values;
  }
  if (sub === 'remove') { if (rest) values.page = rest.split(/\s+/)[0]; return values; }
  if (sub === 'move') {
    const [from, to] = rest.split(/\s+/).filter(Boolean);
    if (from) values.from = from;
    if (to) values.to = to;
    return values;
  }
  if (sub === 'mode') { if (rest) values.mode = rest.split(/\s+/)[0].toLowerCase(); return values; }
  return values;
}

const raw = (sub) => (text) => parseArgs(sub, text);
const SUBCOMMANDS = ['create', 'set', 'add', 'update', 'remove', 'move', 'list', 'view', 'mode', 'restore', 'delete', 'reset'];

// ---- Answers ----

function permissionList(lang, names) {
  return names.map((name) => t(lang, `core.perm.${name}`)).join(', ');
}

/** The text of an error of the pagination helpers. */
function errorText(lang, result) {
  const vars = { ...(result.vars ?? {}) };
  if (Array.isArray(vars.permissions)) vars.permissions = permissionList(lang, vars.permissions);
  return t(lang, `pagination.error.${result.error}`, vars);
}

/** The message a subcommand points at, checked: in this server, the member can manage messages there, Petto sent it. */
async function resolveTarget(interaction, token, lang) {
  const target = messageTarget(token);
  if (token && !target) return { error: 'badTarget' };
  if (target?.guildId && target.guildId !== interaction.guild.id) return { error: 'otherServer' };
  const channelId = target?.channelId ?? interaction.channel.id;
  const messageId = target?.messageId ?? (token ? null : interaction.rawMessage?.reference?.messageId ?? null);
  if (!messageId) return { error: 'noTarget' };

  const channel = interaction.guild.channels.cache.get(channelId) ?? await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.messages) {
    const stale = await db.getByMessage(interaction.guild.id, messageId).catch(() => null);
    if (stale) { await db.deletePagination(stale).catch(() => {}); return { error: 'goneCleaned' }; }
    return { error: 'noChannel' };
  }
  const permissions = channel.permissionsFor(interaction.member);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.ManageMessages)) return { error: 'noPermission', vars: { permission: t(lang, 'core.perm.ManageMessages') } };
  const missing = missingBotPermissions(channel, interaction.guild.members.me);
  if (missing.length) return { error: 'botPermissions', vars: { permissions: missing } };

  let message;
  try {
    message = await channel.messages.fetch(messageId);
  } catch (err) {
    const stale = await db.getByMessage(interaction.guild.id, messageId).catch(() => null);
    if (stale && GONE_CODES.has(err?.code)) { await db.deletePagination(stale).catch(() => {}); return { error: 'goneCleaned' }; }
    return { error: 'noMessage' };
  }
  if (message.author?.id !== interaction.client.user.id) return { error: 'notMine' };
  return { channel, message };
}

async function limitReached(guildId) {
  const allowed = await guildLimit(guildId, 'paginationMessages');
  const count = await db.countPaginations(guildId);
  return count >= allowed.limit ? allowed : null;
}

module.exports = {
  aliases: ['pn', 'pages'],
  prefixSubcommandAliases: { restorereactions: 'restore', rr: 'restore', new: 'create', del: 'delete', edit: 'update', show: 'view', info: 'view' },
  prefixRawOptions: Object.fromEntries(SUBCOMMANDS.map((sub) => [sub, raw(sub)])),
  parseArgs,
  data: new SlashCommandBuilder()
    .setName('pagination')
    .setDescription('Messages with several pages of embeds and buttons to turn them.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('create').setDescription('Post a new paginated message with its first page.')
      .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: here)').setRequired(false))
      .addStringOption((o) => o.setName('embed').setDescription('A saved embed name or an embed code; add --private for private pages').setRequired(false)))
    .addSubcommand((s) => s.setName('set').setDescription('Make a message Petto sent the first page of a pagination.')
      .addStringOption((o) => o.setName('message').setDescription('Link of the message, or reply to it').setRequired(false)))
    .addSubcommand((s) => s.setName('add').setDescription('Add a page at the end of a paginated message.')
      .addStringOption((o) => o.setName('message').setDescription('Link of the message, or reply to it').setRequired(false))
      .addStringOption((o) => o.setName('embed').setDescription('A saved embed name or an embed code').setRequired(false)))
    .addSubcommand((s) => s.setName('update').setDescription('Change one page of a paginated message.')
      .addStringOption((o) => o.setName('message').setDescription('Link of the message, or reply to it').setRequired(false))
      .addIntegerOption((o) => o.setName('page').setDescription('Page number').setRequired(false))
      .addStringOption((o) => o.setName('embed').setDescription('A saved embed name or an embed code').setRequired(false)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove one page of a paginated message.')
      .addStringOption((o) => o.setName('message').setDescription('Link of the message, or reply to it').setRequired(false))
      .addIntegerOption((o) => o.setName('page').setDescription('Page number').setRequired(false)))
    .addSubcommand((s) => s.setName('move').setDescription('Move a page to another place.')
      .addStringOption((o) => o.setName('message').setDescription('Link of the message, or reply to it').setRequired(false))
      .addIntegerOption((o) => o.setName('from').setDescription('Page number to move').setRequired(false))
      .addIntegerOption((o) => o.setName('to').setDescription('Its new place').setRequired(false)))
    .addSubcommand((s) => s.setName('list').setDescription('List the paginated messages of this server.'))
    .addSubcommand((s) => s.setName('view').setDescription('Show the pages of a paginated message.')
      .addStringOption((o) => o.setName('message').setDescription('Link of the message, or reply to it').setRequired(false)))
    .addSubcommand((s) => s.setName('mode').setDescription('Shared pages (turn for everyone) or private (each member their own).')
      .addStringOption((o) => o.setName('message').setDescription('Link of the message, or reply to it').setRequired(false))
      .addStringOption((o) => o.setName('mode').setDescription('shared or private').setRequired(false)))
    .addSubcommand((s) => s.setName('restore').setDescription('Put the buttons back on a paginated message.')
      .addStringOption((o) => o.setName('message').setDescription('Link of the message, or reply to it').setRequired(false)))
    .addSubcommand((s) => s.setName('delete').setDescription('Stop a pagination and take its buttons off; --message deletes the message.')
      .addStringOption((o) => o.setName('message').setDescription('Link of the message, or reply to it').setRequired(false)))
    .addSubcommand((s) => s.setName('reset').setDescription('Stop every pagination of this server (Administrator).')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const lang = await languageOf(interaction);
    const prefixRef = (text) => `\`${commandRef(interaction, text)}\``;

    if (sub === 'list') {
      await sendPager(interaction, 'paginations');
      return;
    }

    await interaction.deferReply({ flags: REPLY_FLAGS });
    const answer = (text, color = GREEN) => interaction.editReply({ components: [textCard(String(text).slice(0, 3900), color)], flags: REPLY_FLAGS, allowedMentions: { parse: [] } });
    const fail = (key, vars) => answer(t(lang, `pagination.error.${key}`, vars ?? {}), RED);
    const failWith = (result) => answer(errorText(lang, result), RED);
    const value = (name) => interaction.options.getString(name) ?? null;
    const guildId = interaction.guild.id;
    const ctxFor = (channel) => pageContext(interaction.guild, channel, interaction.member, lang);
    const shown = (result, done) => (result?.error ? answer(`${done}\n${errorText(lang, result)}`, RED) : answer(done));

    try {
      if (sub === 'reset') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return fail('adminOnly');
        const count = await db.countPaginations(guildId);
        if (!count) return fail('noneToReset');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`pgm::reset::${interaction.user.id}::yes`).setLabel(t(lang, 'pagination.reset.yes.button')).setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`pgm::reset::${interaction.user.id}::no`).setLabel(t(lang, 'pagination.reset.no.button')).setStyle(ButtonStyle.Secondary),
        );
        const card = textCard(t(lang, 'pagination.reset.confirm', { count }), RED).addActionRowComponents(row);
        await interaction.editReply({ components: [card], flags: REPLY_FLAGS, allowedMentions: { parse: [] } });
        return;
      }

      if (sub === 'create') {
        const channelId = value('channel');
        const channel = channelId ? interaction.guild.channels.cache.get(channelId) ?? await interaction.guild.channels.fetch(channelId).catch(() => null) : interaction.channel;
        if (!channel?.isTextBased?.() || !channel.messages) return fail('noChannel');
        const permissions = channel.permissionsFor(interaction.member);
        if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.ManageMessages)) return fail('noPermission', { permission: t(lang, 'core.perm.ManageMessages') });
        if (!value('embed')) return fail('usage.create', { example: prefixRef('pagination create #rules my_embed') }); // i18n-ignore: a command as it is typed
        const full = await limitReached(guildId);
        if (full) return fail(full.premium ? 'limit' : 'limitFree', { limit: full.limit, premium: full.premiumLimit });
        const found = await sourceFromInput(value('embed'), { guildId, lang, getTemplate });
        if (found.error) return failWith(found);
        const problem = await checkPage(found, ctxFor(channel));
        if (problem) return failWith(problem);
        await ensureGuild(guildId);
        const posted = await postPagination(channel, { pages: [found.source], kind: found.kind, isPrivate: interaction.options.getBoolean('private') === true, member: interaction.member, lang });
        if (posted.error) return failWith(posted);
        const lines = [
          t(lang, 'pagination.done.created', { emoji: EMOJI.APPROVE, channel: `<#${channel.id}>`, url: posted.message.url }),
          t(lang, 'pagination.done.nextAdd', { command: prefixRef(`pagination add ${posted.message.url} <embed>`) }), // i18n-ignore: a command as it is typed
          ...(found.warnings ?? []).map((line) => `- ${line}`),
        ];
        return answer(lines.join('\n'));
      }

      const target = await resolveTarget(interaction, value('message'), lang);
      if (target.error) return failWith(target);
      const { channel, message } = target;
      const record = await db.getByMessage(guildId, message.id);

      if (sub === 'set') {
        if (record) return fail('alreadySet', { command: prefixRef(`pagination add ${message.url} <embed>`) }); // i18n-ignore: a command as it is typed
        const full = await limitReached(guildId);
        if (full) return fail(full.premium ? 'limit' : 'limitFree', { limit: full.limit, premium: full.premiumLimit });
        const snapshot = snapshotMessage(message);
        if (snapshot.error) return failWith(snapshot);
        await ensureGuild(guildId);
        await db.createPagination({ guildId, channelId: channel.id, messageId: message.id, kind: snapshot.kind, pages: [snapshot.source], isPrivate: interaction.options.getBoolean('private') === true, createdBy: interaction.user.id });
        return answer([
          t(lang, 'pagination.done.set', { emoji: EMOJI.APPROVE, url: message.url }),
          t(lang, 'pagination.done.nextAdd', { command: prefixRef(`pagination add ${message.url} <embed>`) }), // i18n-ignore: a command as it is typed
        ].join('\n'));
      }

      if (!record) return fail('notPaginated', { command: prefixRef(`pagination set ${message.url}`) }); // i18n-ignore: a command as it is typed
      const total = record.pages.length;

      if (sub === 'view') {
        const lines = record.pages.map((page, index) => `\`${index + 1}.\` ${pageLabel(page, lang)}`);
        return answer([
          t(lang, 'pagination.view.title', { url: message.url }),
          t(lang, record.private ? 'pagination.view.private' : 'pagination.view.shared', { pages: tn(lang, 'pagination.pages', total), kind: t(lang, `pagination.kind.${record.kind}`) }),
          '',
          ...lines,
        ].join('\n'), 0x8c7cff);
      }

      if (sub === 'restore') {
        const result = await showPage(interaction.client, record, 0, { lang });
        return result.error ? failWith(result) : answer(t(lang, total > 1 ? 'pagination.done.restored' : 'pagination.done.restoredOne', { emoji: EMOJI.APPROVE, url: message.url }));
      }

      if (sub === 'delete') {
        const purge = interaction.options.getBoolean('purge') === true;
        await db.deletePagination(record);
        if (purge) {
          await message.delete().catch(() => null);
          return answer(t(lang, 'pagination.done.deletedMessage', { emoji: EMOJI.APPROVE }));
        }
        await stripButtons(interaction.client, record);
        return answer(t(lang, 'pagination.done.deleted', { emoji: EMOJI.APPROVE, url: message.url }));
      }

      if (sub === 'mode') {
        const mode = value('mode');
        if (!['shared', 'private'].includes(mode)) return fail('usage.mode', { example: prefixRef(`pagination mode ${message.url} private`) }); // i18n-ignore: a command as it is typed
        await db.updatePagination(record, { isPrivate: mode === 'private' });
        return answer(t(lang, `pagination.done.mode.${mode}`, { emoji: EMOJI.APPROVE }));
      }

      if (sub === 'add') {
        if (!value('embed')) return fail('usage.add', { example: prefixRef(`pagination add ${message.url} my_embed`) }); // i18n-ignore: a command as it is typed
        if (total >= MAX_PAGES) return fail('full', { max: MAX_PAGES });
        const found = await sourceFromInput(value('embed'), { guildId, lang, getTemplate });
        if (found.error) return failWith(found);
        const mixed = mixingProblem(record.kind, found.kind);
        if (mixed) return fail(mixed);
        const problem = await checkPage(found, ctxFor(channel));
        if (problem) return failWith(problem);
        const updated = await db.updatePagination(record, { pages: [...record.pages, found.source] });
        const result = await showPage(interaction.client, updated, 0, { lang });
        return shown(result, [t(lang, 'pagination.done.added', { emoji: EMOJI.APPROVE, page: updated.pages.length, url: message.url }), ...(found.warnings ?? []).map((line) => `- ${line}`)].join('\n'));
      }

      if (sub === 'update') {
        const index = pageIndex(value('page'), total);
        if (index === null) return fail('badPage', { total });
        if (!value('embed')) return fail('usage.update', { example: prefixRef(`pagination update ${message.url} 2 my_embed`) }); // i18n-ignore: a command as it is typed
        const found = await sourceFromInput(value('embed'), { guildId, lang, getTemplate });
        if (found.error) return failWith(found);
        const mixed = mixingProblem(record.kind, found.kind);
        if (mixed) return fail(mixed);
        const problem = await checkPage(found, ctxFor(channel));
        if (problem) return failWith(problem);
        const pages = [...record.pages];
        pages[index] = found.source;
        const updated = await db.updatePagination(record, { pages });
        const result = await showPage(interaction.client, updated, 0, { lang });
        return shown(result, [t(lang, 'pagination.done.updated', { emoji: EMOJI.APPROVE, page: index + 1 }), ...(found.warnings ?? []).map((line) => `- ${line}`)].join('\n'));
      }

      if (sub === 'remove') {
        const index = pageIndex(value('page'), total);
        if (index === null) return fail('badPage', { total });
        if (total <= 1) return fail('lastPage', { command: prefixRef(`pagination delete ${message.url}`) }); // i18n-ignore: a command as it is typed
        const pages = record.pages.filter((_, at) => at !== index);
        const updated = await db.updatePagination(record, { pages });
        const result = await showPage(interaction.client, updated, 0, { lang });
        return shown(result, t(lang, 'pagination.done.removed', { emoji: EMOJI.APPROVE, page: index + 1, left: tn(lang, 'pagination.pages', pages.length) }));
      }

      if (sub === 'move') {
        const from = pageIndex(value('from'), total);
        const to = pageIndex(value('to'), total);
        if (from === null || to === null) return fail('badPage', { total });
        const pages = [...record.pages];
        const [moved] = pages.splice(from, 1);
        pages.splice(to, 0, moved);
        const updated = await db.updatePagination(record, { pages });
        const result = await showPage(interaction.client, updated, 0, { lang });
        return shown(result, t(lang, 'pagination.done.moved', { emoji: EMOJI.APPROVE, from: from + 1, to: to + 1 }));
      }
      return fail('noTarget');
    } catch (err) {
      logger.error(`Pagination ${sub} failed in guild ${guildId}:`, err);
      return fail('failed');
    }
  },
};
