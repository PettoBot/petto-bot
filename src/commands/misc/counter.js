const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const countersDb = require('../../db/counters');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const TYPE_CHOICES = [
  { name: 'voice', value: 'voice' }, { name: 'text', value: 'text' }, { name: 'category', value: 'category' },
  { name: 'announcement', value: 'announce' }, { name: 'stage', value: 'stage' },
];

module.exports = {
  aliases: ['counters'],
  data: new SlashCommandBuilder()
    .setName('counter')
    .setDescription('Create live server counters as channel names.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('add').setDescription('Create a live counter channel.').addStringOption((o) => o.setName('option').setDescription('What to count, or a unix timestamp').setRequired(true)).addStringOption((o) => o.setName('type').setDescription('Channel type').setRequired(true).addChoices(...TYPE_CHOICES)))
    .addSubcommand((s) => s.setName('remove').setDescription('Stop updating a counter; the channel stays.').addChannelOption((o) => o.setName('channel').setDescription('Counter channel').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List live counters.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return add(interaction);
    if (sub === 'remove') return remove(interaction);
    return list(interaction);
  },
};

const OPTIONS = new Set(['members', 'users_only', 'bots_only', 'pending_members', 'all_channels', 'text_channels', 'voice_channels', 'categories', 'announcement_channels', 'staging_channels', 'boosts', 'booster_count']);

function card(interaction, content, color = 0x8399ff) { return interaction.reply({ components: [textCard(content, color)], flags: MessageFlags.IsComponentsV2 }); }

async function add(interaction) {
  const option = interaction.options.getString('option', true).trim().toLowerCase();
  const type = interaction.options.getString('type', true);
  if (!OPTIONS.has(option) && !/^\d{10}$/.test(option)) return card(interaction, `Unknown counter option. Use one of: ${[...OPTIONS].join(', ')} or a 10-digit unix timestamp.`, 0xfe6465);
  const channelType = { voice: ChannelType.GuildVoice, text: ChannelType.GuildText, category: ChannelType.GuildCategory, announce: ChannelType.GuildAnnouncement, stage: ChannelType.GuildStageVoice }[type];
  try {
    const channel = await interaction.guild.channels.create({ name: `Counter: ${option}`, type: channelType, reason: `Counter created by ${interaction.user.tag}` });
    await countersDb.add({ guild_id: interaction.guild.id, channel_id: channel.id, counter_option: option, channel_type: type, created_by: interaction.user.id });
    return card(interaction, `${EMOJI.APPROVE}  Counter created: ${channel}. It will update automatically.`, 0xa5ea7a);
  } catch (err) {
    return card(interaction, `Could not create that counter: ${err.message ?? 'check my Manage Channels permission.'}`, 0xfe6465);
  }
}

async function remove(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  const removed = await countersDb.remove(interaction.guild.id, channel.id);
  return card(interaction, removed ? `${EMOJI.APPROVE}  Counter stopped for ${channel}. The channel was not deleted.` : 'That channel is not a Petto counter.', removed ? 0xa5ea7a : 0xfe6465);
}

async function list(interaction) {
  const rows = await countersDb.list(interaction.guild.id);
  const body = rows.length ? rows.map((row) => `<#${row.channel_id}> · \`${row.counter_option}\` · ${row.channel_type}`).join('\n') : 'No counters configured.';
  return card(interaction, `**Counters (${rows.length})**\n${body}`);
}
