const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const autoMessagesDb = require('../../db/autoMessages');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { textCard } = require('../../utils/caseCard');
const { t, languageOf } = require('../../i18n');
const { getTemplate } = require('../../db/embedTemplates');
const { parseScheduleText, nextRunAt, weekdayName } = require('../../utils/timerSchedule');

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
    .addSubcommand((s) => s.setName('embed').setDescription('Choose the saved embed a timer sends, or none to take it off.').addIntegerOption((o) => o.setName('id').setDescription('Timer ID.').setRequired(true)).addStringOption((o) => o.setName('template').setDescription('Name of a saved embed, or none.').setRequired(true)))
    .addSubcommand((s) => s.setName('previous').setDescription('Turn on or off deleting the message of the time before.').addIntegerOption((o) => o.setName('id').setDescription('Timer ID.').setRequired(true)).addBooleanOption((o) => o.setName('enabled').setDescription('Delete the previous message?').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Delete a timer so it stops sending its message.').addIntegerOption((o) => o.setName('id').setDescription('Timer ID.').setRequired(true)))
    .addSubcommand((s) => s.setName('view').setDescription('Show how a timer is set: its channel, schedule, next run and message.').addIntegerOption((o) => o.setName('id').setDescription('Timer ID.').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List this server’s timers.')),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addTimer(interaction, lang);
    if (sub === 'remove') return removeTimer(interaction, lang);
    if (sub === 'previous') return setPrevious(interaction, lang);
    if (sub === 'embed') return setEmbed(interaction, lang);
    if (sub === 'view') return viewTimer(interaction, lang);
    const rows = await autoMessagesDb.list(interaction.guild.id);
    const body = rows.length ? rows.map((row) => formatRow(row, lang)).join('\n') : t(lang, 'automation.timer.listEmpty');
    return interaction.reply({ components: [textCard(body)], flags: MessageFlags.IsComponentsV2 });
  },
};

/** How often a timer posts: "every **2 hours**", "every day at **18:00** (America/Bogota)" or "every **Monday** at **09:30** (UTC)". */
function describeSchedule(row, lang) {
  if (row.schedule === 'daily') return t(lang, 'automation.timer.scheduleDaily', { time: row.at_time, zone: row.timezone || 'UTC' });
  if (row.schedule === 'weekly') return t(lang, 'automation.timer.scheduleWeekly', { weekday: weekdayName(row.weekday, lang), time: row.at_time, zone: row.timezone || 'UTC' });
  return t(lang, 'automation.timer.scheduleInterval', { interval: formatDuration(row.interval_ms, lang) });
}

function nextRunText(row, lang) {
  const at = Date.parse(row.next_run_at);
  return Number.isFinite(at) ? ` · ${t(lang, 'automation.timer.nextRun', { time: `<t:${Math.floor(at / 1000)}:F>` })}` : '';
}

function formatRow(row, lang) {
  return t(lang, 'automation.timer.row', { id: row.id, channel: `<#${row.channel_id}>`, schedule: describeSchedule(row, lang), message: [row.embed_template && `🖼️ \`${row.embed_template}\``, row.message].filter(Boolean).join(' · ') }) + (row.delete_previous ? ` ${t(lang, 'automation.timer.previousTag')}` : '') + nextRunText(row, lang);
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

async function addTimer(interaction, lang) {
  const read = readSchedule(interaction.options.getString('interval', true), interaction.options.getString('message') ?? '');
  if (read.error === 'time') return interaction.reply({ content: t(lang, 'automation.timer.badTime'), flags: MessageFlags.Ephemeral });
  if (read.error === 'weekday') return interaction.reply({ content: t(lang, 'automation.timer.badWeekday'), flags: MessageFlags.Ephemeral });
  if (read.error === 'timezone') return interaction.reply({ content: t(lang, 'automation.timer.badZone', { zone: read.zone ?? '' }), flags: MessageFlags.Ephemeral });
  const spec = read.spec;
  const intervalMs = spec?.intervalMs;
  if (!intervalMs || intervalMs < 10 * 60 * 1000) return interaction.reply({ content: t(lang, 'automation.timer.tooShort'), flags: MessageFlags.Ephemeral });
  const channel = interaction.options.getChannel('channel', true);
  if (!channel.isTextBased()) return interaction.reply({ content: t(lang, 'automation.reaction.textChannel'), flags: MessageFlags.Ephemeral });
  const existing = (await autoMessagesDb.list(interaction.guild.id)).find((row) => row.channel_id === channel.id);
  if (existing) return interaction.reply({ content: t(lang, 'automation.timer.exists', { id: existing.id }), flags: MessageFlags.Ephemeral });
  const message = read.message;
  const embedTemplate = interaction.options.getString('embed_template');
  if (!message && !embedTemplate) return interaction.reply({ content: t(lang, 'automation.timer.needMessage'), flags: MessageFlags.Ephemeral });
  if (embedTemplate && !(await getTemplate(interaction.guild.id, embedTemplate).catch(() => null))?.data) return interaction.reply({ content: t(lang, 'automation.timer.templateMissing', { name: embedTemplate }), flags: MessageFlags.Ephemeral });
  const deletePrevious = interaction.options.getBoolean('delete_previous') ?? false;
  const row = await autoMessagesDb.add({ guildId: interaction.guild.id, channelId: channel.id, intervalMs, message, deletePrevious, embedTemplate, schedule: spec.schedule, atTime: spec.atTime ?? null, timezone: spec.timezone ?? 'UTC', weekday: spec.weekday ?? null });
  if (spec.schedule === 'interval') return interaction.reply({ components: [textCard(t(lang, 'automation.timer.created', { id: row.id, channel: `<#${channel.id}>`, interval: formatDuration(intervalMs, lang) }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  const next = Math.floor(Date.parse(row.next_run_at ?? nextRunAt(row).toISOString()) / 1000);
  return interaction.reply({ components: [textCard(t(lang, 'automation.timer.createdSchedule', { id: row.id, channel: `<#${channel.id}>`, schedule: describeSchedule(row, lang), next: `<t:${next}:F>` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function setEmbed(interaction, lang) {
  const input = interaction.options.getString('template', true).trim();
  const name = input.toLowerCase() === 'none' ? null : input;
  const timer = await autoMessagesDb.get(interaction.guild.id, interaction.options.getInteger('id', true));
  if (!timer) return interaction.reply({ components: [textCard(t(lang, 'automation.timer.missing'), 0xff6b6b)], flags: MessageFlags.IsComponentsV2 });
  if (name && !(await getTemplate(interaction.guild.id, name).catch(() => null))?.data) return interaction.reply({ content: t(lang, 'automation.timer.templateMissing', { name }), flags: MessageFlags.Ephemeral });
  if (!name && !timer.message) return interaction.reply({ content: t(lang, 'automation.timer.needMessage'), flags: MessageFlags.Ephemeral });
  await autoMessagesDb.setEmbedTemplate(interaction.guild.id, timer.id, name);
  return interaction.reply({ components: [textCard(name ? t(lang, 'automation.timer.embedSet', { id: timer.id, name }) : t(lang, 'automation.timer.embedCleared', { id: timer.id }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function setPrevious(interaction, lang) {
  const enabled = interaction.options.getBoolean('enabled', true);
  const row = await autoMessagesDb.setDeletePrevious(interaction.guild.id, interaction.options.getInteger('id', true), enabled);
  const text = !row ? t(lang, 'automation.timer.missing') : t(lang, enabled ? 'automation.timer.previousOn' : 'automation.timer.previousOff', { id: row.id });
  return interaction.reply({ components: [textCard(text, row ? 0xa5ea7a : 0xff6b6b)], flags: MessageFlags.IsComponentsV2 });
}

async function removeTimer(interaction, lang) {
  const removed = await autoMessagesDb.remove(interaction.guild.id, interaction.options.getInteger('id', true));
  return interaction.reply({ components: [textCard(removed ? t(lang, 'automation.timer.removed') : t(lang, 'automation.timer.missing'), removed ? 0xa5ea7a : 0xff6b6b)], flags: MessageFlags.IsComponentsV2 });
}

async function viewTimer(interaction, lang) {
  const row = await autoMessagesDb.get(interaction.guild.id, interaction.options.getInteger('id', true));
  return interaction.reply({ components: [textCard(row ? formatRow(row, lang) : t(lang, 'automation.timer.missing'), row ? 0x4b4f59 : 0xff6b6b)], flags: MessageFlags.IsComponentsV2 });
}
