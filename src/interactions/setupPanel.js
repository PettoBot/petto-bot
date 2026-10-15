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
const { t, tn, currentLanguage, languageOf } = require('../i18n');

const SETUP_QUICK_ID = 'setup:quick';
const SETUP_REFRESH_ID = 'setup:refresh';
const SETUP_BUTTON_PREFIX = 'setup:';
const SOURCE_TIMEOUT_MS = 2_200;
const STATE_TTL_MS = 30_000;

// What Petto needs in a server, and the feature that stops working without it: [name key, flag, reason key]. The names are the
// shared core.perm.* ones, except two that this panel has always written differently in English.
const PERMISSION_CHECKS = [
  ['setup.perm.ViewChannel', PermissionFlagsBits.ViewChannel, 'setup.need.everything'],
  ['core.perm.SendMessages', PermissionFlagsBits.SendMessages, 'setup.need.replies'],
  ['core.perm.EmbedLinks', PermissionFlagsBits.EmbedLinks, 'setup.need.cards'],
  ['core.perm.ManageWebhooks', PermissionFlagsBits.ManageWebhooks, 'setup.need.auditLogs'],
  ['core.perm.ViewAuditLog', PermissionFlagsBits.ViewAuditLog, 'setup.need.auditLogs'],
  ['core.perm.ManageRoles', PermissionFlagsBits.ManageRoles, 'setup.need.roles'],
  ['core.perm.ManageChannels', PermissionFlagsBits.ManageChannels, 'setup.need.channels'],
  ['core.perm.ManageMessages', PermissionFlagsBits.ManageMessages, 'setup.need.messages'],
  ['core.perm.KickMembers', PermissionFlagsBits.KickMembers, 'setup.need.kick'],
  ['core.perm.BanMembers', PermissionFlagsBits.BanMembers, 'setup.need.bans'],
  ['setup.perm.ModerateMembers', PermissionFlagsBits.ModerateMembers, 'setup.need.timeouts'],
  ['core.perm.ManageGuild', PermissionFlagsBits.ManageGuild, 'setup.need.automod'],
];

const stateCache = new Map();

/** Reads every setting the panel shows at once. A source that is slow or failing is reported, never waited on. */
async function loadSetupState(guild, { fresh = false, timeoutMs = SOURCE_TIMEOUT_MS } = {}) {
  const cached = stateCache.get(guild.id);
  if (!fresh && cached && Date.now() - cached.loadedAt < STATE_TTL_MS) return cached;

  const [guildRow, automod, logs, welcome, report] = await Promise.all([
    settle(ensureGuild(guild.id), timeoutMs, 'guild settings'), // i18n-ignore: internal timeout label
    settle(getAutomodConfig(guild.id), timeoutMs, 'automod settings'), // i18n-ignore: internal timeout label
    settle(getLogConfig(guild.id), timeoutMs, 'log settings'), // i18n-ignore: internal timeout label
    settle(getMemberConfig(guild.id), timeoutMs, 'welcome settings'), // i18n-ignore: internal timeout label
    settle(getReportConfig(guild.id), timeoutMs, 'report settings'), // i18n-ignore: internal timeout label
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

function checklist(state, guild, lang) {
  const logChannels = [...new Set((state.logs?.entries ?? []).map((entry) => entry.channel_id))];
  const welcomeChannel = state.welcome?.welcome_channel_id;
  const automod = state.automod;
  const protections = automod
    ? [automod.anti_spam_enabled && 'anti-spam', automod.anti_raid_enabled && 'anti-raid', automod.anti_alt_enabled && 'anti-alt'].filter(Boolean)
    : [];
  const setupChannel = state.guild?.setup_channel_id && guild.channels.cache.has(state.guild.setup_channel_id) ? state.guild.setup_channel_id : null;

  const routes = () => tn(lang, 'setup.check.routes', state.logs.entries.length, {
    count: state.logs.entries.length,
    channels: `${logChannels.slice(0, 2).map((id) => `<#${id}>`).join(', ')}${logChannels.length > 2 ? ` +${logChannels.length - 2}` : ''}`,
  });
  return [
    { label: t(lang, 'setup.check.prefix'), done: Boolean(state.guild), detail: state.guild ? `\`${state.guild.prefix || '!'}\`` : t(lang, 'setup.check.couldNotLoad') },
    { label: t(lang, 'setup.check.logs'), done: logChannels.length > 0, detail: logChannels.length ? routes() : t(lang, 'setup.check.notSetUp') },
    { label: t(lang, 'setup.check.welcome'), done: Boolean(welcomeChannel), detail: welcomeChannel ? `<#${welcomeChannel}>` : t(lang, 'setup.check.notSetUp') },
    { label: t(lang, 'setup.check.moderation'), done: protections.length > 0, detail: protections.length ? `${t(lang, `setup.check.mode.${moderationMode(automod)}`)} · ${protections.join(', ')}` : t(lang, 'setup.check.protectionsOff') },
    { label: t(lang, 'setup.check.reports'), done: Boolean(state.report?.enabled && state.report.channel_id), detail: state.report?.enabled && state.report.channel_id ? `<#${state.report.channel_id}>` : t(lang, 'setup.check.reportsHint') },
    { label: t(lang, 'setup.check.setupChannel'), done: Boolean(setupChannel), detail: setupChannel ? `<#${setupChannel}>` : t(lang, 'setup.check.notCreated') },
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

function buildSetupPanel(guild, state, { notice = null, lang = currentLanguage() } = {}) {
  const items = checklist(state, guild, lang);
  const done = items.filter((item) => item.done).length;
  const audit = permissionAudit(guild);

  const permissionLines = audit.missing.length
    ? [
        tn(lang, 'setup.panel.missing', audit.missing.length, { emoji: EMOJI.WARNING, count: audit.missing.length }),
        ...audit.missing.map(([name, , reason]) => `> **${t(lang, name)}** · ${t(lang, reason)}`),
      ]
    : [t(lang, 'setup.panel.allPermissions', { emoji: EMOJI.APPROVE })];

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(SETUP_QUICK_ID).setLabel(t(lang, 'setup.panel.quick.button')).setEmoji(EMOJI.RELEASE_ROCKET).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(SETUP_REFRESH_ID).setLabel(t(lang, 'setup.panel.refresh.button')).setEmoji(EMOJI.RELEASE_RELOAD).setStyle(ButtonStyle.Secondary),
    ),
  ];

  return infoPayload({
    accent: done === items.length && !audit.missing.length ? COLORS.GREEN : audit.missing.length ? COLORS.YELLOW : 0x8c7cff,
    title: t(lang, 'setup.panel.title', { emoji: EMOJI.RELEASE_SETTINGS }),
    thumbnail: guild.iconURL({ size: 256 }),
    subtitle: [
      guild.name,
      t(lang, 'setup.panel.progress', { bar: progressBar(done, items.length), done, total: items.length }),
      state.unavailable ? t(lang, 'setup.panel.unavailable', { emoji: EMOJI.WARNING }) : null,
      notice,
    ],
    sections: [
      {
        title: t(lang, 'setup.panel.configuration'),
        lines: items.map((item) => `${item.done ? EMOJI.APPROVE : EMOJI.RELEASE_MINUS} **${item.label}** · ${item.detail}`),
      },
      { title: t(lang, 'setup.panel.permissions'), lines: permissionLines },
    ],
    footer: t(lang, 'setup.panel.footer'),
    rows,
    buttons: [
      { label: t(lang, 'setup.docs.button'), url: 'https://wiki.petto.sbs/overview/introduction' },
      { label: t(lang, 'setup.dashboard.button'), url: 'https://petto.sbs/dash' },
    ],
  });
}

function usableChannel(guild, id) {
  return id && guild.channels.cache.has(id) ? id : null;
}

/** The quick setup form, pre-filled from what the server already has so running it again never resets anything. */
function buildSetupModal(guild, state, lang = currentLanguage()) {
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

  const feature = (key, value) => ({ label: t(lang, `setup.modal.feature.${key}.menu`), value, description: t(lang, `setup.modal.feature.${key}.description.menu`), default: selected.has(value) });
  const modeOption = (value) => ({ label: t(lang, `setup.mode.${value}`), value, description: t(lang, `setup.modal.mode.${value}.menu`), default: mode === value });

  return new ModalBuilder()
    .setCustomId('petto_setup_modal')
    .setTitle(t(lang, 'setup.modal.title'))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(t(lang, 'setup.modal.logChannel'))
        .setDescription(t(lang, 'setup.modal.logChannelHint'))
        .setChannelSelectMenuComponent(logSelect),
      new LabelBuilder()
        .setLabel(t(lang, 'setup.modal.welcomeChannel'))
        .setDescription(t(lang, 'setup.modal.welcomeChannelHint'))
        .setChannelSelectMenuComponent(welcomeSelect),
      new LabelBuilder()
        .setLabel(t(lang, 'setup.modal.moderationMode'))
        .setDescription(t(lang, 'setup.modal.moderationModeHint'))
        .setRadioGroupComponent(
          new RadioGroupBuilder()
            .setCustomId('setup_moderation_mode')
            .setRequired(true)
            .addOptions(modeOption('balanced'), modeOption('strict'), modeOption('disabled')),
        ),
      new LabelBuilder()
        .setLabel(t(lang, 'setup.modal.features'))
        .setDescription(t(lang, 'setup.modal.featuresHint'))
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('setup_features')
            .setPlaceholder(t(lang, 'setup.modal.features.placeholder.menu'))
            .setMinValues(0)
            .setMaxValues(6)
            .setRequired(false)
            .addOptions(
              feature('logs', 'logs'),
              feature('welcome', 'welcome'),
              feature('antiSpam', 'anti-spam'),
              feature('antiRaid', 'anti-raid'),
              feature('antiAlt', 'anti-alt'),
              feature('officialAutomod', 'official-automod'),
            ),
        ),
      new LabelBuilder()
        .setLabel(t(lang, 'setup.modal.prefix'))
        .setDescription(t(lang, 'setup.modal.prefixHint'))
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
  const lang = await languageOf(interaction);
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ ...noticePayload(t(lang, 'setup.noPermission'), COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.customId === SETUP_QUICK_ID) {
    // A modal has to open within three seconds of the click, so a slow database falls back to the defaults.
    const state = await loadSetupState(interaction.guild, { timeoutMs: 1_500 });
    await interaction.showModal(buildSetupModal(interaction.guild, state, lang));
    return true;
  }

  if (interaction.customId === SETUP_REFRESH_ID) {
    await interaction.deferUpdate();
    const state = await loadSetupState(interaction.guild, { fresh: true });
    await interaction.editReply(buildSetupPanel(interaction.guild, state, { lang }));
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
