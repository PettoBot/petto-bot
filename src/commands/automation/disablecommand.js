// !disablecommand (alias `dc`): switch commands off for the whole server or in some channels. The rules live in
// `disabled_commands` (src/db/disabledCommands.js), always under the real name of the command, the same rows the dashboard
// edits. The check itself is in messageCreateCommands.js and interactionCreate.js.
//
// The prefix takes the words in any order:
//   !dc suggest #cmds            !dc #cmds suggest            !dc suggest,rank,8ball #cmds #memes
//   !dc category:fun #general    !dc suggest all (server-wide) !dc list [#channel]
//   !dc enable suggest [#cmds]   !dc clear [#channel]          !dc enable all
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const disabledDb = require('../../db/disabledCommands');
const commandAliasesDb = require('../../db/commandAliases');
const { noticePayload } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');
const { EMOJI } = require('../../utils/emojis');
const { register, sendPager } = require('../../utils/pager');
const { t, tn, languageOf, formatNumber } = require('../../i18n');

// Commands that cannot be switched off, or nobody could switch anything back on or find out how.
const PROTECTED = new Set(['disablecommand', 'help']);
const MAX_AT_ONCE = 25;
const MAX_CHANNELS = 10;
// A page holds 4 groups of at most ~760 characters, inside the 3200 the pager fits on one page.
const GROUP_TEXT_LIMIT = 700;

// The first word of the prefix form, in the languages of Petto. Anything else is a command to disable.
const SUBCOMMAND_WORDS = {
  disable: 'disable', off: 'disable', block: 'disable', add: 'disable', desactivar: 'disable', bloquear: 'disable', desativar: 'disable',
  enable: 'enable', on: 'enable', unblock: 'enable', allow: 'enable', remove: 'enable', rm: 'enable', del: 'enable', delete: 'enable',
  activar: 'enable', desbloquear: 'enable', ativar: 'enable', quitar: 'enable', remover: 'enable',
  list: 'list', ls: 'list', show: 'list', view: 'list', rules: 'list', lista: 'list', ver: 'list',
  clear: 'clear', reset: 'clear', wipe: 'clear', limpiar: 'clear', limpar: 'clear',
};
// "The whole server" written where a channel would go: `!dc suggest all`.
const SERVER_WORDS = new Set(['all', 'server', 'everywhere', 'global', 'guild', '*', 'todo', 'todos', 'servidor', 'tudo']);
// Alone, these mean "every command" (`!dc enable all`); `server` alone is still the alias of `serverinfo`.
const ALL_WORDS = new Set(['all', '*', 'todo', 'todos', 'tudo']);
const CHANNEL_TOKEN = /^(<#\d{15,25}>|\d{15,25}|#[^\s,#<>]+)$/;
const CATEGORY_TOKEN = /^(?:category|cat|module|modulo|módulo|categoria|categoría):(.+)$/i;

/** Splits the text after the subcommand into command words and channel words (mentions, ids, #names). Pure, for the checks. */
function splitTarget(text) {
  const words = String(text ?? '').split(/[\s,]+/).map((word) => word.trim()).filter(Boolean);
  const channels = words.filter((word) => CHANNEL_TOKEN.test(word));
  let names = words.filter((word) => !CHANNEL_TOKEN.test(word)).map((word) => word.toLowerCase());
  const server = names.some((word) => SERVER_WORDS.has(word));
  // `all` next to commands is the place (the whole server); alone it is "every command" (`!dc enable all`).
  if (names.some((word) => !SERVER_WORDS.has(word))) names = names.filter((word) => !SERVER_WORDS.has(word));
  return { names, channels, server };
}

/**
 * The prefix form, turned into `<subcommand> <words>`: the subcommand can be left out (it is `disable`, or `list` when only
 * channels are written) and its word can come after a channel (`!dc #cmds suggest`).
 */
function prefixArgs(argText) {
  const words = String(argText ?? '').trim().split(/\s+/).filter(Boolean);
  const at = words.findIndex((word) => !CHANNEL_TOKEN.test(word));
  const sub = at >= 0 ? SUBCOMMAND_WORDS[words[at].toLowerCase()] : null;
  if (sub) words.splice(at, 1);
  const rest = words.join(' ');
  // Nothing, or only channels: the list (`!dc`, `!dc #cmds`).
  const chosen = sub ?? (words.every((word) => CHANNEL_TOKEN.test(word)) ? 'list' : 'disable');
  return rest ? `${chosen} ${rest}` : chosen;
}

/** The options of a subcommand read from the raw prefix text (see `prefixRawOptions`). */
function rawOptions(text) {
  const { names, channels } = splitTarget(text);
  const values = {};
  if (names.length) values.command = names.join(' ');
  if (channels.length) values.channel = channels.join(' ');
  return values;
}

/** The real name of a command written as a name, an alias, a shortcut or one of this server's aliases, or null. */
async function realName(client, guildId, raw) {
  const name = String(raw ?? '').trim().replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase();
  if (!name) return null;
  if (client.commands.has(name)) return name;
  const known = client.commandAliases?.get(name) ?? client.commandRoutes?.get(name)?.command;
  if (known) return known;
  const custom = guildId ? await commandAliasesDb.get(guildId, name).catch(() => null) : null;
  const target = custom?.command?.trim().split(/\s+/)[0]?.toLowerCase();
  if (target && target !== name) return client.commands.has(target) ? target : client.commandAliases?.get(target) ?? null;
  return null;
}

/** Commands of a category of `!help` (the folder they live in), the ones a member can run. */
function categoryCommands(client, category) {
  return [...client.commands.values()]
    .filter((command) => command.category === category && (command.data?.toJSON?.().type ?? 1) === 1 && !command.hiddenFromHelp)
    .map((command) => command.data.name);
}

function categories(client) {
  return new Set([...client.commands.values()].map((command) => command.category).filter(Boolean));
}

/** Closest command names to a word that is not one (at most two letters apart), for "did you mean". */
function closest(client, word) {
  const candidates = [...client.commands.keys(), ...(client.commandAliases?.keys?.() ?? [])];
  let best = null;
  for (const candidate of candidates) {
    if (Math.abs(candidate.length - word.length) > 2) continue;
    const distance = editDistance(word, candidate);
    if (distance <= 2 && (!best || distance < best.distance)) best = { name: client.commandAliases?.get(candidate) ?? candidate, distance };
  }
  return best?.name ?? null;
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/**
 * Reads the command words into real names. Categories (`category:fun`) bring every command in them.
 * @returns {Promise<{ names: string[], refused: string[], unknown: string[], hints: string[], fromCategory: boolean }>}
 */
async function resolveNames(interaction, words, { forEnable = false } = {}) {
  const { client } = interaction;
  const names = new Set();
  const refused = new Set();
  const unknown = [];
  const hints = [];
  let fromCategory = false;
  const known = categories(client);
  for (const word of words) {
    const category = CATEGORY_TOKEN.exec(word)?.[1]?.toLowerCase();
    if (category) {
      if (!known.has(category)) { unknown.push(word); continue; }
      fromCategory = true;
      for (const name of categoryCommands(client, category)) (PROTECTED.has(name) && !forEnable ? refused : names).add(name);
      continue;
    }
    const name = await realName(client, interaction.guild?.id, word);
    if (!name) {
      unknown.push(word);
      const guess = closest(client, word.replace(/^[^\p{L}\p{N}]+/u, ''));
      if (guess) hints.push(guess);
      continue;
    }
    if (PROTECTED.has(name) && !forEnable) refused.add(name);
    else names.add(name);
  }
  return { names: [...names], refused: [...refused], unknown, hints: [...new Set(hints)], fromCategory };
}

/** The channels of the rule: the slash option, or the channel words of the prefix form. */
function readChannels(interaction) {
  const value = interaction.options.getChannel('channel');
  if (!value) return { channels: [], missing: [] };
  if (typeof value !== 'string') return { channels: [value], missing: [] };
  const cache = interaction.guild?.channels?.cache;
  const channels = [];
  const missing = [];
  for (const token of value.split(/\s+/).filter(Boolean)) {
    const id = token.replace(/[<#>]/g, '');
    const name = token.replace(/^#/, '').toLowerCase();
    const channel = /^\d{15,25}$/.test(id) && cache?.get(id) ? cache.get(id) : cache?.find((c) => c.name?.toLowerCase() === name) ?? null;
    if (channel) { if (!channels.some((c) => c.id === channel.id)) channels.push(channel); } else missing.push(token);
  }
  return { channels, missing };
}

const tick = (list) => list.map((name) => `\`${name}\``).join(' · ');
const where = (lang, channels) => (channels.length ? channels.map((c) => `<#${c.id}>`).join(', ') : t(lang, 'automation.disable.wholeServer'));
const prefixOf = (interaction) => interaction.typedPrefix ?? '!';

function send(interaction, lines, color) {
  const text = lines.filter(Boolean).join('\n');
  return interaction.editReply(noticePayload(text, color));
}

register('blocked', {
  perPage: 4,
  async load(guild, { option, arg, lang }) {
    let rules = await disabledDb.listForGuild(guild.id);
    if (arg) rules = rules.filter((rule) => !rule.channel_id || rule.channel_id === arg);
    if (option === 'server') rules = rules.filter((rule) => !rule.channel_id);
    if (option === 'channel') rules = rules.filter((rule) => rule.channel_id);
    const groups = new Map();
    for (const rule of rules) {
      const key = rule.channel_id ?? '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(rule.command);
    }
    const ordered = [...groups.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
    const items = ordered.map(([channelId, commands]) => {
      commands.sort((a, b) => a.localeCompare(b));
      const heading = channelId
        ? t(lang, 'automation.disable.list.channelGroup', { channel: `<#${channelId}>`, count: tn(lang, 'automation.disable.list.commands', commands.length, { count: formatNumber(lang, commands.length) }) })
        : t(lang, 'automation.disable.list.serverGroup', { count: tn(lang, 'automation.disable.list.commands', commands.length, { count: formatNumber(lang, commands.length) }) });
      let body = '';
      let shown = 0;
      for (const name of commands) {
        const next = `${body ? `${body} · ` : ''}\`${name}\``;
        if (next.length > GROUP_TEXT_LIMIT) break;
        body = next;
        shown++;
      }
      if (shown < commands.length) body += ` ${t(lang, 'automation.disable.list.more', { count: formatNumber(lang, commands.length - shown) })}`;
      return `${heading}\n${body}`;
    });
    const places = groups.size;
    return {
      title: t(lang, 'automation.disable.list.title', { emoji: EMOJI.DENY }),
      subtitle: [rules.length ? t(lang, 'automation.disable.list.summary', { rules: tn(lang, 'automation.disable.list.rules', rules.length, { count: formatNumber(lang, rules.length) }), places: tn(lang, 'automation.disable.list.places', places, { count: formatNumber(lang, places) }) }) : guild.name],
      thumbnail: guild.iconURL?.({ size: 256 }) ?? null,
      items,
      footer: t(lang, 'automation.disable.list.footer'),
      options: arg ? undefined : [{ label: t(lang, 'automation.disable.list.all.menu'), value: 'all' }, { label: t(lang, 'automation.disable.list.server.menu'), value: 'server' }, { label: t(lang, 'automation.disable.list.channel.menu'), value: 'channel' }],
      placeholder: t(lang, 'automation.disable.list.show.menu'),
      empty: arg ? t(lang, 'automation.disable.noneIn', { emoji: EMOJI.APPROVE, channel: `<#${arg}>` }) : t(lang, 'automation.disable.none', { emoji: EMOJI.APPROVE }),
    };
  },
});

const channelOption = (description) => (o) => o.setName('channel').setDescription(description).setRequired(false);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('disablecommand')
    .setDescription('Turn commands off for the whole server or in some channels.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('disable').setDescription('Turn one or more commands off (aliases and category:<name> work).').addStringOption((o) => o.setName('command').setDescription('Commands without the prefix, several at once: "suggest rank 8ball" or "category:fun"').setRequired(true)).addChannelOption(channelOption('Only in this channel (default: the whole server)')))
    .addSubcommand((s) => s.setName('enable').setDescription('Turn commands back on, or "all" to remove every rule.').addStringOption((o) => o.setName('command').setDescription('Commands, or "all"').setRequired(true)).addChannelOption(channelOption('Only the rule of this channel (default: every rule of the command)')))
    .addSubcommand((s) => s.setName('list').setDescription('See the disabled commands, grouped by channel.').addChannelOption(channelOption('Only what applies in this channel')))
    .addSubcommand((s) => s.setName('clear').setDescription('Remove every rule, or only the ones of a channel.').addChannelOption(channelOption('Only the rules of this channel'))),
  aliases: ['dc'],
  prefixArgs,
  prefixRawOptions: { disable: rawOptions, enable: rawOptions, list: rawOptions, clear: rawOptions },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') return listCmd(interaction);
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const lang = await languageOf(interaction);
    const { channels, missing } = readChannels(interaction);
    if (missing.length) return send(interaction, [t(lang, 'automation.disable.noChannel', { emoji: EMOJI.DENY, channels: tick(missing) })], COLORS.RED);
    if (channels.length > MAX_CHANNELS) return send(interaction, [t(lang, 'automation.disable.tooManyChannels', { emoji: EMOJI.DENY, max: MAX_CHANNELS })], COLORS.RED);
    await ensureGuild(interaction.guild.id);
    if (sub === 'clear') return clearCmd(interaction, lang, channels);
    if (sub === 'enable') return enableCmd(interaction, lang, channels);
    return disableCmd(interaction, lang, channels);
  },
  splitTarget,
  realName,
  PROTECTED,
};

function commandWords(interaction) {
  return splitTarget(interaction.options.getString('command') ?? '').names;
}

async function disableCmd(interaction, lang, channels) {
  const prefix = prefixOf(interaction);
  const words = commandWords(interaction);
  if (!words.length || (words.length === 1 && ALL_WORDS.has(words[0]))) return send(interaction, [t(lang, 'automation.disable.needName', { emoji: EMOJI.WARNING }), t(lang, 'automation.disable.usage', { prefix })], COLORS.YELLOW);
  const { names, refused, unknown, hints, fromCategory } = await resolveNames(interaction, words);
  if (!fromCategory && names.length > MAX_AT_ONCE) return send(interaction, [t(lang, 'automation.disable.tooMany', { emoji: EMOJI.WARNING, max: MAX_AT_ONCE })], COLORS.YELLOW);

  const added = await disabledDb.disableMany(interaction.guild.id, names, channels.length ? channels.map((c) => c.id) : [null]);
  const done = [...new Set(added.map((row) => row.command))];
  const already = names.filter((name) => !done.includes(name));

  const lines = [];
  if (done.length) {
    lines.push(t(lang, channels.length ? 'automation.disable.doneChannel' : 'automation.disable.doneServer', { emoji: EMOJI.APPROVE, count: formatNumber(lang, done.length), channel: where(lang, channels) }));
    lines.push(tick(done));
  }
  if (already.length) lines.push(t(lang, 'automation.disable.already', { commands: tick(already) }));
  if (refused.length) lines.push(t(lang, 'automation.disable.refused', { commands: tick(refused) }));
  if (unknown.length) lines.push(t(lang, 'automation.disable.unknown', { commands: tick(unknown) }));
  if (hints.length) lines.push(t(lang, 'automation.disable.didYouMean', { commands: tick(hints) }));
  if (done.length) lines.push(`-# ${t(lang, 'automation.disable.undoHint', { prefix, command: done.length > 5 ? done.slice(0, 5).join(',') + ',…' : done.join(','), channel: channels[0] ? ` #${channels[0].name}` : '' })}`);
  return send(interaction, lines, done.length ? COLORS.GREEN : unknown.length || refused.length ? COLORS.RED : COLORS.DEFAULT);
}

async function enableCmd(interaction, lang, channels) {
  const words = commandWords(interaction);
  if (words.length === 1 && ALL_WORDS.has(words[0])) return clearCmd(interaction, lang, channels);
  if (!words.length) return send(interaction, [t(lang, 'automation.disable.needName', { emoji: EMOJI.WARNING }), t(lang, 'automation.disable.usage', { prefix: prefixOf(interaction) })], COLORS.YELLOW);
  const { names, unknown, hints } = await resolveNames(interaction, words, { forEnable: true });

  // No channel: every rule of the command goes (it works everywhere again). With channels: only their rules.
  const removed = await disabledDb.enableMany(interaction.guild.id, names, channels.length ? channels.map((c) => c.id) : null);
  const done = [...new Set(removed.map((row) => row.command))];
  const missing = names.filter((name) => !done.includes(name));

  const lines = [];
  if (done.length) {
    lines.push(t(lang, channels.length ? 'automation.enable.doneChannel' : 'automation.enable.doneEverywhere', { emoji: EMOJI.APPROVE, count: formatNumber(lang, done.length), channel: where(lang, channels) }));
    lines.push(tick(done));
  }
  if (missing.length) lines.push(t(lang, channels.length ? 'automation.enable.noRuleChannel' : 'automation.enable.noRule', { commands: tick(missing), channel: where(lang, channels) }));
  if (channels.length) {
    // A server-wide rule still stops the command in that channel.
    const stillOff = [];
    for (const name of names) if (await disabledDb.find(interaction.guild.id, name, null)) stillOff.push(name);
    if (stillOff.length) lines.push(t(lang, 'automation.enable.stillServer', { emoji: EMOJI.WARNING, commands: tick(stillOff) }));
  }
  if (unknown.length) lines.push(t(lang, 'automation.disable.unknown', { commands: tick(unknown) }));
  if (hints.length) lines.push(t(lang, 'automation.disable.didYouMean', { commands: tick(hints) }));
  return send(interaction, lines, done.length ? COLORS.GREEN : COLORS.DEFAULT);
}

async function clearCmd(interaction, lang, channels) {
  let count = 0;
  if (channels.length) for (const channel of channels) count += await disabledDb.clear(interaction.guild.id, channel.id);
  else count = await disabledDb.clear(interaction.guild.id);
  if (!count) return send(interaction, [channels.length ? t(lang, 'automation.disable.noneIn', { emoji: EMOJI.APPROVE, channel: where(lang, channels) }) : t(lang, 'automation.disable.none', { emoji: EMOJI.APPROVE })], COLORS.DEFAULT);
  return send(interaction, [tn(lang, channels.length ? 'automation.disable.clearedChannel' : 'automation.disable.cleared', count, { count: formatNumber(lang, count), emoji: EMOJI.APPROVE, channel: where(lang, channels) })], COLORS.GREEN);
}

async function listCmd(interaction) {
  const lang = await languageOf(interaction);
  const { channels, missing } = readChannels(interaction);
  if (missing.length) return interaction.reply(noticePayload(t(lang, 'automation.disable.noChannel', { emoji: EMOJI.DENY, channels: tick(missing) }), COLORS.RED));
  return sendPager(interaction, 'blocked', { arg: channels[0]?.id ?? '' });
}
