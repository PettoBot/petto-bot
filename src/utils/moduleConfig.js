// `!<module>config`: one card per module with what the server has set now and the commands to change it. The values are read from the
// tables of each module, and the commands are taken from the definition of the module's own command, so they are always real.
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const database = require('../db/database');
const { ensureGuild } = require('../db/guilds');
const { formatDuration } = require('./duration');
const logger = require('./logger');
const { t, tn, currentLanguage, commandDescription, languageOf, DEFAULT_LANGUAGE } = require('../i18n');

const WIKI_URL = 'https://wiki.petto.sbs';
const MAX_ROWS = 28;
const MAX_LIST_ITEMS = 8;
const MAX_TEXT = 3800;

const ALWAYS_SKIPPED = /^(guild_id|id|created_at|updated_at|created_by|last_updated_at|next_bump_at|last_bumper_id|panel_message_id|message_id)$/;
const SNOWFLAKE = /^\d{15,25}$/;

/**
 * The modules. `command` is the command that changes the settings, `sources` where the settings live:
 * `show` lists the commands that configure the module (shown first, in that order; the others come after). `{ table, only, skip, list }` reads a row of the server (or, with `list`, every row of the server) and shows the columns that match `only`
 * (a RegExp or a list of names) without the ones in `skip`. Titles and labels are the English texts of the catalog (config.module.*,
 * config.source.*); the cards show them in the language of the server.
 */
const MODULES = {
  brconfig: { aliases: ['boosterroleconfig', 'boosterconfig'], title: t('en', 'config.module.brconfig.title'), command: 'boosterrole', show: [/^admin (base|limit|share-limit|cooldown|link|cleanup)/, /^filter/], sources: [{ table: 'booster_role_config' }] },
  welcomeconfig: { aliases: [], title: t('en', 'config.module.welcomeconfig.title'), command: 'welcome', sources: [{ table: 'member_events_config', only: /^welcome_/ }] },
  leaveconfig: { aliases: [], title: t('en', 'config.module.leaveconfig.title'), command: 'leave', sources: [{ table: 'member_events_config', only: /^leave_/ }] },
  boostconfig: { aliases: [], title: t('en', 'config.module.boostconfig.title'), command: 'boost', sources: [{ table: 'member_events_config', only: /^boost_/ }] },
  dmonjoinconfig: { aliases: [], title: t('en', 'config.module.dmonjoinconfig.title'), command: 'dmonjoin', sources: [{ table: 'member_events_config', only: /^dm_join_/ }] },
  joinroleconfig: { aliases: ['autoroleconfig'], title: t('en', 'config.module.joinroleconfig.title'), command: 'joinrole', sources: [{ table: 'join_roles', list: true, only: ['role_id', 'target'] }] },
  pojconfig: {
    aliases: [],
    title: t('en', 'config.module.pojconfig.title'),
    command: 'poj',
    sources: [{ table: 'poj_config' }, { table: 'poj_channels', list: true, label: t('en', 'config.source.poj_channels'), only: ['channel_id', 'delete_after_ms'] }],
  },
  automodconfig: {
    aliases: ['antinukeconfig', 'antiraidconfig', 'antialtconfig'],
    title: t('en', 'config.module.automodconfig.title'),
    command: 'automod',
    show: [/^raid/, /^anti-alt/, /^antinuke /, /^spam/, /^link/, /^word-filter toggle/, /^word-filter add/, /^invites allow/, /^immune add/, /^antinuke-whitelist add/, /^silent-channel add/, /^template add/, /^native add/, /^strikes/, /^control/],
    sources: [
      { table: 'automod_config', label: t('en', 'config.source.automod_config'), skip: ['banned_words', 'allowed_invite_codes'] },
      { table: 'antinuke_config', label: t('en', 'config.source.antinuke_config') },
      { table: 'antinuke_rules', list: true, label: t('en', 'config.source.antinuke_rules'), only: ['rule', 'enabled', 'threshold', 'window_seconds', 'action'] },
      { table: 'automod_rules', list: true, label: t('en', 'config.source.automod_rules'), only: ['name', 'action', 'enabled', 'hits'] },
      { table: 'scam_config', label: t('en', 'config.source.scam_config'), skip: ['caught'] },
      { table: 'lockdown_config', label: t('en', 'config.source.lockdown_config') },
    ],
  },
  logsconfig: { aliases: ['logconfig'], title: t('en', 'config.module.logsconfig.title'), command: 'logs', sources: [{ table: 'log_entries', list: true, group: { by: 'channel_id', collect: 'event' } }] },
  levelconfig: { aliases: ['xpconfig'], title: t('en', 'config.module.levelconfig.title'), command: 'level', show: [/^enable/, /^xp/, /^cooldown/, /^curve/, /^max-level/, /^notify/, /^role-mode/, /^ignore/, /^join/, /^voice-enable/, /^voice-xp/, /^reward add/, /^multiplier set/, /^event add/, /^rank-style/, /^status/], sources: [{ table: 'level_config', skip: ['notify_embed_template', 'notify_message'] }] },
  starboardconfig: { aliases: [], title: t('en', 'config.module.starboardconfig.title'), command: 'starboard', sources: [{ table: 'starboards' }] },
  suggestionconfig: { aliases: [], title: t('en', 'config.module.suggestionconfig.title'), command: 'suggestion', sources: [{ table: 'suggestion_config' }] },
  monkeyboardconfig: { aliases: [], title: t('en', 'config.module.monkeyboardconfig.title'), command: 'monkeyboard', sources: [{ table: 'monkeyboards' }] },
  giveawayconfig: { aliases: [], title: t('en', 'config.module.giveawayconfig.title'), command: 'giveaway', show: [/^embed/, /^reaction/, /^entry-mode/, /^template/, /^winner-message/, /^deny-message/, /^accept-message/, /^no-entries-message/, /^claim-time/, /^message-template/], sources: [{ table: 'giveaway_config', only: ['reaction', 'entry_mode', 'embed_template'] }] },
  ticketconfig: { aliases: [], title: t('en', 'config.module.ticketconfig.title'), command: 'ticket', show: [/^setup/, /^panel create/, /^category (add|edit)/, /^support-role add/, /^ping-role add/, /^required-role add/, /^form create/, /^blacklist add/, /^panel (resend|delete)/, /^category remove/], sources: [{ table: 'ticket_settings' }] },
  verifyconfig: { aliases: [], title: t('en', 'config.module.verifyconfig.title'), command: 'verify', sources: [{ table: 'verification_config' }] },
  bumpconfig: { aliases: ['bumpreminderconfig'], title: t('en', 'config.module.bumpconfig.title'), command: 'bumpreminder', sources: [{ table: 'bump_reminders', skip: ['message', 'thankyou'] }] },
  vmconfig: { aliases: ['voicemasterconfig'], title: t('en', 'config.module.vmconfig.title'), command: 'voicemaster', show: [/^setup/, /^disable/, /^info/, /^panel/], sources: [{ table: 'voice_configs' }] },
  stickyrolesconfig: { aliases: [], title: t('en', 'config.module.stickyrolesconfig.title'), command: 'stickyroles', sources: [{ table: 'sticky_roles_config' }] },
  honeypotconfig: { aliases: [], title: t('en', 'config.module.honeypotconfig.title'), command: 'honeypot', sources: [{ table: 'honeypots', list: true, only: ['channel_id', 'punishment', 'caught_count'] }] },
  countingconfig: { aliases: [], title: t('en', 'config.module.countingconfig.title'), command: 'counting', sources: [{ table: 'counting_config', skip: ['current_number', 'last_user_id', 'last_message_id', 'high_score', 'total_correct', 'total_wrong', 'saves', 'top_user_id', 'top_correct'] }] },
  counterconfig: { aliases: [], title: t('en', 'config.module.counterconfig.title'), command: 'counter', sources: [{ table: 'server_counters', list: true, only: ['channel_id', 'counter_option', 'enabled'] }, { table: 'counter_announce_config', label: t('en', 'config.source.counter_announce_config'), only: ['enabled', 'channel_id', 'every', 'use_goals', 'embed_name', 'last_announced'] }] },
  jailconfig: { aliases: [], title: t('en', 'config.module.jailconfig.title'), command: 'jail', show: [/^setup/], sources: [{ table: 'jail_config' }] },
  autothreadconfig: { aliases: [], title: t('en', 'config.module.autothreadconfig.title'), command: 'autothread', sources: [{ table: 'auto_threads', list: true, only: ['channel_id', 'name_template'] }] },
  autoresponderconfig: { aliases: [], title: t('en', 'config.module.autoresponderconfig.title'), command: 'autoresponder', sources: [{ table: 'auto_responders', list: true, only: ['trigger', 'match_mode', 'reply_type'] }] },
  reactionroleconfig: { aliases: [], title: t('en', 'config.module.reactionroleconfig.title'), command: 'reactionrole', sources: [{ table: 'reaction_roles', list: true, only: ['channel_id', 'emoji', 'role_id', 'mode'] }] },
  customcommandconfig: { aliases: [], title: t('en', 'config.module.customcommandconfig.title'), command: 'customcommand', sources: [{ table: 'custom_commands', list: true, only: ['name', 'embed_template'] }] },
  disablecommandconfig: { aliases: [], title: t('en', 'config.module.disablecommandconfig.title'), command: 'disablecommand', sources: [{ table: 'disabled_commands', list: true, only: ['command', 'channel_id'] }] },
  reactionconfig: { aliases: ['reactreplyconfig'], title: t('en', 'config.module.reactionconfig.title'), command: 'reaction', sources: [{ table: 'reaction_triggers', list: true, only: ['emoji', 'trigger', 'enabled'] }] },
  timerconfig: { aliases: [], title: t('en', 'config.module.timerconfig.title'), command: 'timer', sources: [{ table: 'auto_messages', list: true, only: ['channel_id', 'interval_ms'] }] },
  aliasconfig: { aliases: [], title: t('en', 'config.module.aliasconfig.title'), command: 'alias', sources: [{ table: 'command_aliases', list: true, only: ['name', 'command'] }] },
  senderconfig: { aliases: [], title: t('en', 'config.module.senderconfig.title'), command: 'sender', sources: [{ table: 'sender_identities', list: true, only: ['feature', 'name'] }] },
  sanctionmessageconfig: { aliases: [], title: t('en', 'config.module.sanctionmessageconfig.title'), command: 'sanctionmessage', sources: [{ table: 'sanction_templates', list: true, only: ['type'] }] },
  giveawaypresetconfig: { aliases: [], title: t('en', 'config.module.giveawaypresetconfig.title'), command: 'giveawaypreset', sources: [{ table: 'giveaway_presets', list: true, only: ['name'] }] },
  giveawaytemplateconfig: { aliases: [], title: t('en', 'config.module.giveawaytemplateconfig.title'), command: 'giveawaytemplate', sources: [{ table: 'giveaway_templates', list: true, only: ['name'] }] },
  prefixconfig: { aliases: [], title: t('en', 'config.module.prefixconfig.title'), command: 'prefix', sources: [{ table: 'guilds', only: ['prefix', 'language', 'mute_role_id', 'setup_channel_id'] }] },
  reportconfig: { aliases: [], title: t('en', 'config.module.reportconfig.title'), command: 'report', sources: [{ table: 'report_config' }] },
  permissionconfig: {
    aliases: [],
    title: t('en', 'config.module.permissionconfig.title'),
    command: 'permission',
    sources: [
      { table: 'permission_groups', list: true, label: t('en', 'config.source.permission_groups'), only: ['name', 'level'] },
      { table: 'command_permission_levels', list: true, label: t('en', 'config.source.command_permission_levels'), only: ['command_name', 'required_level'] },
    ],
  },
  backupconfig: { aliases: [], title: t('en', 'config.module.backupconfig.title'), command: 'backup', sources: [{ table: 'guild_backups', list: true, only: ['backup_number', 'label', 'source'] }] },
  panelconfig: { aliases: [], title: t('en', 'config.module.panelconfig.title'), command: 'panel', sources: [{ table: 'component_panels', list: true, only: ['name', 'kind', 'channel_id'] }] },
  formconfig: { aliases: ['formsconfig', 'applicationconfig'], title: t('en', 'config.module.formconfig.title'), command: 'form', show: [/^create/, /^question add/, /^set/, /^message/, /^open/, /^panel/, /^submissions/, /^retention/], sources: [{ table: 'form_config', only: ['retention_days'] }, { table: 'forms', list: true, only: ['name', 'status', 'review_channel_id'] }] },
  responderconfig: { aliases: [], title: t('en', 'config.module.responderconfig.title'), command: 'responder', sources: [{ table: 'button_responders', list: true, only: ['name', 'label'] }] },
  warnconfig: { aliases: ['escalationconfig'], title: t('en', 'config.module.warnconfig.title'), command: 'warn', sources: [{ table: 'warn_escalation_rules', list: true, only: ['warn_count', 'action', 'duration_ms'] }] },
  embedconfig: { aliases: ['embedsconfig'], title: t('en', 'config.module.embedconfig.title'), command: 'embed', sources: [{ table: 'embed_templates', list: true, only: ['name'] }] },
  webhookconfig: { aliases: [], title: t('en', 'config.module.webhookconfig.title'), command: 'webhook', sources: [{ table: 'managed_webhooks', list: true, only: ['name', 'channel_id', 'enabled'] }] },
  stickymessageconfig: { aliases: [], title: t('en', 'config.module.stickymessageconfig.title'), command: 'stickymessage', sources: [{ table: 'sticky_messages', list: true, only: ['channel_id'] }] },
};

const MODULE_NAMES = new Map(Object.entries(MODULES).map(([name, module]) => [module, name]));

const sentence = (column) => {
  const words = column.replace(/_(ids?|ms|seconds|minutes|hours|days)$/, '').replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The label of a column in `lang` (`config.column.<column>`); a column without a translation keeps the English made from its name. */
function columnLabel(column, lang) {
  const key = `config.column.${column}`;
  const text = t(lang, key);
  return text === key ? sentence(column) : text;
}

/** The title of a module in `lang`; a generated card is titled with the command name, which is never translated. */
function moduleTitle(module, lang) {
  const name = MODULE_NAMES.get(module);
  return name ? t(lang, `config.module.${name}.title`) : module.title;
}

/** The heading of a source of settings in `lang`. */
const sourceLabel = (source, lang) => t(lang, `config.source.${source.table}`);

const mention = (column, id) => {
  if (/role/.test(column)) return `<@&${id}>`;
  if (/channel|category|parent/.test(column)) return `<#${id}>`;
  if (/user|whitelist|bumper/.test(column)) return `<@${id}>`;
  return `\`${id}\``;
};

/** One stored value, written for a person: mentions for ids, On/Off, durations, and "not set" for nothing. */
function formatValue(column, value, lang = currentLanguage()) {
  if (value === null || value === undefined || value === '') return t(lang, 'config.card.notSet');
  if (typeof value === 'boolean') return value ? t(lang, 'config.card.on') : t(lang, 'config.card.off');
  if (Array.isArray(value)) {
    if (!value.length) return t(lang, 'config.card.none');
    const shown = value.slice(0, 10).map((item) => (SNOWFLAKE.test(String(item)) ? mention(column, item) : `\`${item}\``));
    return shown.join(' ') + (value.length > 10 ? ` ${t(lang, 'config.card.more', { count: value.length - 10 })}` : '');
  }
  if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) && !SNOWFLAKE.test(value))) {
    const number = Number(value);
    if (/_ms$/.test(column)) return number > 0 ? formatDuration(number, lang) : t(lang, 'config.card.none');
    if (/_seconds$/.test(column)) return `${number}s`;
    if (/_minutes$/.test(column)) return `${number} min`;
    if (/_hours$/.test(column)) return `${number}h`;
    if (/_days$/.test(column)) return `${number}d`;
    return `\`${number}\``;
  }
  if (typeof value === 'string' && SNOWFLAKE.test(value)) return mention(column, value);
  const text = String(value).replace(/\s+/g, ' ').trim();
  return `\`${text.length > 70 ? `${text.slice(0, 67)}...` : text}\``;
}

function matches(column, only, skip) {
  if (ALWAYS_SKIPPED.test(column) || skip?.includes(column)) return false;
  if (!only) return true;
  return Array.isArray(only) ? only.includes(column) : only.test(column);
}


// The stored default welcome text is the English one; the welcome module shows it in the language of the server.
const DEFAULT_TEXT_COLUMNS = new Set(['welcome_message', 'dm_join_message']);
function shownValue(column, value, lang) {
  if (!DEFAULT_TEXT_COLUMNS.has(column) || typeof value !== 'string') return value;
  const { localizeDefaultText } = require('./memberEventMessage');
  return typeof localizeDefaultText === 'function' ? localizeDefaultText('welcome', value, lang) : value;
}

function rowLines(row, source, lang) {
  const prefix = source.only instanceof RegExp ? source.only : null; // "welcome_channel_id" is shown as "Channel"
  return Object.entries(row)
    .filter(([column]) => matches(column, source.only, source.skip))
    .map(([column, value]) => `- ${columnLabel(prefix ? column.replace(prefix, '') : column, lang)}: ${formatValue(column, shownValue(column, value, lang), lang)}`);
}

function groupLines(rows, { by, collect }, lang) {
  const groups = new Map();
  for (const row of rows) groups.set(row[by], [...(groups.get(row[by]) ?? []), row[collect]]);
  return [...groups.entries()].slice(0, MAX_LIST_ITEMS).map(([key, items]) => `- ${formatValue(by, key, lang)}: ${items.slice(0, 12).map((item) => `\`${item}\``).join(', ')}${items.length > 12 ? ` +${items.length - 12}` : ''}`);
}

/** The lines of the current settings of one source, or null when the server has nothing stored for it. */
async function sourceLines(source, guildId, lang) {
  const query = database.from(source.table).select('*').eq('guild_id', guildId);
  if (source.list) {
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) return null;
    const lines = source.group
      ? groupLines(data, source.group, lang)
      : data.slice(0, MAX_LIST_ITEMS).map((row) => `- ${Object.entries(row).filter(([column]) => matches(column, source.only, source.skip)).map(([column, value]) => formatValue(column, value, lang)).join(' · ')}`);
    if (!source.group && data.length > MAX_LIST_ITEMS) lines.push(`-# ${t(lang, 'config.card.more', { count: data.length - MAX_LIST_ITEMS })}`);
    return [tn(lang, 'config.card.configured', data.length, { count: data.length }), ...lines];
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return rowLines(data, source, lang);
}

async function settingsText(module, guildId, lang) {
  const parts = [];
  for (const source of module.sources) {
    let lines;
    try {
      lines = await sourceLines(source, guildId, lang);
    } catch (err) {
      logger.warn(`Could not read ${source.table} for a config card:`, err.message);
      parts.push(t(lang, 'config.card.unreadable'));
      continue;
    }
    const heading = source.label && module.sources.length > 1 ? `**${sourceLabel(source, lang)}**\n` : '';
    if (!lines?.length) {
      if (module.sources.length === 1 || source.label) parts.push(`${heading}${t(lang, 'config.card.nothing')}`);
      continue;
    }
    const [first, ...rest] = source.list ? lines : [null, ...lines];
    parts.push(`${heading}${source.list ? `-# ${first}\n` : ''}${rest.slice(0, MAX_ROWS).join('\n')}`);
  }
  return parts.length ? parts.join('\n\n') : t(lang, 'config.card.nothing');
}

function optionToken(option) {
  return option.required ? `<${option.name}>` : `[${option.name}]`;
}

/** Every way of using a command: its subcommands (and groups) with their options, as `name sub <required> [optional]`. */
function usagePaths(json) {
  const options = json.options ?? [];
  const subs = options.filter((option) => option.type === 1 || option.type === 2);
  if (!subs.length) return [[json.name, ...options.filter((o) => !/^(ephemeral|silent)$/.test(o.name)).map(optionToken)].join(' ')];
  const lines = [];
  for (const sub of subs) {
    if (sub.type === 2) {
      for (const inner of sub.options ?? []) lines.push([json.name, sub.name, inner.name, ...(inner.options ?? []).map(optionToken)].join(' '));
    } else {
      lines.push([json.name, sub.name, ...(sub.options ?? []).filter((o) => !/^(ephemeral|silent)$/.test(o.name)).map(optionToken)].join(' '));
    }
  }
  return lines;
}

/** Splits the commands of a module into the ones that configure it (the ones of `show`, in that order) and all the others. */
function pickUsage(lines, show) {
  if (!show) return { config: lines, rest: [] };
  const rank = (line) => show.findIndex((pattern) => pattern.test(line.split(' ').slice(1).join(' ')));
  const ranked = lines.map((line) => ({ line, at: rank(line) }));
  return {
    config: ranked.filter((item) => item.at !== -1).sort((a, b) => a.at - b.at).map((item) => item.line),
    rest: ranked.filter((item) => item.at === -1).map((item) => item.line),
  };
}

const withoutOptions = (line) => line.split(' ').filter((token) => !/^[<[]/.test(token)).join(' ');

/** Commands that share everything but the last word go on one line: `ticket panel create`, `ticket panel delete` become `ticket panel create|delete`. */
function grouped(lines) {
  const groups = new Map();
  for (const line of lines.map(withoutOptions)) {
    const words = line.split(' ');
    const parent = words.length > 2 ? words.slice(0, -1).join(' ') : line;
    groups.set(parent, words.length > 2 ? [...(groups.get(parent) ?? []), words.at(-1)] : groups.get(parent) ?? []);
  }
  return [...groups.entries()].map(([parent, last]) => (last.length ? `${parent} ${last.join('|')}` : parent));
}

// From the most complete way of writing the commands to the shortest; the first one that fits is used.
const WRITERS = [(lines) => lines, (lines) => lines.map(withoutOptions), grouped];

const codeBlock = (lines, prefix) => `\`\`\`\n${lines.map((line) => `${prefix}${line}`).join('\n')}\n\`\`\``;

/** The text of the card for a server: the current settings and every command of the module, shortened when they do not fit. */
async function buildCardText(module, { guildId, prefix, commands, lang = currentLanguage() }) {
  const command = commands?.get(module.command);
  const { config, rest } = command ? pickUsage(usagePaths(command.data.toJSON()), module.show) : { config: [], rest: [] };
  // A generated card is titled with its command: "Poll" in English, the command as it is typed (`!poll`) in the other languages,
  // where the capitalized English name would read as an English word.
  const generatedTitle = lang === DEFAULT_LANGUAGE ? module.title : `\`${prefix}${module.command}\``;
  const head = module.generated
    ? `### ${generatedTitle}\n-# ${command ? commandDescription(lang, command, [], null, command.data.toJSON().description ?? '') : ''}`
    : [t(lang, 'config.card.heading', { title: moduleTitle(module, lang) }), await settingsText(module, guildId, lang)].join('\n');
  if (!config.length && !rest.length) return `${head}\n${t(lang, 'config.card.changeWithHelp', { prefix, command: module.command })}`;

  const render = (write) => {
    const sections = [head];
    if (config.length) sections.push(`**${t(lang, rest.length ? 'config.card.changeIt' : 'config.card.commands')}**\n${codeBlock(write(config), prefix)}`);
    if (rest.length) sections.push(`**${t(lang, config.length ? 'config.card.moreCommands' : 'config.card.commands')}**\n${codeBlock(write(rest), prefix)}`);
    return sections.join('\n');
  };
  for (const write of WRITERS) {
    const text = render(write);
    if (text.length <= MAX_TEXT) return text;
  }
  // Even the shortest way does not fit: keep the start and point to !help.
  const text = render(grouped);
  return `${text.slice(0, MAX_TEXT - 120).replace(/\n[^\n]*$/, '')}\n\`\`\`\n${t(lang, 'config.card.moreInHelp', { prefix, command: module.command })}`;
}

function createConfigCommand(name, module = MODULES[name]) {
  return {
    prefixOnly: true,
    aliases: module.aliases,
    configModule: module,
    data: new SlashCommandBuilder()
      .setName(name)
      // i18n-ignore: builder description, translated through the cmd.<category> catalogs
      .setDescription((module.generated ? `Show how to use ${module.command} and all its commands.` : `Show the ${module.title.toLowerCase()} settings and how to change them.`).slice(0, 100))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setDMPermission(false),

    async execute(interaction) {
      const lang = await languageOf(interaction);
      const guildConfig = await ensureGuild(interaction.guild.id).catch(() => null);
      const text = await buildCardText(module, { guildId: interaction.guild.id, prefix: guildConfig?.prefix || '!', commands: interaction.client.commands, lang });
      const container = new ContainerBuilder()
        .setAccentColor(0x4b4f59)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(t(lang, 'config.card.docs.button')).setStyle(ButtonStyle.Link).setURL(WIKI_URL)));
      await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },
  };
}

/**
 * A card for every command that has none of its own, made when the commands are loaded: it shows what the command does and every way of using it.
 * Nothing has to be listed by hand, so a new command gets its `!<command>config` the day it is added.
 */
function addGeneratedCards(client) {
  const taken = (name) => client.commands.has(name) || client.commandAliases.has(name);
  let added = 0;
  for (const command of [...client.commands.values()]) {
    const json = command.data?.toJSON?.();
    const name = json?.name;
    const card = `${name}config`;
    if (!json || (json.type ?? 1) !== 1 || command.category === 'roleplay' || command.configModule || command.generatedCard) continue;
    if (command.hiddenFromHelp || command.slashOnly || command.privateGuildId) continue;
    if (name.endsWith('config') || card.length > 32 || !/^[a-z0-9_-]+$/.test(name) || taken(card)) continue;
    const generated = createConfigCommand(card, { aliases: [], title: name.charAt(0).toUpperCase() + name.slice(1), command: name, sources: [], generated: true });
    generated.category = command.category;
    generated.hiddenFromHelp = true;
    generated.generatedCard = true;
    client.commands.set(card, generated);
    added += 1;
  }
  addAliasCards(client);
  return added;
}

/** A command that answers to a short name has a card under it too: `!ar` is `!autoresponder`, so `!arconfig` is `!autoresponderconfig`. */
function addAliasCards(client) {
  for (const card of [...client.commands.values()]) {
    if (!card.configModule) continue;
    const target = client.commands.get(card.configModule.command);
    for (const alias of (target?.aliases ?? []).filter((name) => !name.endsWith('config'))) {
      const name = `${alias}config`;
      if (name.length > 32 || client.commands.has(name) || client.commandAliases.has(name)) continue;
      client.commandAliases.set(name, card.data.name);
      card.aliases = [...(card.aliases ?? []), name];
    }
  }
}

module.exports = { addGeneratedCards, MODULES, createConfigCommand, buildCardText, formatValue, usagePaths, pickUsage, grouped };
