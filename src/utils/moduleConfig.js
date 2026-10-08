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

const WIKI_URL = 'https://wiki.petto.sbs';
const MAX_ROWS = 28;
const MAX_LIST_ITEMS = 8;
const MAX_USAGE_LINES = 16;
const MAX_TEXT = 3800;

const ALWAYS_SKIPPED = /^(guild_id|id|created_at|updated_at|created_by|last_updated_at|next_bump_at|last_bumper_id|panel_message_id|message_id)$/;
const SNOWFLAKE = /^\d{15,25}$/;

/**
 * The modules. `command` is the command that changes the settings, `sources` where the settings live:
 * `show` keeps only the commands that configure (the ones that match, in that order). `{ table, only, skip, list }` reads a row of the server (or, with `list`, every row of the server) and shows the columns that match `only`
 * (a RegExp or a list of names) without the ones in `skip`.
 */
const MODULES = {
  brconfig: { aliases: ['boosterroleconfig', 'boosterconfig'], title: 'Booster roles', command: 'boosterrole', show: [/^admin (base|limit|share-limit|cooldown|link|cleanup)/, /^filter/], sources: [{ table: 'booster_role_config' }] },
  welcomeconfig: { aliases: [], title: 'Welcome', command: 'welcome', sources: [{ table: 'member_events_config', only: /^welcome_/ }] },
  leaveconfig: { aliases: [], title: 'Leave', command: 'leave', sources: [{ table: 'member_events_config', only: /^leave_/ }] },
  boostconfig: { aliases: [], title: 'Boost messages', command: 'boost', sources: [{ table: 'member_events_config', only: /^boost_/ }] },
  dmonjoinconfig: { aliases: [], title: 'DM on join', command: 'dmonjoin', sources: [{ table: 'member_events_config', only: /^dm_join_/ }] },
  joinroleconfig: { aliases: ['autoroleconfig'], title: 'Join roles', command: 'joinrole', sources: [{ table: 'join_roles', list: true, only: ['role_id', 'target'] }] },
  pojconfig: {
    aliases: [],
    title: 'Ping on join',
    command: 'poj',
    sources: [{ table: 'poj_config' }, { table: 'poj_channels', list: true, label: 'Channels', only: ['channel_id', 'delete_after_ms'] }],
  },
  automodconfig: {
    aliases: ['antinukeconfig', 'antiraidconfig', 'antialtconfig'],
    title: 'AutoMod and protection',
    command: 'automod',
    show: [/^raid/, /^anti-alt/, /^antinuke /, /^spam/, /^link/, /^word-filter toggle/, /^word-filter add/, /^invites allow/, /^immune add/, /^antinuke-whitelist add/, /^silent-channel add/, /^control/],
    sources: [
      { table: 'automod_config', label: 'AutoMod', skip: ['banned_words', 'allowed_invite_codes'] },
      { table: 'antinuke_config', label: 'Anti-nuke' },
    ],
  },
  logsconfig: { aliases: ['logconfig'], title: 'Logs', command: 'logs', sources: [{ table: 'log_entries', list: true, group: { by: 'channel_id', collect: 'event' } }] },
  levelconfig: { aliases: ['xpconfig'], title: 'Levels', command: 'level', show: [/^enable/, /^xp/, /^cooldown/, /^curve/, /^max-level/, /^notify/, /^role-mode/, /^ignore/, /^join/, /^voice-enable/, /^voice-xp/, /^reward add/, /^multiplier set/, /^event add/, /^rank-style/, /^status/], sources: [{ table: 'level_config', skip: ['notify_embed_template', 'notify_message'] }] },
  starboardconfig: { aliases: [], title: 'Starboard', command: 'starboard', sources: [{ table: 'starboards' }] },
  giveawayconfig: { aliases: [], title: 'Giveaways', command: 'giveaway', show: [/^embed/, /^reaction/, /^entry-mode/, /^template/, /^winner-message/, /^deny-message/, /^accept-message/, /^no-entries-message/, /^claim-time/, /^message-template/], sources: [{ table: 'giveaway_config', only: ['reaction', 'entry_mode', 'embed_template'] }] },
  ticketconfig: { aliases: [], title: 'Tickets', command: 'ticket', show: [/^setup/, /^panel create/, /^category (add|edit)/, /^support-role add/, /^ping-role add/, /^required-role add/, /^form create/, /^blacklist add/, /^panel (resend|delete)/, /^category remove/], sources: [{ table: 'ticket_settings' }] },
  verifyconfig: { aliases: [], title: 'Verification', command: 'verify', sources: [{ table: 'verification_config' }] },
  bumpconfig: { aliases: ['bumpreminderconfig'], title: 'Bump reminder', command: 'bumpreminder', sources: [{ table: 'bump_reminders', skip: ['message', 'thankyou'] }] },
  vmconfig: { aliases: ['voicemasterconfig'], title: 'VoiceMaster', command: 'voicemaster', show: [/^setup/, /^disable/, /^info/, /^panel/], sources: [{ table: 'voice_configs' }] },
  stickyrolesconfig: { aliases: [], title: 'Sticky roles', command: 'stickyroles', sources: [{ table: 'sticky_roles_config' }] },
  honeypotconfig: { aliases: [], title: 'Honeypots', command: 'honeypot', sources: [{ table: 'honeypots', list: true, only: ['channel_id', 'punishment', 'caught_count'] }] },
  counterconfig: { aliases: [], title: 'Counters', command: 'counter', sources: [{ table: 'server_counters', list: true, only: ['channel_id', 'counter_option', 'enabled'] }] },
  jailconfig: { aliases: [], title: 'Jail', command: 'jail', show: [/^setup/], sources: [{ table: 'jail_config' }] },
  autothreadconfig: { aliases: [], title: 'Auto threads', command: 'autothread', sources: [{ table: 'auto_threads', list: true, only: ['channel_id', 'name_template'] }] },
  autoresponderconfig: { aliases: [], title: 'Autoresponders', command: 'autoresponder', sources: [{ table: 'auto_responders', list: true, only: ['trigger', 'match_mode', 'reply_type'] }] },
  reactionroleconfig: { aliases: [], title: 'Reaction roles', command: 'reactionrole', sources: [{ table: 'reaction_roles', list: true, only: ['channel_id', 'emoji', 'role_id', 'mode'] }] },
  stickymessageconfig: { aliases: [], title: 'Sticky messages', command: 'stickymessage', sources: [{ table: 'sticky_messages', list: true, only: ['channel_id'] }] },
};

const sentence = (column) => {
  const words = column.replace(/_(ids?|ms|seconds|minutes|hours|days)$/, '').replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const mention = (column, id) => {
  if (/role/.test(column)) return `<@&${id}>`;
  if (/channel|category|parent/.test(column)) return `<#${id}>`;
  if (/user|whitelist|bumper/.test(column)) return `<@${id}>`;
  return `\`${id}\``;
};

/** One stored value, written for a person: mentions for ids, On/Off, durations, and "not set" for nothing. */
function formatValue(column, value) {
  if (value === null || value === undefined || value === '') return '*not set*';
  if (typeof value === 'boolean') return value ? '**On**' : '**Off**';
  if (Array.isArray(value)) {
    if (!value.length) return '*none*';
    const shown = value.slice(0, 10).map((item) => (SNOWFLAKE.test(String(item)) ? mention(column, item) : `\`${item}\``));
    return shown.join(' ') + (value.length > 10 ? ` +${value.length - 10} more` : '');
  }
  if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) && !SNOWFLAKE.test(value))) {
    const number = Number(value);
    if (/_ms$/.test(column)) return number > 0 ? formatDuration(number) : '*none*';
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


function rowLines(row, source) {
  const prefix = source.only instanceof RegExp ? source.only : null; // "welcome_channel_id" is shown as "Channel"
  return Object.entries(row)
    .filter(([column]) => matches(column, source.only, source.skip))
    .map(([column, value]) => `- ${sentence(prefix ? column.replace(prefix, '') : column)}: ${formatValue(column, value)}`);
}

function groupLines(rows, { by, collect }) {
  const groups = new Map();
  for (const row of rows) groups.set(row[by], [...(groups.get(row[by]) ?? []), row[collect]]);
  return [...groups.entries()].slice(0, MAX_LIST_ITEMS).map(([key, items]) => `- ${formatValue(by, key)}: ${items.slice(0, 12).map((item) => `\`${item}\``).join(', ')}${items.length > 12 ? ` +${items.length - 12}` : ''}`);
}

/** The lines of the current settings of one source, or null when the server has nothing stored for it. */
async function sourceLines(source, guildId) {
  const query = database.from(source.table).select('*').eq('guild_id', guildId);
  if (source.list) {
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) return null;
    const lines = source.group
      ? groupLines(data, source.group)
      : data.slice(0, MAX_LIST_ITEMS).map((row) => `- ${Object.entries(row).filter(([column]) => matches(column, source.only, source.skip)).map(([column, value]) => formatValue(column, value)).join(' · ')}`);
    if (!source.group && data.length > MAX_LIST_ITEMS) lines.push(`-# +${data.length - MAX_LIST_ITEMS} more`);
    return [`${data.length} configured`, ...lines];
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return rowLines(data, source);
}

async function settingsText(module, guildId) {
  const parts = [];
  for (const source of module.sources) {
    let lines;
    try {
      lines = await sourceLines(source, guildId);
    } catch (err) {
      logger.warn(`Could not read ${source.table} for a config card:`, err.message);
      parts.push('*Could not read these settings right now.*');
      continue;
    }
    const heading = source.label && module.sources.length > 1 ? `**${source.label}**\n` : '';
    if (!lines?.length) {
      if (module.sources.length === 1 || source.label) parts.push(`${heading}*Nothing is set up yet.*`);
      continue;
    }
    const [first, ...rest] = source.list ? lines : [null, ...lines];
    parts.push(`${heading}${source.list ? `-# ${first}\n` : ''}${rest.slice(0, MAX_ROWS).join('\n')}`);
  }
  return parts.length ? parts.join('\n\n') : '*Nothing is set up yet.*';
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

/** Keeps the commands that configure the module, in the order of `show` (every command when it is not given). The first word is the command. */
function pickUsage(lines, show) {
  if (!show) return lines;
  const rank = (line) => show.findIndex((pattern) => pattern.test(line.split(' ').slice(1).join(' ')));
  return lines.map((line) => ({ line, at: rank(line) })).filter((item) => item.at !== -1).sort((a, b) => a.at - b.at).map((item) => item.line);
}

/** The text of the card for a server: the current settings and the commands that change them. */
async function buildCardText(module, { guildId, prefix, commands }) {
  const command = commands?.get(module.command);
  const usage = command ? pickUsage(usagePaths(command.data.toJSON()), module.show) : [];
  const shown = usage.slice(0, MAX_USAGE_LINES).map((line) => `${prefix}${line}`);
  const parts = [
    `### ${module.title} config`,
    await settingsText(module, guildId),
    shown.length
      ? `**Change it**\n\`\`\`\n${shown.join('\n')}\n\`\`\`${usage.length > shown.length ? `\n-# +${usage.length - shown.length} more, see \`${prefix}help ${module.command}\`` : ''}`
      : `-# Change it with \`${prefix}help ${module.command}\`.`,
  ];
  const text = parts.join('\n');
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 20)}\n...` : text;
}

function createConfigCommand(name) {
  const module = MODULES[name];
  return {
    prefixOnly: true,
    aliases: module.aliases,
    configModule: module,
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(`Show the ${module.title.toLowerCase()} settings and how to change them.`.slice(0, 100))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setDMPermission(false),

    async execute(interaction) {
      const guildConfig = await ensureGuild(interaction.guild.id).catch(() => null);
      const text = await buildCardText(module, { guildId: interaction.guild.id, prefix: guildConfig?.prefix || '!', commands: interaction.client.commands });
      const container = new ContainerBuilder()
        .setAccentColor(0x4b4f59)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Documentation').setStyle(ButtonStyle.Link).setURL(WIKI_URL)));
      await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },
  };
}

module.exports = { MODULES, createConfigCommand, buildCardText, formatValue, usagePaths, pickUsage };
