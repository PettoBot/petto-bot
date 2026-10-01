const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { ensureGuild } = require('../db/guilds');
const { getConfig, upsertConfig } = require('../db/report');
const { buildReportCard } = require('../utils/reportCard');
const { infoPayload, noticePayload } = require('../utils/infoCard');
const { EMOJI } = require('../utils/emojis');
const { COLORS } = require('../utils/colors');
const { formatDuration } = require('../utils/duration');
const logger = require('../utils/logger');

const CONFIG_PREFIX = 'rptc:';
const LIMITS_MODAL_ID = 'rptc_limits_modal';

const DEFAULTS = {
  enabled: false,
  channel_id: null,
  urgent_role_id: null,
  ping_role_id: null,
  anonymous_reporting_enabled: false,
  require_reason: false,
  notify_reporter: true,
  auto_thread: false,
  cooldown_seconds: 60,
  daily_limit: 10,
};

// button key -> column
const TOGGLES = {
  enabled: { column: 'enabled', label: 'Reports' },
  anonymous: { column: 'anonymous_reporting_enabled', label: 'Anonymous' },
  reason: { column: 'require_reason', label: 'Require reason' },
  notify: { column: 'notify_reporter', label: 'Notify reporter' },
  thread: { column: 'auto_thread', label: 'Thread' },
};

const CHANNEL_NEEDS = [
  ['View Channel', PermissionFlagsBits.ViewChannel],
  ['Send Messages', PermissionFlagsBits.SendMessages],
  ['Embed Links', PermissionFlagsBits.EmbedLinks],
];

function onOff(value) {
  return value ? 'On' : 'Off';
}

/** What Petto still lacks in the report channel; empty when everything needed is there. */
function channelProblems(guild, config) {
  if (!config.channel_id) return [];
  const channel = guild.channels.cache.get(config.channel_id);
  if (!channel) return ['the channel no longer exists'];
  const me = guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!permissions) return [];
  const missing = CHANNEL_NEEDS.filter(([, flag]) => !permissions.has(flag)).map(([name]) => name);
  if (config.auto_thread && !permissions.has(PermissionFlagsBits.CreatePublicThreads)) missing.push('Create Public Threads');
  return missing;
}

function buildConfigPanel(guild, stored, { notice = null } = {}) {
  const config = { ...DEFAULTS, ...(stored ?? {}) };
  const problems = channelProblems(guild, config);
  const ready = config.enabled && config.channel_id && !problems.length;

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`${CONFIG_PREFIX}channel`)
    .setPlaceholder('Report channel')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);
  if (config.channel_id && guild.channels.cache.has(config.channel_id)) channelSelect.setDefaultChannels(config.channel_id);

  const roleSelect = (suffix, placeholder, current) => {
    const select = new RoleSelectMenuBuilder().setCustomId(`${CONFIG_PREFIX}${suffix}`).setPlaceholder(placeholder).setMinValues(0).setMaxValues(1);
    if (current && guild.roles.cache.has(current)) select.setDefaultRoles(current);
    return select;
  };

  const toggle = (key) => {
    const { column, label } = TOGGLES[key];
    return new ButtonBuilder()
      .setCustomId(`${CONFIG_PREFIX}toggle:${key}`)
      .setLabel(`${label}: ${onOff(config[column])}`)
      .setStyle(config[column] ? ButtonStyle.Success : ButtonStyle.Secondary);
  };

  const rows = [
    new ActionRowBuilder().addComponents(channelSelect),
    new ActionRowBuilder().addComponents(roleSelect('urgent', 'Urgent role (pinged when a reporter asks)', config.urgent_role_id)),
    new ActionRowBuilder().addComponents(roleSelect('ping', 'Role pinged on every report', config.ping_role_id)),
    new ActionRowBuilder().addComponents(toggle('enabled'), toggle('anonymous'), toggle('reason'), toggle('notify'), toggle('thread')),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${CONFIG_PREFIX}limits`).setLabel('Limits').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${CONFIG_PREFIX}test`).setLabel('Send test report').setStyle(ButtonStyle.Secondary),
    ),
  ];

  const status = !config.channel_id
    ? `${EMOJI.WARNING} Pick a report channel to start receiving reports.`
    : problems.length
      ? `${EMOJI.WARNING} I am missing **${problems.join(', ')}** in <#${config.channel_id}>.`
      : config.enabled
        ? `${EMOJI.APPROVE} Reports are on and delivered to <#${config.channel_id}>.`
        : `${EMOJI.RELEASE_MINUS} Reports are off. Press **Reports: Off** to turn them on.`;

  return infoPayload({
    accent: ready ? COLORS.GREEN : problems.length ? COLORS.YELLOW : 0xfe6465,
    title: `${EMOJI.REPORT} Report settings`,
    thumbnail: guild.iconURL({ size: 256 }),
    subtitle: [guild.name, status, notice],
    sections: [
      {
        title: 'Delivery',
        lines: [
          `**Channel** ${config.channel_id ? `<#${config.channel_id}>` : 'not set'}`,
          `**Urgent role** ${config.urgent_role_id ? `<@&${config.urgent_role_id}>` : 'none'}`,
          `**Always pinged** ${config.ping_role_id ? `<@&${config.ping_role_id}>` : 'none'}`,
          `**Discussion thread** ${onOff(config.auto_thread)} · a thread under every report`,
        ],
      },
      {
        title: 'Rules',
        lines: [
          `**Anonymous reports** ${onOff(config.anonymous_reporting_enabled)} · reporters can hide their name`,
          `**Reason required** ${onOff(config.require_reason)}`,
          `**Notify reporter** ${onOff(config.notify_reporter)} · a DM when staff close the report`,
          `**Cooldown** ${config.cooldown_seconds ? formatDuration(config.cooldown_seconds * 1000) : 'none'} between reports`,
          `**Daily limit** ${config.daily_limit ? `${config.daily_limit} per member` : 'none'}`,
        ],
      },
    ],
    footer: 'Changes apply immediately. Use /report list, view, stats and block to manage reports.',
    rows,
  });
}

function limitsModal(config) {
  const merged = { ...DEFAULTS, ...(config ?? {}) };
  const numberInput = (customId, value) => new TextInputBuilder().setCustomId(customId).setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(5).setValue(String(value)).setRequired(true);
  return new ModalBuilder()
    .setCustomId(LIMITS_MODAL_ID)
    .setTitle('Report limits')
    .addLabelComponents(
      new LabelBuilder().setLabel('Cooldown (seconds)').setDescription('Time a member must wait between reports. 0 turns it off. Maximum 86400.').setTextInputComponent(numberInput('cooldown', merged.cooldown_seconds)),
      new LabelBuilder().setLabel('Daily limit').setDescription('Reports one member can send per day. 0 turns it off. Maximum 100.').setTextInputComponent(numberInput('daily', merged.daily_limit)),
    );
}

function parseLimit(raw, max) {
  const text = String(raw ?? '').trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const value = Number(text);
  return value <= max ? value : null;
}

function ephemeral(text, color = COLORS.RED) {
  return { ...noticePayload(text, color), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
}

/** Sends a sample report so staff can see the layout and confirm Petto can really post there. */
async function sendTestReport(interaction, config) {
  if (!config.channel_id) return ephemeral('Pick a report channel first.');
  const channel = await interaction.guild.channels.fetch(config.channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) return ephemeral('The report channel no longer exists. Pick another one.');
  const problems = channelProblems(interaction.guild, config);
  if (problems.length) return ephemeral(`I am missing **${problems.join(', ')}** in <#${channel.id}>.`);

  const sample = buildReportCard({
    report_number: 0,
    reporter_id: interaction.user.id,
    reported_user_id: interaction.client.user.id,
    category: 'other',
    reason: `Test report sent by ${interaction.user.username}. Nothing needs to be done.`,
    source_channel_id: interaction.channelId,
    anonymous: false,
    urgent: false,
    status: 'open',
    image_urls: [],
    created_at: new Date().toISOString(),
  }, { withActions: false });

  try {
    await channel.send({ components: [sample], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
  } catch (err) {
    logger.warn(`Test report failed in guild ${interaction.guild.id}: ${err.message}`);
    return ephemeral(`I could not post in <#${channel.id}>: ${err.message}`);
  }
  return ephemeral(`${EMOJI.APPROVE} A test report was posted in <#${channel.id}>.`, COLORS.GREEN);
}

async function saveAndShow(interaction, patch, options = {}) {
  const saved = await upsertConfig(interaction.guild.id, patch);
  await interaction.update(buildConfigPanel(interaction.guild, saved, options));
}

/** Buttons and selects of the report settings panel. */
async function handleConfigComponent(interaction) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply(ephemeral('You need the **Manage Server** permission to change report settings.'));
    return true;
  }

  await ensureGuild(interaction.guild.id);
  const config = { ...DEFAULTS, ...((await getConfig(interaction.guild.id).catch(() => null)) ?? {}) };
  const action = interaction.customId.slice(CONFIG_PREFIX.length);

  if (action === 'channel') {
    const channel = interaction.channels?.first?.() ?? null;
    if (!channel) {
      await interaction.reply(ephemeral('Choose a report channel.'));
      return true;
    }
    const me = interaction.guild.members.me;
    const permissions = me ? channel.permissionsFor(me) : null;
    const missing = permissions ? CHANNEL_NEEDS.filter(([, flag]) => !permissions.has(flag)).map(([name]) => name) : [];
    if (missing.length) {
      await interaction.reply(ephemeral(`I need **${missing.join(', ')}** in <#${channel.id}> before it can receive reports.`));
      return true;
    }
    await saveAndShow(interaction, { channel_id: channel.id });
    return true;
  }

  if (action === 'urgent' || action === 'ping') {
    const role = interaction.roles?.first?.() ?? null;
    if (role?.id === interaction.guild.id) {
      await interaction.reply(ephemeral('The @everyone role cannot be used here.'));
      return true;
    }
    await saveAndShow(interaction, { [action === 'urgent' ? 'urgent_role_id' : 'ping_role_id']: role?.id ?? null });
    return true;
  }

  if (action.startsWith('toggle:')) {
    const toggle = TOGGLES[action.slice('toggle:'.length)];
    if (!toggle) return false;
    if (toggle.column === 'enabled' && !config.enabled && !config.channel_id) {
      await interaction.reply(ephemeral('Pick a report channel first, then turn reports on.'));
      return true;
    }
    await saveAndShow(interaction, { [toggle.column]: !config[toggle.column] });
    return true;
  }

  if (action === 'limits') {
    await interaction.showModal(limitsModal(config));
    return true;
  }

  if (action === 'test') {
    await interaction.reply(await sendTestReport(interaction, config));
    return true;
  }

  return false;
}

/** The limits form. It was opened from the panel, so it updates the panel in place. */
async function handleLimitsModal(interaction) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply(ephemeral('You need the **Manage Server** permission to change report settings.'));
    return;
  }

  const cooldown = parseLimit(interaction.fields.getTextInputValue('cooldown'), 86_400);
  const daily = parseLimit(interaction.fields.getTextInputValue('daily'), 100);
  if (cooldown === null || daily === null) {
    await interaction.reply(ephemeral('Use whole numbers: cooldown from 0 to 86400 seconds and daily limit from 0 to 100.'));
    return;
  }

  await ensureGuild(interaction.guild.id);
  const saved = await upsertConfig(interaction.guild.id, { cooldown_seconds: cooldown, daily_limit: daily });
  const panel = buildConfigPanel(interaction.guild, saved);
  if (interaction.isFromMessage?.()) await interaction.update(panel);
  else await interaction.reply({ ...panel, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

module.exports = { CONFIG_PREFIX, LIMITS_MODAL_ID, buildConfigPanel, handleConfigComponent, handleLimitsModal, channelProblems };
