const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const config = require('../../config');
const supabase = require('../../db/supabase');
const { getLogConfig } = require('../../db/logConfig');
const { getConfig: getMemberEventsConfig } = require('../../db/memberEvents');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const DIAGNOSTIC_GUILD_ID = '1502171756113432607';
const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const GREEN = 0xa5ea7a;
const RED = 0xfe6465;
const YELLOW = 0xf5c451;
const SNOWFLAKE_RE = /^\d{15,25}$/;

const IMPORTANT_PERMISSIONS = [
  ['ViewChannel', 'View Channel'],
  ['SendMessages', 'Send Messages'],
  ['EmbedLinks', 'Embed Links'],
  ['ReadMessageHistory', 'Read History'],
  ['ManageWebhooks', 'Manage Webhooks'],
];

function validSnowflake(value) {
  return SNOWFLAKE_RE.test(String(value ?? ''));
}

function clean(value, fallback = 'unknown') {
  const text = String(value ?? '').replace(/[`\r\n]/g, ' ').trim();
  return text || fallback;
}

function shorten(value, max = 120) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function status(ok, yes = 'yes', no = 'NO') {
  return ok ? `✅ ${yes}` : `❌ ${no}`;
}

function channelName(channel, channelId) {
  if (!channel) return `\`${channelId}\` (missing)`;
  return `<#${channel.id}> (\`${shorten(channel.name, 60)}\`)`;
}

function getPermissions(channel, member) {
  const permissions = member && channel?.permissionsFor?.(member);
  return Object.fromEntries(IMPORTANT_PERMISSIONS.map(([key]) => [key, Boolean(permissions?.has(PermissionFlagsBits[key]))]));
}

function permissionLine(permissions) {
  return IMPORTANT_PERMISSIONS
    .map(([key, label]) => `${label}: ${status(permissions[key])}`)
    .join(' · ');
}

async function resolveGuild(client, guildId) {
  if (!validSnowflake(guildId)) return null;
  return client.guilds.cache.get(guildId) ?? client.guilds.fetch(guildId).catch(() => null);
}

async function fetchChannels(guild) {
  return guild.channels.fetch().catch(() => guild.channels.cache);
}

async function fetchBotMember(guild, client) {
  return guild.members.me ?? guild.members.fetch(client.user.id).catch(() => null);
}

async function getDatabaseSnapshot(guildId) {
  const [guildResult, welcomeResult, logsResult] = await Promise.all([
    supabase
      .from('guilds')
      .select('guild_id,prefix,language,bot_nickname,setup_channel_id,updated_at')
      .eq('guild_id', guildId)
      .maybeSingle()
      .then(({ data, error }) => ({ data, error }))
      .catch((error) => ({ data: null, error })),
    getMemberEventsConfig(guildId)
      .then((data) => ({ data, error: null }))
      .catch((error) => ({ data: null, error })),
    getLogConfig(guildId)
      .then((data) => ({ data, error: null }))
      .catch((error) => ({ data: null, error })),
  ]);

  return { guild: guildResult, welcome: welcomeResult, logs: logsResult };
}

function formatWelcome(welcome, channels) {
  if (welcome.error) return 'database unavailable';
  if (!welcome.data) return 'not configured';
  if (!welcome.data.welcome_channel_id && !welcome.data.welcome_message && !welcome.data.welcome_embed_template) return 'not configured';

  const channel = welcome.data.welcome_channel_id ? channels.get(welcome.data.welcome_channel_id) : null;
  const destination = welcome.data.welcome_channel_id
    ? channelName(channel, welcome.data.welcome_channel_id)
    : 'channel missing';
  const content = welcome.data.welcome_message || welcome.data.welcome_embed_template ? 'configured' : 'empty';
  return `${destination} · content ${content}`;
}

function formatLogRoutes(logs, channels, botMember) {
  if (logs.error) return ['Log configuration: database unavailable'];
  const entries = logs.data?.entries ?? [];
  const webhooks = logs.data?.webhooks ?? [];
  if (!entries.length) return ['Log configuration: no event routes'];

  const grouped = new Map();
  for (const entry of entries) {
    const rows = grouped.get(entry.channel_id) ?? [];
    rows.push(entry);
    grouped.set(entry.channel_id, rows);
  }

  const lines = [...grouped.entries()].slice(0, 12).map(([channelId, rows]) => {
    const channel = channels.get(channelId);
    const permissions = getPermissions(channel, botMember);
    const webhook = webhooks.find((row) => row.channel_id === channelId);
    return `• ${channelName(channel, channelId)} · events: ${rows.map((row) => row.event).join(', ')} · DB webhook: ${webhook ? 'stored' : '❌ MISSING'} · send: ${status(permissions.SendMessages)}`;
  });

  if (grouped.size > 12) lines.push(`• …and ${grouped.size - 12} more route(s).`);
  lines.push(`Log summary: ${entries.length} route(s) · ${webhooks.length} stored webhook(s) · ${(logs.data?.ignored ?? []).length} ignored target(s)`);
  return lines;
}

async function buildGuildInfo(client, guildId) {
  const guild = await resolveGuild(client, guildId);
  if (!guild) return `${EMOJI.DENY} Petto is not in guild \`${guildId}\`, or Discord did not allow the guild lookup.`;

  const [channels, botMember, owner, database] = await Promise.all([
    fetchChannels(guild),
    fetchBotMember(guild, client),
    guild.fetchOwner().catch(() => null),
    getDatabaseSnapshot(guild.id),
  ]);

  const allChannels = [...channels.values()].filter(Boolean);
  const textChannels = allChannels.filter((channel) => channel.isTextBased?.());
  const voiceChannels = allChannels.filter((channel) => channel.isVoiceBased?.());
  const permissions = getPermissions(guild.systemChannel ?? textChannels[0], botMember);
  const dbGuild = database.guild.data;
  const dbStatus = database.guild.error ? 'unavailable' : dbGuild ? 'present' : 'missing';
  const welcomeChannel = database.welcome.data?.welcome_channel_id;
  const welcomeChannelObject = welcomeChannel ? channels.get(welcomeChannel) : null;
  const welcomePermissions = getPermissions(welcomeChannelObject, botMember);
  const warningCount = [
    !permissions.SendMessages && 'bot cannot send messages in the fallback/system channel',
    database.logs.data?.entries?.some((entry) => !database.logs.data.webhooks.some((hook) => hook.channel_id === entry.channel_id)) && 'one or more log routes have no stored webhook',
    welcomeChannel && !channels.has(welcomeChannel) && 'configured welcome channel is missing',
    welcomeChannelObject && !welcomePermissions.SendMessages && 'bot cannot send messages in the configured welcome channel',
  ].filter(Boolean);

  const lines = [
    `### ${EMOJI.RELEASE_SETTINGS} Guild diagnostics`,
    `**Server:** ${shorten(guild.name, 90)} (\`${guild.id}\`)`,
    `**Bot membership:** ${status(true, 'present')} · **Owner:** ${owner ? `<@${owner.id}>` : `\`${guild.ownerId}\``}`,
    `**Members:** ${guild.memberCount ?? 'unknown'} · **Channels:** ${allChannels.length} (${textChannels.length} text, ${voiceChannels.length} voice)`,
    `**Bot permissions:** ${permissionLine(permissions)}`,
    '',
    `**Database row:** ${dbStatus} · **Prefix:** \`${clean(dbGuild?.prefix, '!')}\` · **Language:** ${clean(dbGuild?.language, 'en')}`,
    `**Welcome:** ${formatWelcome(database.welcome, channels)}`,
    welcomeChannelObject ? `**Welcome permissions:** ${permissionLine(welcomePermissions)}` : '**Welcome permissions:** not available',
    `**Stored setup channel:** ${dbGuild?.setup_channel_id ? channelName(channels.get(dbGuild.setup_channel_id), dbGuild.setup_channel_id) : 'not set'}`,
    '',
    '**Log routes:**',
    ...formatLogRoutes(database.logs, channels, botMember),
  ];

  if (warningCount.length) {
    lines.push('', `**${EMOJI.WARNING} Attention:** ${warningCount.join('; ')}.`);
  }

  return lines.join('\n');
}

async function getWritableChannel(guild, botMember, channels) {
  const preferred = [guild.systemChannelId, ...channels.keys()]
    .filter((id, index, list) => id && list.indexOf(id) === index)
    .map((id) => channels.get(id))
    .filter(Boolean);

  return preferred.find((channel) => {
    if (!channel.isTextBased?.() || !channel.isSendable?.()) return false;
    return getPermissions(channel, botMember).ViewChannel && getPermissions(channel, botMember).SendMessages;
  }) ?? null;
}

async function sendToGuild(interaction) {
  const guildId = interaction.options.getString('guild_id', true);
  const channelId = interaction.options.getString('channel_id');
  const message = interaction.options.getString('message', true);
  const guild = await resolveGuild(interaction.client, guildId);
  if (!guild) return replyCard(interaction, `${EMOJI.DENY} Petto is not in guild \`${guildId}\`, or it could not be fetched.`, RED);

  const [channels, botMember] = await Promise.all([fetchChannels(guild), fetchBotMember(guild, interaction.client)]);
  const channel = channelId
    ? channels.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null)
    : await getWritableChannel(guild, botMember, channels);

  if (!channel) return replyCard(interaction, `${EMOJI.DENY} I could not find a writable text channel in **${shorten(guild.name)}**. Provide a valid \`channel_id\` or grant me View Channel + Send Messages.`, RED);
  const permissions = getPermissions(channel, botMember);
  if (!channel.isTextBased?.() || !channel.isSendable?.()) return replyCard(interaction, `${EMOJI.DENY} \`${channel.id}\` is not a sendable text channel.`, RED);
  if (!permissions.ViewChannel || !permissions.SendMessages) return replyCard(interaction, `${EMOJI.DENY} I cannot send in <#${channel.id}>. ${permissionLine(permissions)}`, RED);

  const sent = await channel.send({ content: message, allowedMentions: { parse: [] } });
  return replyCard(interaction, `${EMOJI.APPROVE} Sent the test message to <#${channel.id}> in **${shorten(guild.name)}**.\nMessage ID: \`${sent.id}\``, GREEN);
}

async function dmGuildOwner(interaction) {
  const guildId = interaction.options.getString('guild_id', true);
  const message = interaction.options.getString('message', true);
  const guild = await resolveGuild(interaction.client, guildId);
  if (!guild) return replyCard(interaction, `${EMOJI.DENY} Petto is not in guild \`${guildId}\`, or it could not be fetched.`, RED);

  const owner = await guild.fetchOwner().catch(() => null);
  if (!owner?.user) return replyCard(interaction, `${EMOJI.DENY} I could not fetch the owner of **${shorten(guild.name)}**.`, RED);

  const sent = await owner.user.send({ content: message, allowedMentions: { parse: [] } });
  return replyCard(interaction, `${EMOJI.APPROVE} Sent a DM to the owner of **${shorten(guild.name)}** (\`${owner.id}\`).\nMessage ID: \`${sent.id}\``, GREEN);
}

async function replyCard(interaction, content, color = 0x4b4f59) {
  const payload = { components: [textCard(content, color)], flags: V2_EPHEMERAL, allowedMentions: { parse: [] } };
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

module.exports = {
  privateGuildId: DIAGNOSTIC_GUILD_ID,
  slashOnly: true,
  hiddenFromHelp: true,
  data: new SlashCommandBuilder()
    .setName('guilddebug')
    .setDescription('Private diagnostics for a guild (Petto owner only).')
    .setDMPermission(false)
    .addSubcommand((subcommand) => subcommand
      .setName('info')
      .setDescription('Check membership, permissions, database config, welcome and logs.')
      .addStringOption((option) => option.setName('guild_id').setDescription('Guild ID to inspect').setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('send')
      .setDescription('Send a controlled test message through Petto.')
      .addStringOption((option) => option.setName('guild_id').setDescription('Destination guild ID').setRequired(true))
      .addStringOption((option) => option.setName('message').setDescription('Message to send (mentions are disabled)').setMaxLength(2000).setRequired(true))
      .addStringOption((option) => option.setName('channel_id').setDescription('Optional destination channel ID; otherwise choose a writable channel').setRequired(false)))
    .addSubcommand((subcommand) => subcommand
      .setName('dm-owner')
      .setDescription('Send a controlled test DM to a guild owner.')
      .addStringOption((option) => option.setName('guild_id').setDescription('Guild ID whose owner should receive the DM').setRequired(true))
      .addStringOption((option) => option.setName('message').setDescription('Message to send (mentions are disabled)').setMaxLength(2000).setRequired(true))),

  async execute(interaction) {
    if (interaction.guildId !== DIAGNOSTIC_GUILD_ID || interaction.user.id !== config.ownerId) {
      return replyCard(interaction, `${EMOJI.DENY} This private diagnostic command is unavailable here.`, RED);
    }

    await interaction.deferReply({ flags: V2_EPHEMERAL });
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === 'info') {
        const guildId = interaction.options.getString('guild_id', true);
        return interaction.editReply({ components: [textCard(await buildGuildInfo(interaction.client, guildId), YELLOW)], flags: V2_EPHEMERAL, allowedMentions: { parse: [] } });
      }
      if (subcommand === 'send') return await sendToGuild(interaction);
      if (subcommand === 'dm-owner') return await dmGuildOwner(interaction);
      return replyCard(interaction, `${EMOJI.DENY} Unknown diagnostic action.`, RED);
    } catch (error) {
      return replyCard(interaction, `${EMOJI.DENY} Diagnostic operation failed: \`${clean(error?.message ?? error, 'unknown error')}\``, RED);
    }
  },
};
