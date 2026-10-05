const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const disabledDb = require('../../db/disabledCommands');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { register, sendPager } = require('../../utils/pager');

// Commands that cannot be switched off, or nobody could switch anything back on or find out how.
const PROTECTED = new Set(['disablecommand', 'help']);
const MAX_AT_ONCE = 25;

register('blocked', {
  async load(guild, { option }) {
    let rules = await disabledDb.listForGuild(guild.id);
    if (option === 'server') rules = rules.filter((rule) => !rule.channel_id);
    if (option === 'channel') rules = rules.filter((rule) => rule.channel_id);
    rules.sort((a, b) => a.command.localeCompare(b.command));
    return {
      title: `Disabled commands (${rules.length})`,
      subtitle: [guild.name],
      thumbnail: guild.iconURL({ size: 256 }),
      items: rules.map((rule) => `\`${rule.command}\` — ${rule.channel_id ? `<#${rule.channel_id}>` : 'the whole server'}`),
      options: [{ label: 'Every rule', value: 'all' }, { label: 'Whole server only', value: 'server' }, { label: 'Single channels only', value: 'channel' }],
      placeholder: 'Show…',
      empty: 'No commands are disabled.',
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

const where = (channel) => (channel ? ` in ${channel}` : ' server-wide');
const reply = (interaction, text, color) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });

async function disableCmd(interaction) {
  const channel = interaction.options.getChannel('channel');
  const names = readNames(interaction, interaction.options.getString('command', true));

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  if (!names.length) return reply(interaction, 'Write the name of at least one command.', 0xfe6465);
  if (names.length > MAX_AT_ONCE) return reply(interaction, `Disable up to ${MAX_AT_ONCE} commands at a time.`, 0xfe6465);
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
  if (done.length) lines.push(`${EMOJI.APPROVE}  Disabled ${tick(done)}${where(channel)}.`);
  if (already.length) lines.push(`Already disabled: ${tick(already)}.`);
  if (refused.length) lines.push(`These cannot be disabled, or nobody could turn anything back on: ${tick(refused)}.`);
  if (unknown.length) lines.push(`I don't know these commands: ${tick(unknown)}.`);
  return reply(interaction, lines.join('\n'), done.length ? 0xa5ea7a : 0xfed53c);
}

async function enableCmd(interaction) {
  const channel = interaction.options.getChannel('channel');
  const raw = interaction.options.getString('command', true).trim().toLowerCase();

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  if (raw === 'all') {
    const count = await disabledDb.clear(interaction.guild.id);
    return reply(interaction, count ? `${EMOJI.APPROVE}  Every rule is gone: ${count} ${count === 1 ? 'command is' : 'commands are'} enabled again.` : 'No commands are disabled.', count ? 0xa5ea7a : 0x4b4f59);
  }

  const names = readNames(interaction, raw).slice(0, MAX_AT_ONCE);
  const done = [];
  const missing = [];
  for (const command of names) (await disabledDb.enable(interaction.guild.id, command, channel?.id) ? done : missing).push(command);

  const tick = (list) => list.map((name) => `\`${name}\``).join(', ');
  const lines = [];
  if (done.length) lines.push(`${EMOJI.APPROVE}  Enabled ${tick(done)}${where(channel)}.`);
  if (missing.length) lines.push(`There is no rule${channel ? ' for that channel' : ' for the whole server'} on: ${tick(missing)}.`);
  return reply(interaction, lines.join('\n') || 'Write the name of at least one command.', done.length ? 0xa5ea7a : 0xfe6465);
}
