const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const starboardDb = require('../../db/starboard');
const { textCard } = require('../../utils/caseCard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('starboard')
    .setDescription('Configure the reaction-based starboard.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('enable').setDescription('Enable starboard with the current settings.'))
    .addSubcommand((s) => s.setName('disable').setDescription('Disable starboard.'))
    .addSubcommand((s) => s.setName('set').setDescription('Set the destination channel.').addChannelOption((o) => o.setName('channel').setDescription('Destination text channel.').setRequired(true)))
    .addSubcommand((s) => s.setName('threshold').setDescription('Set required reactions.').addIntegerOption((o) => o.setName('count').setDescription('Number of reactions.').setMinValue(1).setMaxValue(100).setRequired(true)))
    .addSubcommand((s) => s.setName('emoji').setDescription('Set the reaction emoji.').addStringOption((o) => o.setName('emoji').setDescription('Unicode or custom emoji.').setRequired(true)))
    .addSubcommand((s) => s.setName('selfstar').setDescription('Allow the message author to count their own reaction.').addBooleanOption((o) => o.setName('enabled').setDescription('Enabled?').setRequired(true)))
    .addSubcommand((s) => s.setName('ignore').setDescription('Ignore a channel, role, or member.').addStringOption((o) => o.setName('type').setDescription('What to ignore.').setRequired(true).addChoices({ name: 'channel', value: 'channel' }, { name: 'role', value: 'role' }, { name: 'member', value: 'member' })).addStringOption((o) => o.setName('target').setDescription('Mention or ID.').setRequired(true)))
    .addSubcommand((s) => s.setName('unignore').setDescription('Remove an ignored channel, role, or member.').addStringOption((o) => o.setName('type').setDescription('What to unignore.').setRequired(true).addChoices({ name: 'channel', value: 'channel' }, { name: 'role', value: 'role' }, { name: 'member', value: 'member' })).addStringOption((o) => o.setName('target').setDescription('Mention or ID.').setRequired(true)))
    .addSubcommand((s) => s.setName('view').setDescription('View starboard settings.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'enable') return enable(interaction);
    if (sub === 'disable') return disable(interaction);
    if (sub === 'set') return update(interaction, { channel_id: interaction.options.getChannel('channel', true).id });
    if (sub === 'threshold') return update(interaction, { threshold: interaction.options.getInteger('count', true) });
    if (sub === 'emoji') return update(interaction, { emoji: interaction.options.getString('emoji', true).trim() });
    if (sub === 'selfstar') return update(interaction, { selfstar: interaction.options.getBoolean('enabled', true) });
    if (sub === 'ignore' || sub === 'unignore') return changeIgnore(interaction, sub === 'ignore');
    return view(interaction);
  },
};

async function enable(interaction) {
  const current = await starboardDb.ensureConfig(interaction.guild.id);
  return interaction.reply({ components: [textCard(current.channel_id ? `Starboard enabled in <#${current.channel_id}>.` : 'Starboard enabled. Set a destination with `starboard set`.', 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function disable(interaction) {
  await starboardDb.disable(interaction.guild.id);
  return interaction.reply({ components: [textCard('Starboard disabled.', 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function update(interaction, changes) {
  const row = await starboardDb.updateConfig(interaction.guild.id, changes);
  return interaction.reply({ components: [textCard(`Starboard updated. Threshold: **${row.threshold}**, emoji: ${row.emoji}${row.channel_id ? `, channel: <#${row.channel_id}>` : ''}.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function changeIgnore(interaction, add) {
  const row = await starboardDb.ensureConfig(interaction.guild.id);
  const type = interaction.options.getString('type', true);
  const raw = interaction.options.getString('target', true);
  const id = raw.replace(/[<@#&!>]/g, '');
  if (!/^\d{15,25}$/.test(id)) return interaction.reply({ content: 'Use a valid channel, role, or member mention/ID.', flags: MessageFlags.Ephemeral });
  const key = type === 'channel' ? 'ignored_channel_ids' : type === 'role' ? 'ignored_role_ids' : 'ignored_user_ids';
  const values = new Set(row[key] ?? []);
  if (add) values.add(id); else values.delete(id);
  await starboardDb.updateConfig(interaction.guild.id, { [key]: [...values] });
  return interaction.reply({ components: [textCard(`${add ? 'Added' : 'Removed'} <${type === 'channel' ? '#' : type === 'role' ? '@&' : '@'}${id}> ${add ? 'to' : 'from'} starboard ignores.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function view(interaction) {
  const row = await starboardDb.getConfig(interaction.guild.id);
  if (!row) return interaction.reply({ components: [textCard('Starboard is disabled.', 0xff6b6b)], flags: MessageFlags.IsComponentsV2 });
  const text = `**Channel:** ${row.channel_id ? `<#${row.channel_id}>` : 'not set'}\n**Threshold:** ${row.threshold}\n**Emoji:** ${row.emoji}\n**Self-star:** ${row.selfstar ? 'enabled' : 'disabled'}\n**Ignored channels:** ${row.ignored_channel_ids?.length ?? 0}\n**Ignored roles:** ${row.ignored_role_ids?.length ?? 0}\n**Ignored members:** ${row.ignored_user_ids?.length ?? 0}`;
  return interaction.reply({ components: [textCard(text, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}
