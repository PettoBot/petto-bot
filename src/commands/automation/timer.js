const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const autoMessagesDb = require('../../db/autoMessages');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { textCard } = require('../../utils/caseCard');
const { t, languageOf } = require('../../i18n');
const { getTemplate } = require('../../db/embedTemplates');
const { commandRef } = require('../../utils/commandRef');
const { parseScheduleText, nextRunAt, weekdayName } = require('../../utils/timerSchedule');

const GREEN = 0xa5ea7a;
const RED = 0xff6b6b;
const GREY = 0x4b4f59;
const MIN_INTERVAL_MS = 10 * 60 * 1000;

// Every subcommand but add and list names a timer by its number in this server (1, 2, 3...), as `!timer list` shows it.
const numberOption = (o) => o.setName('number').setDescription('Timer number, as !timer list shows it.').setRequired(true).setMinValue(1);

module.exports = {
  aliases: ['tm'],
  // `!timer add #channel daily 18:00 America/Bogota Hello everyone`: the schedule and the message are read from one text (see addTimer).
  prefixGreedyStringOptions: { add: 'interval' },
  data: new SlashCommandBuilder()
    .setName('timer')
    .setDescription('Send a repeating message in a channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('add').setDescription('Create a timer, minimum 10 minutes.').addChannelOption((o) => o.setName('channel').setDescription('Text channel.').setRequired(true)).addStringOption((o) => o.setName('interval').setDescription('10m, 2h, 1d… or daily 18:00 America/Bogota, weekly monday 09:30 UTC.').setRequired(true)).addStringOption((o) => o.setName('message').setDescription('Message to send (optional when you choose a saved embed).').setRequired(false)).addStringOption((o) => o.setName('embed_template').setDescription('Saved embed to send instead of, or with, the message.').setRequired(false)).addBooleanOption((o) => o.setName('delete_previous').setDescription('Delete the message of the time before, so the channel only has the latest one.').setRequired(false)))
    .addSubcommand((s) => s.setName('embed').setDescription('Choose the saved embed a timer sends, or none to take it off.').addIntegerOption(numberOption).addStringOption((o) => o.setName('template').setDescription('Name of a saved embed, or none.').setRequired(true)))
    .addSubcommand((s) => s.setName('previous').setDescription('Turn on or off deleting the message of the time before.').addIntegerOption(numberOption).addBooleanOption((o) => o.setName('enabled').setDescription('Delete the previous message?').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Delete a timer so it stops sending its message.').addIntegerOption(numberOption))
    .addSubcommand((s) => s.setName('view').setDescription('Show how a timer is set: its channel, schedule, next run and message.').addIntegerOption(numberOption))
    .addSubcommand((s) => s.setName('list').setDescription('List this server’s timers.'))
    .addSubcommand((s) => s.setName('run').setDescription('Send a timer’s message now. Its schedule does not change.').addIntegerOption(numberOption))
    .addSubcommand((s) => s.setName('edit').setDescription('Change when a timer posts: an interval, or daily/weekly at a time in a time zone.').addIntegerOption(numberOption).addStringOption((o) => o.setName('schedule').setDescription('2h, or daily 07:00 America/Bogota, or weekly monday 09:30 UTC.').setRequired(true)))
    .addSubcommand((s) => s.setName('message').setDescription('Change the text a timer sends (none takes it off when it has a saved embed).').addIntegerOption(numberOption).addStringOption((o) => o.setName('text').setDescription('The new text, or none.').setRequired(true)))
    .addSubcommand((s) => s.setName('channel').setDescription('Move a timer to another channel.').addIntegerOption(numberOption).addChannelOption((o) => o.setName('channel').setDescription('Text channel.').setRequired(true)))
    .addSubcommand((s) => s.setName('pause').setDescription('Stop a timer for now, keeping how it is set.').addIntegerOption(numberOption))
    .addSubcommand((s) => s.setName('resume').setDescription('Start a paused timer again.').addIntegerOption(numberOption)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addTimer(interaction, lang);
    if (sub === 'list') return listTimers(interaction, lang);
    const timer = await autoMessagesDb.getByNumber(interaction.guild.id, interaction.options.getInteger('number', true));
    if (!timer) return reply(interaction, t(lang, 'automation.timer.missing', { command: commandRef(interaction, 'timer list') }), RED);
    const handlers = { embed: setEmbed, previous: setPrevious, remove: removeTimer, view: viewTimer, run: runTimer, edit: editTimer, message: setMessage, channel: setChannel, pause: setPaused, resume: setPaused };
    return handlers[sub](interaction, lang, timer, sub);
  },
};

const reply = (interaction, text, color = GREEN) => interaction.reply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
const ephemeral = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const numberOf = (row) => row.number ?? row.id;

/** How often a timer posts: "every **2 hours**", "every day at **18:00** (America/Bogota)" or "every **Monday** at **09:30** (UTC)". */
function describeSchedule(row, lang) {
  if (row.schedule === 'daily') return t(lang, 'automation.timer.scheduleDaily', { time: row.at_time, zone: row.timezone || 'UTC' });
  if (row.schedule === 'weekly') return t(lang, 'automation.timer.scheduleWeekly', { weekday: weekdayName(row.weekday, lang), time: row.at_time, zone: row.timezone || 'UTC' });
  return t(lang, 'automation.timer.scheduleInterval', { interval: formatDuration(row.interval_ms, lang) });
}

const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

function nextRunText(row, lang) {
  if (row.paused) return ` ${t(lang, 'automation.timer.pausedTag')}`;
  const at = Date.parse(row.next_run_at);
  return Number.isFinite(at) ? ` · ${t(lang, 'automation.timer.nextRun', { time: `<t:${Math.floor(at / 1000)}:F>` })}` : '';
}

function formatRow(row, lang) {
  const line = t(lang, 'automation.timer.row', { id: numberOf(row), channel: `<#${row.channel_id}>`, schedule: describeSchedule(row, lang), message: [row.embed_template && `🖼️ \`${row.embed_template}\``, row.message].filter(Boolean).join(' · ') }) + (row.delete_previous ? ` ${t(lang, 'automation.timer.previousTag')}` : '') + nextRunText(row, lang);
  return row.last_error ? `${line}\n${t(lang, 'automation.timer.lastError', { error: String(row.last_error).slice(0, 300) })}` : line;
}

async function listTimers(interaction, lang) {
  const rows = await autoMessagesDb.list(interaction.guild.id);
  const body = rows.length ? rows.map((row) => formatRow(row, lang)).join('\n') : t(lang, 'automation.timer.listEmpty');
  return reply(interaction, body, GREY);
}

/**
 * What `interval` (with `message`) asks for: an interval (`2h`, `1 hour 30 minutes`), or a schedule at the start of the text
 * (`daily 18:00 America/Bogota`, `weekly monday 09:30 UTC`) followed, with the prefix, by the message. Returns { spec, message }
 * or { error }.
 */
function readSchedule(intervalText, messageText) {
  const wholeInterval = parseDuration(intervalText);
  if (wholeInterval) return { spec: { schedule: 'interval', intervalMs: wholeInterval }, message: messageText };
  const parsed = parseScheduleText(intervalText, parseDuration);
  if (!parsed) return { error: 'tooShort' };
  if (parsed.error) return parsed;
  const rest = parsed.rest.trim();
  return { spec: parsed, message: [rest, messageText].filter(Boolean).join(' ') };
}

/** The answer to a schedule that cannot be read, or null when `read` is fine. */
function scheduleProblem(interaction, lang, read) {
  if (read.error === 'time') return ephemeral(interaction, t(lang, 'automation.timer.badTime'));
  if (read.error === 'weekday') return ephemeral(interaction, t(lang, 'automation.timer.badWeekday'));
  if (read.error === 'timezone') return ephemeral(interaction, t(lang, 'automation.timer.badZone', { zone: read.zone ?? '' }));
  if (!read.spec?.intervalMs || read.spec.intervalMs < MIN_INTERVAL_MS) return ephemeral(interaction, t(lang, 'automation.timer.tooShort'));
  return null;
}

/** The database fields of a schedule from readSchedule. */
function scheduleFields(spec) {
  const scheduled = spec.schedule === 'daily' || spec.schedule === 'weekly';
  return scheduled
    ? { schedule: spec.schedule, interval_ms: spec.intervalMs, at_time: spec.atTime, timezone: spec.timezone ?? 'UTC', weekday: spec.schedule === 'weekly' ? spec.weekday : null }
    : { schedule: 'interval', interval_ms: spec.intervalMs, at_time: null, weekday: null };
}

async function channelTaken(guildId, channelId, exceptId = null) {
  return (await autoMessagesDb.list(guildId)).find((row) => row.channel_id === channelId && row.id !== exceptId) ?? null;
}

async function addTimer(interaction, lang) {
  const read = readSchedule(interaction.options.getString('interval', true), interaction.options.getString('message') ?? '');
  const problem = scheduleProblem(interaction, lang, read);
  if (problem) return problem;
  const spec = read.spec;
  const intervalMs = spec.intervalMs;
  const channel = interaction.options.getChannel('channel', true);
  if (!channel.isTextBased()) return ephemeral(interaction, t(lang, 'automation.reaction.textChannel'));
  const existing = await channelTaken(interaction.guild.id, channel.id);
  if (existing) return ephemeral(interaction, t(lang, 'automation.timer.exists', { id: numberOf(existing) }));
  const message = read.message;
  const embedTemplate = interaction.options.getString('embed_template');
  if (!message && !embedTemplate) return ephemeral(interaction, t(lang, 'automation.timer.needMessage'));
  if (embedTemplate && !(await getTemplate(interaction.guild.id, embedTemplate).catch(() => null))?.data) return ephemeral(interaction, t(lang, 'automation.timer.templateMissing', { name: embedTemplate }));
  const deletePrevious = interaction.options.getBoolean('delete_previous') ?? false;
  const row = await autoMessagesDb.add({ guildId: interaction.guild.id, channelId: channel.id, intervalMs, message, deletePrevious, embedTemplate, schedule: spec.schedule, atTime: spec.atTime ?? null, timezone: spec.timezone ?? 'UTC', weekday: spec.weekday ?? null });
  if (spec.schedule === 'interval') return reply(interaction, t(lang, 'automation.timer.created', { id: numberOf(row), channel: `<#${channel.id}>`, interval: formatDuration(intervalMs, lang) }));
  const next = unix(row.next_run_at ?? nextRunAt(row).toISOString());
  return reply(interaction, t(lang, 'automation.timer.createdSchedule', { id: numberOf(row), channel: `<#${channel.id}>`, schedule: describeSchedule(row, lang), next: `<t:${next}:F>` }));
}

async function setEmbed(interaction, lang, timer) {
  const input = interaction.options.getString('template', true).trim();
  const name = input.toLowerCase() === 'none' ? null : input;
  if (name && !(await getTemplate(interaction.guild.id, name).catch(() => null))?.data) return ephemeral(interaction, t(lang, 'automation.timer.templateMissing', { name }));
  if (!name && !timer.message) return ephemeral(interaction, t(lang, 'automation.timer.needMessage'));
  await autoMessagesDb.setEmbedTemplate(interaction.guild.id, timer.id, name);
  return reply(interaction, name ? t(lang, 'automation.timer.embedSet', { id: numberOf(timer), name }) : t(lang, 'automation.timer.embedCleared', { id: numberOf(timer) }));
}

async function setPrevious(interaction, lang, timer) {
  const enabled = interaction.options.getBoolean('enabled', true);
  await autoMessagesDb.setDeletePrevious(interaction.guild.id, timer.id, enabled);
  return reply(interaction, t(lang, enabled ? 'automation.timer.previousOn' : 'automation.timer.previousOff', { id: numberOf(timer) }));
}

async function removeTimer(interaction, lang, timer) {
  await autoMessagesDb.remove(interaction.guild.id, timer.id);
  return reply(interaction, t(lang, 'automation.timer.removed'));
}

async function viewTimer(interaction, lang, timer) {
  return reply(interaction, formatRow(timer, lang), GREY);
}

/** `!timer run 1`: sends the message now; the next run stays where it was. */
async function runTimer(interaction, lang, timer) {
  await interaction.deferReply?.();
  const { sendTimer } = require('../../jobs/autoMessageJob');
  const result = await sendTimer(interaction.client, timer);
  const text = result.ok
    ? t(lang, 'automation.timer.ran', { id: numberOf(timer), channel: `<#${timer.channel_id}>` })
    : t(lang, 'automation.timer.runFailed', { id: numberOf(timer), error: result.error });
  const payload = { components: [textCard(text, result.ok ? GREEN : RED)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
  return interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply(payload);
}

/** `!timer edit 1 daily 07:00 America/Bogota` or `!timer edit 1 2h`: a new schedule, with its next run worked out again. */
async function editTimer(interaction, lang, timer) {
  const read = readSchedule(interaction.options.getString('schedule', true), '');
  const problem = scheduleProblem(interaction, lang, read);
  if (problem) return problem;
  if (read.message) return ephemeral(interaction, t(lang, 'automation.timer.editExtra', { command: commandRef(interaction, `timer message ${numberOf(timer)}`) }));
  const fields = scheduleFields(read.spec);
  const next = nextRunAt({ ...timer, ...fields }).toISOString();
  const row = await autoMessagesDb.update(interaction.guild.id, timer.id, { ...fields, next_run_at: next });
  return reply(interaction, t(lang, 'automation.timer.edited', { id: numberOf(timer), schedule: describeSchedule(row ?? { ...timer, ...fields }, lang), next: `<t:${unix(next)}:F>` }));
}

async function setMessage(interaction, lang, timer) {
  const input = interaction.options.getString('text', true).trim().slice(0, 2000);
  const message = input.toLowerCase() === 'none' ? '' : input;
  if (!message && !timer.embed_template) return ephemeral(interaction, t(lang, 'automation.timer.needMessage'));
  await autoMessagesDb.update(interaction.guild.id, timer.id, { message });
  return reply(interaction, message ? t(lang, 'automation.timer.messageSet', { id: numberOf(timer), message }) : t(lang, 'automation.timer.messageCleared', { id: numberOf(timer) }));
}

async function setChannel(interaction, lang, timer) {
  const channel = interaction.options.getChannel('channel', true);
  if (!channel.isTextBased()) return ephemeral(interaction, t(lang, 'automation.reaction.textChannel'));
  const existing = await channelTaken(interaction.guild.id, channel.id, timer.id);
  if (existing) return ephemeral(interaction, t(lang, 'automation.timer.exists', { id: numberOf(existing) }));
  // The message of the time before lives in the old channel, so it is forgotten.
  await autoMessagesDb.update(interaction.guild.id, timer.id, { channel_id: channel.id, last_message_id: null });
  return reply(interaction, t(lang, 'automation.timer.channelSet', { id: numberOf(timer), channel: `<#${channel.id}>` }));
}

/** `!timer pause 1` / `!timer resume 1`. A resumed timer starts from its next future time, never with the runs it missed. */
async function setPaused(interaction, lang, timer, sub) {
  if (sub === 'pause') {
    await autoMessagesDb.update(interaction.guild.id, timer.id, { paused: true });
    return reply(interaction, t(lang, 'automation.timer.paused', { id: numberOf(timer), command: commandRef(interaction, `timer resume ${numberOf(timer)}`) }));
  }
  const next = nextRunAt(timer).toISOString();
  await autoMessagesDb.update(interaction.guild.id, timer.id, { paused: false, next_run_at: next });
  return reply(interaction, t(lang, 'automation.timer.resumed', { id: numberOf(timer), next: `<t:${unix(next)}:F>` }));
}

module.exports.formatRow = formatRow;
