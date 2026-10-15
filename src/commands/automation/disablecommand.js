const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const disabledDb = require('../../db/disabledCommands');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { register, sendPager } = require('../../utils/pager');
const { t, tn, languageOf } = require('../../i18n');

// Commands that cannot be switched off, or nobody could switch anything back on or find out how.
const PROTECTED = new Set(['disablecommand', 'help']);
const MAX_AT_ONCE = 25;

register('blocked', {
  async load(guild, { option, lang }) {
    let rules = await disabledDb.listForGuild(guild.id);
    if (option === 'server') rules = rules.filter((rule) => !rule.channel_id);
    if (option === 'channel') rules = rules.filter((rule) => rule.channel_id);
    rules.sort((a, b) => a.command.localeCompare(b.command));
    return {
      title: t(lang, 'automation.disable.list.title', { count: rules.length }),
      subtitle: [guild.name],
      thumbnail: guild.iconURL({ size: 256 }),
      items: rules.map((rule) => `\`${rule.command}\` — ${rule.channel_id ? `<#${rule.channel_id}>` : t(lang, 'automation.disable.list.wholeServer')}`),
      options: [{ label: t(lang, 'automation.disable.list.all.menu'), value: 'all' }, { label: t(lang, 'automation.disable.list.server.menu'), value: 'server' }, { label: t(lang, 'automation.disable.list.channel.menu'), value: 'channel' }],
      placeholder: t(lang, 'automation.disable.list.show.menu'),
      empty: t(lang, 'automation.disable.none'),
    };
  },
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName('disablecommand')
    .setDescription('Disable/enable specific commands, server-wide or per channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('disable').setDescription('Disable one or more commands.').addStringOption((o) => o.setName('command').setDescription('Command names as typed, without the prefix. Several at once: "roles emojis channels"').setRequired(true)).addChannelOption((o) => o.setName('channel').setDescription('Only in this channel (default: server-wide)').setRequired(false)))
    .addSubcommand((s) => s.setName('enable').setDescription('Re-enable one or more commands, or "all" to clear every rule.').addStringOption((o) => o.setName('command').setDescription('Command names, or "all"').setRequired(true)).addChannelOption((o) => o.setName('channel').setDescription('The channel it was disabled in (default: server-wide rule)').setRequired(false)))
    .addSubcommand((s) => s.setName('list').setDescription('List every disabled-command rule, a page at a time.')),
  aliases: ['dc'],

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'disable') return disableCmd(interaction);
    if (sub === 'enable') return enableCmd(interaction);
    return sendPager(interaction, 'blocked');
  },
};

/** Names written separated by spaces or commas, without repeats and without the prefix. */
function readNames(interaction, raw) {
  const names = String(raw).split(/[\s,]+/).map((name) => name.trim().toLowerCase()).filter(Boolean);
  return [...new Set(names.map((name) => canonicalCommandName(interaction, name)))];
}

function canonicalCommandName(interaction, rawName) {
  const name = rawName.trim().toLowerCase();
  return interaction.client.commandAliases.get(name)
    ?? interaction.client.commandRoutes?.get(name)?.command
    ?? name;
}

const reply = (interaction, text, color) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });

async function disableCmd(interaction) {
  const lang = await languageOf(interaction);
  const channel = interaction.options.getChannel('channel');
  const names = readNames(interaction, interaction.options.getString('command', true));

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  if (!names.length) return reply(interaction, t(lang, 'automation.disable.needName'), 0xfe6465);
  if (names.length > MAX_AT_ONCE) return reply(interaction, t(lang, 'automation.disable.tooMany', { max: MAX_AT_ONCE }), 0xfe6465);
  await ensureGuild(interaction.guild.id);

  const done = [];
  const already = [];
  const refused = [];
  const unknown = [];
  for (const command of names) {
    if (PROTECTED.has(command)) { refused.push(command); continue; }
    if (!interaction.client.commands.has(command) && !interaction.client.commandRoutes?.has(command)) { unknown.push(command); continue; }
    if (await disabledDb.find(interaction.guild.id, command, channel?.id)) { already.push(command); continue; }
    await disabledDb.disable(interaction.guild.id, command, channel?.id);
    done.push(command);
  }

  const tick = (list) => list.map((name) => `\`${name}\``).join(', ');
  const lines = [];
  if (done.length) lines.push(channel ? t(lang, 'automation.disable.doneChannel', { emoji: EMOJI.APPROVE, commands: tick(done), channel: `${channel}` }) : t(lang, 'automation.disable.doneServer', { emoji: EMOJI.APPROVE, commands: tick(done) }));
  if (already.length) lines.push(t(lang, 'automation.disable.already', { commands: tick(already) }));
  if (refused.length) lines.push(t(lang, 'automation.disable.refused', { commands: tick(refused) }));
  if (unknown.length) lines.push(t(lang, 'automation.disable.unknown', { commands: tick(unknown) }));
  return reply(interaction, lines.join('\n'), done.length ? 0xa5ea7a : 0xfed53c);
}

async function enableCmd(interaction) {
  const lang = await languageOf(interaction);
  const channel = interaction.options.getChannel('channel');
  const raw = interaction.options.getString('command', true).trim().toLowerCase();

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  if (raw === 'all') {
    const count = await disabledDb.clear(interaction.guild.id);
    return reply(interaction, count ? tn(lang, 'automation.disable.cleared', count, { count, emoji: EMOJI.APPROVE }) : t(lang, 'automation.disable.none'), count ? 0xa5ea7a : 0x4b4f59);
  }

  const names = readNames(interaction, raw).slice(0, MAX_AT_ONCE);
  const done = [];
  const missing = [];
  for (const command of names) (await disabledDb.enable(interaction.guild.id, command, channel?.id) ? done : missing).push(command);

  const tick = (list) => list.map((name) => `\`${name}\``).join(', ');
  const lines = [];
  if (done.length) lines.push(channel ? t(lang, 'automation.enable.doneChannel', { emoji: EMOJI.APPROVE, commands: tick(done), channel: `${channel}` }) : t(lang, 'automation.enable.doneServer', { emoji: EMOJI.APPROVE, commands: tick(done) }));
  if (missing.length) lines.push(t(lang, channel ? 'automation.enable.noRuleChannel' : 'automation.enable.noRuleServer', { commands: tick(missing) }));
  return reply(interaction, lines.join('\n') || t(lang, 'automation.disable.needName'), done.length ? 0xa5ea7a : 0xfe6465);
}
