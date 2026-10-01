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
  RadioGroupBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { ensureGuild } = require('../db/guilds');
const { getConfig: getAutomodConfig } = require('../db/automod');
const { getConfig: getMemberConfig } = require('../db/memberEvents');
const { getConfig: getReportConfig } = require('../db/report');
const { getLogConfig } = require('../db/logConfig');
const { infoPayload, noticePayload, clip } = require('../utils/infoCard');
const { settle } = require('../utils/withTimeout');
const { EMOJI } = require('../utils/emojis');
const { COLORS } = require('../utils/colors');

const SETUP_QUICK_ID = 'setup:quick';
const SETUP_REFRESH_ID = 'setup:refresh';
const SETUP_BUTTON_PREFIX = 'setup:';
const SOURCE_TIMEOUT_MS = 2_200;
const STATE_TTL_MS = 30_000;

// What Petto needs in a server, and the feature that stops working without it.
const PERMISSION_CHECKS = [
  ['View Channels', PermissionFlagsBits.ViewChannel, 'everything'],
  ['Send Messages', PermissionFlagsBits.SendMessages, 'every reply'],
  ['Embed Links', PermissionFlagsBits.EmbedLinks, 'cards and previews'],
  ['Manage Webhooks', PermissionFlagsBits.ManageWebhooks, 'audit logs'],
  ['View Audit Log', PermissionFlagsBits.ViewAuditLog, 'audit logs'],
  ['Manage Roles', PermissionFlagsBits.ManageRoles, 'mute and jail roles'],
  ['Manage Channels', PermissionFlagsBits.ManageChannels, 'setup channel, jail, lockdown'],
  ['Manage Messages', PermissionFlagsBits.ManageMessages, 'purge and automod'],
  ['Kick Members', PermissionFlagsBits.KickMembers, 'kick and strict anti-raid'],
  ['Ban Members', PermissionFlagsBits.BanMembers, 'bans'],
  ['Moderate Members', PermissionFlagsBits.ModerateMembers, 'timeouts'],
  ['Manage Server', PermissionFlagsBits.ManageGuild, 'official AutoMod'],
];

const stateCache = new Map();

/** Reads every setting the panel shows at once. A source that is slow or failing is reported, never waited on. */
async function loadSetupState(guild, { fresh = false, timeoutMs = SOURCE_TIMEOUT_MS } = {}) {
  const cached = stateCache.get(guild.id);
  if (!fresh && cached && Date.now() - cached.loadedAt < STATE_TTL_MS) return cached;

  const [guildRow, automod, logs, welcome, report] = await Promise.all([
    settle(ensureGuild(guild.id), timeoutMs, 'guild settings'),
    settle(getAutomodConfig(guild.id), timeoutMs, 'automod settings'),
    settle(getLogConfig(guild.id), timeoutMs, 'log settings'),
    settle(getMemberConfig(guild.id), timeoutMs, 'welcome settings'),
    settle(getReportConfig(guild.id), timeoutMs, 'report settings'),
  ]);

  const state = {
    loadedAt: Date.now(),
    guild: guildRow.ok ? guildRow.value : null,
    automod: automod.ok ? automod.value : null,
    logs: logs.ok ? logs.value : null,
    welcome: welcome.ok ? welcome.value : null,
    report: report.ok ? report.value : null,
    unavailable: [guildRow, automod, logs, welcome, report].some((result) => !result.ok),
  };
  stateCache.set(guild.id, state);
  return state;
}

function invalidateSetupState(guildId) {
  stateCache.delete(guildId);
}

function moderationMode(automod) {
  if (!automod) return 'balanced';
  const protections = [automod.anti_spam_enabled, automod.anti_raid_enabled, automod.anti_alt_enabled];
  if (!protections.some(Boolean)) return 'disabled';
  return automod.raid_action === 'kick' || automod.anti_alt_action === 'kick' ? 'strict' : 'balanced';
}

function checklist(state, guild) {
  const logChannels = [...new Set((state.logs?.entries ?? []).map((entry) => entry.channel_id))];
  const welcomeChannel = state.welcome?.welcome_channel_id;
  const automod = state.automod;
  const protections = automod
    ? [automod.anti_spam_enabled && 'anti-spam', automod.anti_raid_enabled && 'anti-raid', automod.anti_alt_enabled && 'anti-alt'].filter(Boolean)
    : [];
  const setupChannel = state.guild?.setup_channel_id && guild.channels.cache.has(state.guild.setup_channel_id) ? state.guild.setup_channel_id : null;

  return [
    { label: 'Prefix', done: Boolean(state.guild), detail: state.guild ? `\`${state.guild.prefix || '!'}\`` : 'could not load' },
    { label: 'Audit logs', done: logChannels.length > 0, detail: logChannels.length ? `${state.logs.entries.length} routes in ${logChannels.slice(0, 2).map((id) => `<#${id}>`).join(', ')}${logChannels.length > 2 ? ` +${logChannels.length - 2}` : ''}` : 'not set up' },
    { label: 'Welcome messages', done: Boolean(welcomeChannel), detail: welcomeChannel ? `<#${welcomeChannel}>` : 'not set up' },
    { label: 'Moderation', done: protections.length > 0, detail: protections.length ? `${moderationMode(automod)} · ${protections.join(', ')}` : 'protections are off' },
    { label: 'Reports', done: Boolean(state.report?.enabled && state.report.channel_id), detail: state.report?.enabled && state.report.channel_id ? `<#${state.report.channel_id}>` : 'run `/report config`' },
    { label: 'Setup channel', done: Boolean(setupChannel), detail: setupChannel ? `<#${setupChannel}>` : 'not created' },
  ];
}

function permissionAudit(guild) {
  const me = guild.members.me;
  if (!me) return { missing: [], unknown: true };
  if (me.permissions.has(PermissionFlagsBits.Administrator)) return { missing: [], unknown: false };
  return { missing: PERMISSION_CHECKS.filter(([, flag]) => !me.permissions.has(flag)), unknown: false };
}

function progressBar(done, total) {
  return `${'▰'.repeat(done)}${'▱'.repeat(total - done)}`;
}

function buildSetupPanel(guild, state, { notice = null } = {}) {
  const items = checklist(state, guild);
  const done = items.filter((item) => item.done).length;
  const audit = permissionAudit(guild);

  const permissionLines = audit.missing.length
    ? [
        `${EMOJI.WARNING} **Missing ${audit.missing.length}** ${audit.missing.length === 1 ? 'permission' : 'permissions'}:`,
        ...audit.missing.map(([name, , reason]) => `> **${name}** · ${reason}`),
      ]
    : [`${EMOJI.APPROVE} Petto has every permission it needs.`];

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(SETUP_QUICK_ID).setLabel('Quick setup').setEmoji(EMOJI.RELEASE_ROCKET).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(SETUP_REFRESH_ID).setLabel('Refresh').setEmoji(EMOJI.RELEASE_RELOAD).setStyle(ButtonStyle.Secondary),
    ),
  ];

  return infoPayload({
    accent: done === items.length && !audit.missing.length ? COLORS.GREEN : audit.missing.length ? COLORS.YELLOW : 0x8c7cff,
    title: `${EMOJI.RELEASE_SETTINGS} Petto setup`,
    thumbnail: guild.iconURL({ size: 256 }),
    subtitle: [
      guild.name,
      `${progressBar(done, items.length)}  **${done}/${items.length}** areas configured`,
      state.unavailable ? `${EMOJI.WARNING} Some settings could not be loaded right now; press **Refresh** to try again.` : null,
      notice,
    ],
    sections: [
      {
        title: 'Configuration',
        lines: items.map((item) => `${item.done ? EMOJI.APPROVE : EMOJI.RELEASE_MINUS} **${item.label}** · ${item.detail}`),
      },
      { title: 'Permissions', lines: permissionLines },
    ],
    footer: 'Quick setup opens one form with everything pre-filled from your current settings.',
    rows,
    buttons: [
      { label: 'Documentation', url: 'https://wiki.petto.sbs/overview/introduction' },
      { label: 'Dashboard', url: 'https://petto.sbs/dash' },
    ],
  });
}

function usableChannel(guild, id) {
  return id && guild.channels.cache.has(id) ? id : null;
}

/** The quick setup form, pre-filled from what the server already has so running it again never resets anything. */
function buildSetupModal(guild, state) {
  const prefix = state.guild?.prefix || '!';
  const logChannelId = usableChannel(guild, state.logs?.entries?.[0]?.channel_id);
  const welcomeChannelId = usableChannel(guild, state.welcome?.welcome_channel_id);
  const mode = moderationMode(state.automod);
  const automod = state.automod ?? {};

  const selected = new Set([
    logChannelId && 'logs',
    welcomeChannelId && 'welcome',
    automod.anti_spam_enabled && 'anti-spam',
    automod.anti_raid_enabled && 'anti-raid',
    automod.anti_alt_enabled && 'anti-alt',
  ].filter(Boolean));

  const logSelect = new ChannelSelectMenuBuilder()
    .setCustomId('setup_log_channel')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(1)
    .setRequired(false);
  if (logChannelId) logSelect.setDefaultChannels(logChannelId);

  const welcomeSelect = new ChannelSelectMenuBuilder()
    .setCustomId('setup_welcome_channel')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(1)
    .setRequired(false);
  if (welcomeChannelId) welcomeSelect.setDefaultChannels(welcomeChannelId);

  const feature = (label, value, description) => ({ label, value, description, default: selected.has(value) });

  return new ModalBuilder()
    .setCustomId('petto_setup_modal')
    .setTitle('Petto Setup')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Log Channel')
        .setDescription('Where Petto should send audit, moderation and automod logs.')
        .setChannelSelectMenuComponent(logSelect),
      new LabelBuilder()
        .setLabel('Welcome Channel')
        .setDescription('Where Petto should post the default member welcome message.')
        .setChannelSelectMenuComponent(welcomeSelect),
      new LabelBuilder()
        .setLabel('Moderation Mode')
        .setDescription('Choose the default level for local anti-spam and join protection.')
        .setRadioGroupComponent(
          new RadioGroupBuilder()
            .setCustomId('setup_moderation_mode')
            .setRequired(true)
            .addOptions(
              { label: 'Balanced', value: 'balanced', description: 'Warns first and alerts on suspicious joins.', default: mode === 'balanced' },
              { label: 'Strict', value: 'strict', description: 'Enables automatic kicks for configured raid and alt checks.', default: mode === 'strict' },
              { label: 'Disabled', value: 'disabled', description: 'Leaves automatic moderation protections off.', default: mode === 'disabled' },
            ),
        ),
      new LabelBuilder()
        .setLabel('Features')
        .setDescription('Select the modules to enable during this setup.')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('setup_features')
            .setPlaceholder('Select features to enable')
            .setMinValues(0)
            .setMaxValues(6)
            .setRequired(false)
            .addOptions(
              feature('Audit logs', 'logs', 'Route Petto event logs to the selected log channel.'),
              feature('Welcome messages', 'welcome', 'Send a default message when members join.'),
              feature('Anti-spam', 'anti-spam', 'Detect flooding, mass mentions and invite spam.'),
              feature('Anti-raid', 'anti-raid', 'Detect bursts of new members joining.'),
              feature('Anti-alt', 'anti-alt', 'Flag or kick very new accounts.'),
              feature('Official Discord AutoMod', 'official-automod', 'Create Petto rules in Discord AutoMod; Manage Server is required.'),
            ),
        ),
      new LabelBuilder()
        .setLabel('Command Prefix')
        .setDescription('The prefix for Petto commands, up to five characters.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('setup_prefix')
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(5)
            .setValue(clip(prefix, 5))
            .setRequired(true),
        ),
    );
}

async function handleSetupButton(interaction) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ ...noticePayload('You need the **Manage Server** permission to use setup.', COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.customId === SETUP_QUICK_ID) {
    // A modal has to open within three seconds of the click, so a slow database falls back to the defaults.
    const state = await loadSetupState(interaction.guild, { timeoutMs: 1_500 });
    await interaction.showModal(buildSetupModal(interaction.guild, state));
    return true;
  }

  if (interaction.customId === SETUP_REFRESH_ID) {
    await interaction.deferUpdate();
    const state = await loadSetupState(interaction.guild, { fresh: true });
    await interaction.editReply(buildSetupPanel(interaction.guild, state));
    return true;
  }

  return false;
}

module.exports = {
  SETUP_BUTTON_PREFIX,
  loadSetupState,
  invalidateSetupState,
  moderationMode,
  buildSetupPanel,
  buildSetupModal,
  handleSetupButton,
};
