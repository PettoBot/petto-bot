// `!counter`: channels whose name shows a live number (members, humans, bots, boosts, online, a role, a goal, a clock...).
// Prefix only: the builder below is read by the prefix parser and never registered as a slash command.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const countersDb = require('../../db/counters');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { OPTIONS, NEEDS_PRESENCES, resolveOption, resolveFormat, validTimeZone, typeLabel, defaultTemplate, formatCount, templateMax, targetOf, NEEDS_ROLE, DB_TYPES } = require('../../utils/counterNames');
const { countGuild } = require('../../utils/counterValues');
const { createCounter, setupPreset, previewName, resolveKind, KINDS, KIND_OF_TYPE, TOPIC_TYPES } = require('../../utils/counterSetup');
const { parseEvery, nextMilestone, announcePayload, announceChannel, MAX_TEXT } = require('../../utils/counterAnnounce');
const { t, languageOf } = require('../../i18n');

// Loaded when used: the job pulls in the database layer and the scheduler.
const job = () => require('../../jobs/counterJob');

const EDIT_SETTINGS = ['template', 'format', 'type', 'role', 'goal', 'timezone', 'category', 'kind', 'prefix', 'suffix', 'interval', 'enabled'];
const OFF_WORDS = ['none', 'off', 'reset', 'clear', '-', 'auto'];
const MENTION = /^<#(\d{15,25})>$|^(\d{15,25})$/;

const data = new SlashCommandBuilder()
  .setName('counter')
  .setDescription('Live server counters as channel names.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('create').setDescription('Make a counter channel (locked: everyone sees it, nobody joins).')
    .addStringOption((o) => o.setName('type').setDescription('What to count: members, humans, bots, online, boosts, role, goal, clock...').setRequired(true))
    .addStringOption((o) => o.setName('template').setDescription('The name, with {count}').setRequired(false))
    .addChannelOption((o) => o.setName('category').setDescription('The category to put it in').setRequired(false)))
  .addSubcommand((s) => s.setName('setup').setDescription('Quick setup: a pack of counters (basic, boosts, online, goal, clock) in its own category.')
    .addStringOption((o) => o.setName('preset').setDescription('basic, boosts, online, goal or clock').setRequired(false)))
  .addSubcommand((s) => s.setName('list').setDescription('The counters of this server, with what they show.'))
  .addSubcommand((s) => s.setName('types').setDescription('Every counter type, with its value now.'))
  .addSubcommand((s) => s.setName('edit').setDescription('Change a counter: template, format, type, role, goal, timezone...')
    .addChannelOption((o) => o.setName('channel').setDescription('The counter channel').setRequired(true))
    .addStringOption((o) => o.setName('setting').setDescription('What to change').setRequired(true).addChoices(...EDIT_SETTINGS.map((name) => ({ name, value: name }))))
    .addStringOption((o) => o.setName('value').setDescription('The new value').setRequired(true)))
  .addSubcommand((s) => s.setName('delete').setDescription('Delete a counter and its channel ("keep" keeps the channel).')
    .addChannelOption((o) => o.setName('channel').setDescription('The counter channel').setRequired(true))
    .addStringOption((o) => o.setName('keep').setDescription('Write keep to keep the channel').setRequired(false)))
  .addSubcommand((s) => s.setName('refresh').setDescription('Update the counters now, within the rename limit of Discord.')
    .addChannelOption((o) => o.setName('channel').setDescription('Only this counter').setRequired(false)))
  .addSubcommand((s) => s.setName('announce').setDescription('A message when the server reaches a member goal, or every N members.')
    .addStringOption((o) => o.setName('setting').setDescription('channel, message, embed, every, goals, on, off or test').setRequired(false))
    .addStringOption((o) => o.setName('value').setDescription('The new value').setRequired(false)));

/**
 * Reads `!counter create <type> [name...] [category] [--format x --channel #c --kind voice --role @r --goal 500 --timezone Z]`.
 * The name is free text in the middle (quotes are optional), the category is a channel mention or ID at the end.
 * The old form `!counter add members voice` still works: a channel kind right after the type is the kind.
 */
function parseCreateText(text) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(text ?? '')))) tokens.push(m[1] ?? m[2] ?? m[3]);
  const values = {};
  const rest = [];
  const FLAGS = { format: 'format', channel: 'channel', kind: 'kind', role: 'role', goal: 'goal', timezone: 'timezone', tz: 'timezone', category: 'category', interval: 'interval' };
  for (let i = 0; i < tokens.length; i += 1) {
    const flag = /^--([a-z]+)$/i.exec(tokens[i]);
    if (flag && FLAGS[flag[1].toLowerCase()] && tokens[i + 1] !== undefined) { values[FLAGS[flag[1].toLowerCase()]] = tokens[i + 1]; i += 1; continue; }
    rest.push(tokens[i]);
  }
  if (rest.length) values.type = rest.shift();
  if (rest.length && KINDS[rest[0]?.toLowerCase()] !== undefined && !values.kind) values.kind = rest.shift().toLowerCase();
  if (rest.length && /^<@&\d+>$/.test(rest[0]) && !values.role) values.role = rest.shift();
  if (rest.length && MENTION.test(rest[rest.length - 1]) && !values.category) values.category = rest.pop();
  if (rest.length) values.template = rest.join(' ');
  return values;
}

const ok = (text) => textCard(text, 0xa5ea7a);
const note = (text) => textCard(text, 0x4b4f59);
const bad = (text) => textCard(text, 0xfe6465);

function prefixOf(interaction) {
  const content = String(interaction.rawMessage?.content ?? '').trim();
  const match = /^(\S{1,5}?)(?:counters?|ctr)\b/i.exec(content);
  return match?.[1] || '!';
}

function idOf(value) {
  if (!value) return null;
  if (typeof value === 'object') return value.id ?? null;
  const match = /(\d{15,25})/.exec(String(value));
  return match ? match[1] : null;
}

function channelFrom(guild, value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  const id = idOf(value);
  if (id) return guild.channels.cache.get(id) ?? null;
  const name = String(value).replace(/^#/, '').toLowerCase();
  return guild.channels.cache.find((c) => c.name.toLowerCase() === name) ?? null;
}

function roleFrom(guild, value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  const id = idOf(value);
  if (id) return guild.roles.cache.get(id) ?? null;
  const name = String(value).replace(/^@/, '').toLowerCase();
  return guild.roles.cache.find((r) => r.name.toLowerCase() === name) ?? null;
}

async function reply(interaction, card) {
  return interaction.reply({ components: [card], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

function createError(result, lang, prefix) {
  switch (result.error) {
    case 'unknownType': return t(lang, 'counters.create.unknownType', { type: result.type || '?', prefix });
    case 'unknownKind': return t(lang, 'counters.kind.unknown', { kind: result.kind || '?' });
    case 'topicNeedsText': return t(lang, 'counters.kind.topicNeedsText');
    case 'needRole': return t(lang, 'counters.create.needRole', { prefix });
    case 'badTimezone': return t(lang, 'counters.create.badTimezone', { zone: result.zone });
    case 'limit': return t(lang, 'counters.create.limit', { count: result.count });
    case 'limitFree': return t(lang, 'counters.create.limitFree', { count: result.count, premium: result.premium });
    case 'notCategory': return t(lang, 'counters.parentNotCategory');
    case 'notChannel': return t(lang, 'counters.notCounter');
    case 'alreadyCounter': return t(lang, 'counters.create.alreadyCounter', { channel: `${result.channel}`, prefix });
    case 'permission': return t(lang, 'counters.add.failedPermission', { permission: t(lang, 'core.perm.ManageChannels') });
    case 'already': return t(lang, 'counters.setup.already', { count: result.count, prefix });
    case 'unknownPreset': return t(lang, 'counters.preset.unknown', { preset: result.preset, presets: result.presets.map((name) => `\`${name}\``).join(', '), prefix });
    case 'presetHave': return t(lang, 'counters.preset.have', { preset: result.preset, prefix });
    default: return t(lang, 'counters.add.failed', { error: result.detail || '?' });
  }
}

async function create(interaction, lang) {
  const { guild } = interaction;
  const prefix = prefixOf(interaction);
  const type = interaction.options.getString('type');
  if (!type) return reply(interaction, note(t(lang, 'counters.create.usage', { prefix })));
  const role = roleFrom(guild, interaction.options.getString('role') ?? interaction.options.getRole?.('role'));
  const category = channelFrom(guild, interaction.options.getChannel('category'));
  const existing = channelFrom(guild, interaction.options.getString('channel'));
  const result = await createCounter(guild, {
    type, template: interaction.options.getString('template'), format: interaction.options.getString('format'), kind: interaction.options.getString('kind')?.toLowerCase(),
    categoryId: category?.id ?? (interaction.options.getChannel('category') ? 'missing' : null), channelId: existing?.id ?? null, roleId: role?.id ?? null,
    goal: interaction.options.getString('goal'), timezone: interaction.options.getString('timezone'), interval: interaction.options.getString('interval'),
    createdBy: interaction.user.id, reason: t(lang, 'counters.add.reason', { user: interaction.user.tag }),
  }, lang);
  if (!result.ok) return reply(interaction, bad(createError(result, lang, prefix)));
  job().refreshGuildCounters(interaction.client, guild.id, { reload: true }).catch(() => {});
  return reply(interaction, ok(t(lang, result.existing ? 'counters.create.existing' : 'counters.create.done', { emoji: EMOJI.APPROVE, channel: `${result.channel}`, name: result.name })));
}

/** `!counter setup [pack] [goal|timezone]`: basic (members, humans, bots), boosts, online, goal [number], clock [time zone]. */
function parseSetupText(text) {
  const [preset, extra] = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const values = {};
  if (preset) values.preset = preset;
  if (extra && /^\d[\d.,_]*$/.test(extra)) values.goal = extra.replace(/[.,_]/g, '');
  else if (extra) values.timezone = extra;
  return values;
}

async function setup(interaction, lang) {
  const result = await setupPreset(interaction.guild, {
    createdBy: interaction.user.id, reason: t(lang, 'counters.setup.reason', { user: interaction.user.tag }),
    preset: interaction.options.getString('preset'), goal: interaction.options.getString('goal'), timezone: interaction.options.getString('timezone'),
  }, lang);
  if (!result.ok) return reply(interaction, bad(createError(result, lang, prefixOf(interaction))));
  job().refreshGuildCounters(interaction.client, interaction.guild.id, { reload: true }).catch(() => {});
  const lines = [t(lang, 'counters.setup.done', { emoji: EMOJI.APPROVE, category: result.category.name, channels: result.made.map((m) => `${m.channel}`).join(', ') })];
  if (result.skipped) lines.push(t(lang, 'counters.preset.skipped', { count: result.skipped }));
  return reply(interaction, ok(lines.join('\n')));
}

function statusOf(row, lang) {
  if (row.problem) return `⚠️ ${t(lang, `counters.problem.${['missing_channel', 'missing_permission', 'bad_target'].includes(row.problem) ? row.problem : 'rename_failed'}`)}`;
  if (!row.enabled) return t(lang, 'counters.status.off');
  const at = job().pendingRenameAt(row.channel_id);
  return at ? t(lang, 'counters.status.waiting', { time: Math.floor(at / 1000) }) : '';
}

async function list(interaction, lang) {
  const rows = await countersDb.list(interaction.guild.id);
  if (!rows.length) return reply(interaction, note(t(lang, 'counters.list.title', { count: 0, body: t(lang, 'counters.list.none') })));
  const lines = rows.map((row) => {
    const name = previewName(interaction.guild, row, lang).replace(/`/g, "'").slice(0, 120);
    const status = statusOf(row, lang);
    const where = targetOf(row) === 'topic' ? ` · ${t(lang, 'counters.list.topic')}` : '';
    return `${t(lang, 'counters.list.row', { channel: `<#${row.channel_id}>`, type: typeLabel(row.counter_option, lang), name })}${where}${status ? ` · ${status}` : ''}`;
  });
  return reply(interaction, note(`${t(lang, 'counters.list.title', { count: rows.length, body: lines.join('\n') })}\n-# ${t(lang, 'counters.list.footer')}`));
}

async function types(interaction, lang) {
  const { guild } = interaction;
  for (const option of DB_TYPES) await require('../../utils/counterSources').loadValue(guild.id, option).catch(() => null);
  const lines = OPTIONS.map((option) => {
    const value = NEEDS_ROLE.has(option) ? null : countGuild(guild, option, lang, {});
    const shown = value === null ? '' : ` · ${typeof value === 'number' ? formatCount(value, 'grouped', lang) : value}`;
    return `\`${option}\` ${typeLabel(option, lang)}${shown}`;
  });
  const presence = guild.presences?.cache?.size ? '' : `\n-# ${t(lang, 'counters.types.presence')}`;
  return reply(interaction, note(`${t(lang, 'counters.types.title')}\n${lines.join('\n')}\n-# ${t(lang, 'counters.types.footer')}${presence}`));
}

async function edit(interaction, lang) {
  const { guild } = interaction;
  const prefix = prefixOf(interaction);
  const channel = channelFrom(guild, interaction.options.getChannel('channel', true));
  const current = channel ? await countersDb.get(guild.id, channel.id) : null;
  if (!current) return reply(interaction, bad(t(lang, 'counters.notCounter')));
  const setting = String(interaction.options.getString('setting', true)).toLowerCase();
  const value = String(interaction.options.getString('value', true) ?? '').trim();
  const off = OFF_WORDS.includes(value.toLowerCase());
  const patch = {};
  switch (setting) {
    case 'template': case 'name': patch.name_template = off ? defaultTemplate(current.counter_option, lang) : value.slice(0, templateMax(current)); break;
    case 'kind': case 'target': {
      // A channel cannot change its kind; a text or announcement channel can show the value in its name or in its topic.
      const kind = resolveKind(value) ?? (value.toLowerCase() === 'name' ? 'name' : null);
      const actual = KIND_OF_TYPE[channel.type] ?? current.channel_type;
      if (kind === 'topic') { if (!TOPIC_TYPES.includes(channel.type)) return reply(interaction, bad(t(lang, 'counters.kind.topicNeedsText'))); patch.target = 'topic'; }
      else if (kind === 'name' || kind === actual) patch.target = 'name';
      else return reply(interaction, bad(t(lang, 'counters.kind.cannotChange', { kind: actual, prefix })));
      break;
    }
    case 'format': { const format = resolveFormat(value); if (!format) return reply(interaction, bad(t(lang, 'counters.edit.badFormat'))); patch.number_format = format; break; }
    case 'type': {
      const option = resolveOption(value);
      if (!option) return reply(interaction, bad(t(lang, 'counters.create.unknownType', { type: value, prefix })));
      patch.counter_option = option;
      if (NEEDS_ROLE.has(option) && !current.target_id) return reply(interaction, bad(t(lang, 'counters.create.needRole', { prefix })));
      break;
    }
    case 'role': { const role = roleFrom(guild, value); if (!role) return reply(interaction, bad(t(lang, 'counters.create.needRole', { prefix }))); patch.target_id = role.id; break; }
    case 'goal': {
      if (off) { patch.goal = null; break; }
      const goal = Math.trunc(Number(value.replace(/[.,\s]/g, '')));
      if (!Number.isFinite(goal) || goal <= 0) return reply(interaction, bad(t(lang, 'counters.edit.badGoal')));
      patch.goal = Math.min(2_000_000_000, goal);
      break;
    }
    case 'timezone': if (off) patch.timezone = null; else if (validTimeZone(value)) patch.timezone = value; else return reply(interaction, bad(t(lang, 'counters.create.badTimezone', { zone: value }))); break;
    case 'category': {
      const parent = off ? null : channelFrom(guild, value);
      if (!off && parent?.type !== ChannelType.GuildCategory) return reply(interaction, bad(t(lang, 'counters.parentNotCategory')));
      patch.parent_id = parent?.id ?? null;
      await channel.setParent(parent?.id ?? null, { lockPermissions: false }).catch(() => {});
      break;
    }
    case 'prefix': patch.prefix = off ? '' : value.slice(0, 30); break;
    case 'suffix': patch.suffix = off ? '' : value.slice(0, 30); break;
    case 'interval': patch.interval_seconds = Math.max(60, Math.min(86400, Math.trunc(Number(value)) || 60)); break;
    case 'enabled': patch.enabled = ['on', 'yes', 'true', 'enable', 'enabled', '1'].includes(value.toLowerCase()); if (patch.enabled) patch.problem = null; break;
    default: return reply(interaction, bad(t(lang, 'counters.edit.unknownSetting', { settings: EDIT_SETTINGS.join(', ') })));
  }
  const saved = await countersDb.update(guild.id, channel.id, patch);
  job().refreshGuildCounters(interaction.client, guild.id, { reload: true }).catch(() => {});
  const name = previewName(guild, saved ?? { ...current, ...patch }, lang);
  return reply(interaction, ok(`${t(lang, 'counters.edit.done', { emoji: EMOJI.APPROVE, channel: `${channel}` })}\n${t(lang, 'counters.name.preview', { name })}`));
}

async function remove(interaction, lang) {
  const { guild } = interaction;
  const raw = interaction.options.getChannel('channel', true);
  const channel = channelFrom(guild, raw);
  const channelId = channel?.id ?? idOf(raw);
  const removed = channelId ? await countersDb.remove(guild.id, channelId) : false;
  if (!removed) return reply(interaction, bad(t(lang, 'counters.notCounter')));
  job().refreshGuildCounters(interaction.client, guild.id, { reload: true }).catch(() => {});
  const keep = /^(keep|k|mantener|manter|true|yes)$/i.test(String(interaction.options.getString('keep') ?? ''));
  if (!keep && channel) {
    const deleted = await channel.delete(t(lang, 'counters.add.reason', { user: interaction.user.tag })).then(() => true).catch(() => false);
    if (deleted) return reply(interaction, ok(t(lang, 'counters.delete.done', { emoji: EMOJI.APPROVE, channel: `#${channel.name}` })));
  }
  return reply(interaction, ok(t(lang, 'counters.delete.kept', { emoji: EMOJI.APPROVE, channel: channel ? `${channel}` : `<#${channelId}>` })));
}

async function refresh(interaction, lang) {
  const channel = channelFrom(interaction.guild, interaction.options.getChannel('channel'));
  const results = await job().refreshGuildCounters(interaction.client, interaction.guild.id, { reload: true, channelId: channel?.id ?? null });
  if (!results.length) return reply(interaction, note(t(lang, 'counters.refresh.none')));
  const count = (what) => results.filter((r) => r.result === what).length;
  return reply(interaction, ok(t(lang, 'counters.refresh.done', { emoji: EMOJI.APPROVE, renamed: count('renamed'), waiting: count('waiting'), same: count('same') })));
}

const ANNOUNCE_SETTINGS = ['channel', 'message', 'embed', 'every', 'goals', 'on', 'off', 'test', 'status']; // i18n-ignore: words people type
const ANNOUNCE_ALIASES = { canal: 'channel', text: 'message', msg: 'message', mensaje: 'message', mensagem: 'message', template: 'embed', cada: 'every', a_cada: 'every', goal: 'goals', metas: 'goals', enable: 'on', disable: 'off', prueba: 'test', teste: 'test', show: 'status', info: 'status' }; // i18n-ignore: words people type

/**
 * Reads `!counter announce ...`: `#channel [message]`, `message <text>`, `embed <name>|off`, `every <N>|off`, `goals on|off`, `on`, `off`,
 * `test`. Without anything it shows the settings.
 */
function parseAnnounceText(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return {};
  const [first, ...rest] = raw.split(/\s+/);
  if (MENTION.test(first)) return { setting: 'channel', value: first, ...(rest.length ? { message: raw.slice(first.length).trim() } : {}) };
  const word = first.toLowerCase();
  const setting = ANNOUNCE_SETTINGS.includes(word) ? word : ANNOUNCE_ALIASES[word] ?? word;
  const value = raw.slice(first.length).trim();
  if (setting === 'channel' && value) {
    const [channel, ...words] = value.split(/\s+/);
    return { setting, value: channel, ...(words.length ? { message: value.slice(channel.length).trim() } : {}) };
  }
  return value ? { setting, value } : { setting };
}

const onOff = (value) => (['on', 'yes', 'true', 'enable', 'enabled', '1', 'si', 'sí', 'sim'].includes(String(value ?? '').toLowerCase()) ? true : ['off', 'no', 'false', 'disable', 'disabled', '0', 'nao', 'não'].includes(String(value ?? '').toLowerCase()) ? false : null);

function announceStatus(guild, config, lang, prefix) {
  if (!config) return t(lang, 'counters.announce.none', { prefix });
  const count = guild.memberCount ?? 0;
  const rows = (job()._state.rowsByGuild.get(guild.id) ?? []);
  const next = nextMilestone({ count, last: config.last_announced, every: config.every, goalRows: rows, useGoals: config.use_goals !== false });
  const lines = [
    t(lang, 'counters.announce.title', { state: t(lang, config.enabled ? 'counters.announce.on' : 'counters.announce.off') }),
    t(lang, 'counters.announce.channel', { channel: config.channel_id ? `<#${config.channel_id}>` : '—' }),
    config.every ? t(lang, 'counters.announce.every', { every: formatCount(config.every, 'grouped', lang) }) : t(lang, 'counters.announce.everyOff'),
    t(lang, 'counters.announce.goals', { state: t(lang, config.use_goals !== false ? 'counters.announce.on' : 'counters.announce.off') }),
    config.embed_name ? t(lang, 'counters.announce.embed', { name: config.embed_name }) : t(lang, 'counters.announce.message', { message: String(config.message || t(lang, 'counters.announce.default')).replace(/`/g, "'").slice(0, 300) }),
    t(lang, 'counters.announce.next', { last: config.last_announced == null ? '—' : formatCount(config.last_announced, 'grouped', lang), next: next == null ? '—' : formatCount(next, 'grouped', lang) }),
  ];
  return `${lines.join('\n')}\n-# ${t(lang, 'counters.announce.usage', { prefix })}`;
}

async function announce(interaction, lang) {
  const { guild } = interaction;
  const prefix = prefixOf(interaction);
  const setting = String(interaction.options.getString('setting') ?? '').toLowerCase().trim();
  const value = String(interaction.options.getString('value') ?? '').trim();
  const current = await countersDb.getAnnounce(guild.id);
  if (!setting || setting === 'status') return reply(interaction, note(announceStatus(guild, current, lang, prefix)));
  const patch = {};
  switch (setting) {
    case 'channel': {
      const channel = channelFrom(guild, value);
      if (!channel || typeof channel.send !== 'function' || channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) return reply(interaction, bad(t(lang, 'counters.announce.badChannel')));
      patch.channel_id = channel.id;
      const message = interaction.options.getString('message');
      if (message) patch.message = String(message).slice(0, MAX_TEXT);
      if (!current?.enabled) { patch.enabled = true; patch.last_announced = null; }
      break;
    }
    case 'message': patch.message = OFF_WORDS.includes(value.toLowerCase()) ? '' : value.slice(0, MAX_TEXT); break;
    case 'embed': {
      if (!value || OFF_WORDS.includes(value.toLowerCase())) { patch.embed_name = null; break; }
      const template = await require('../../db/embedTemplates').getTemplate(guild.id, value).catch(() => null);
      if (!template) return reply(interaction, bad(t(lang, 'counters.announce.noEmbed', { name: value.slice(0, 50), prefix })));
      patch.embed_name = template.name ?? value;
      break;
    }
    case 'every': {
      const every = parseEvery(value);
      if (every === undefined) return reply(interaction, bad(t(lang, 'counters.announce.badEvery')));
      patch.every = every;
      break;
    }
    case 'goals': {
      const on = onOff(value || 'on');
      if (on === null) return reply(interaction, note(t(lang, 'counters.announce.usage', { prefix })));
      patch.use_goals = on;
      break;
    }
    case 'on': if (!current?.channel_id) return reply(interaction, bad(t(lang, 'counters.announce.needChannel', { prefix }))); if (!current.enabled) { patch.enabled = true; patch.last_announced = null; } break;
    case 'off': patch.enabled = false; break;
    case 'test': {
      const channel = current ? announceChannel(guild, current) : null;
      if (!current?.channel_id) return reply(interaction, bad(t(lang, 'counters.announce.needChannel', { prefix })));
      const count = guild.memberCount ?? 0;
      const payload = channel ? await announcePayload(guild, channel, current, { count, milestone: count }, lang) : null;
      const sent = payload ? await channel.send(payload).then(() => true).catch(() => false) : false;
      return reply(interaction, sent ? ok(t(lang, 'counters.announce.tested', { emoji: EMOJI.APPROVE, channel: `${channel}` })) : bad(t(lang, 'counters.announce.testFailed')));
    }
    default: return reply(interaction, note(t(lang, 'counters.announce.usage', { prefix })));
  }
  if (!current && !patch.channel_id) return reply(interaction, bad(t(lang, 'counters.announce.needChannel', { prefix })));
  if (!current) patch.last_announced = null;
  const saved = await countersDb.saveAnnounce(guild.id, patch);
  await job().reloadAnnounce(guild.id).catch(() => {});
  return reply(interaction, ok(`${t(lang, 'counters.announce.saved', { emoji: EMOJI.APPROVE })}\n${announceStatus(guild, saved, lang, prefix).split('\n').slice(0, -1).join('\n')}`));
}

module.exports = {
  aliases: ['counters'],
  prefixOnly: true,
  data,
  prefixSubcommandAliases: { milestone: 'announce', milestones: 'announce', announcement: 'announce', anunciar: 'announce', anuncio: 'announce', add: 'create', new: 'create', make: 'create', remove: 'delete', del: 'delete', rm: 'delete', stop: 'delete', ls: 'list', update: 'refresh', sync: 'refresh', type: 'types', quick: 'setup', preset: 'setup', presets: 'setup', pack: 'setup' },
  prefixDefaultSubcommand: 'list',
  prefixRawOptions: { create: parseCreateText, setup: parseSetupText, announce: parseAnnounceText },
  parseCreateText,
  parseSetupText,
  parseAnnounceText,
  NEEDS_PRESENCES,

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') return create(interaction, lang);
    if (sub === 'setup') return setup(interaction, lang);
    if (sub === 'types') return types(interaction, lang);
    if (sub === 'edit') return edit(interaction, lang);
    if (sub === 'delete') return remove(interaction, lang);
    if (sub === 'refresh') return refresh(interaction, lang);
    if (sub === 'announce') return announce(interaction, lang);
    return list(interaction, lang);
  },
};
