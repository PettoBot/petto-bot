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
const { t, languageOf, currentLanguage } = require('../i18n');

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
  notify_on_claim: false,
  auto_thread: false,
  cooldown_seconds: 60,
  daily_limit: 10,
};

// button key -> column
const TOGGLES = {
  enabled: { column: 'enabled' },
  anonymous: { column: 'anonymous_reporting_enabled' },
  reason: { column: 'require_reason' },
  notify: { column: 'notify_reporter' },
  thread: { column: 'auto_thread' },
  claim: { column: 'notify_on_claim' },
};

const CHANNEL_NEEDS = [
  ['ViewChannel', PermissionFlagsBits.ViewChannel],
  ['SendMessages', PermissionFlagsBits.SendMessages],
  ['EmbedLinks', PermissionFlagsBits.EmbedLinks],
];

function onOff(value, lang = currentLanguage()) {
  return t(lang, value ? 'reports.config.on' : 'reports.config.off');
}

/** The name of a permission in `lang` (the shared names have no Create Public Threads). */
function permissionName(flag, lang) {
  return flag === 'CreatePublicThreads' ? t(lang, 'reports.config.permCreatePublicThreads') : t(lang, `core.perm.${flag}`);
}

/** The names of the permissions Petto lacks, joined with commas, in `lang`. */
function permissionNames(flags, lang) {
  return flags.map((flag) => permissionName(flag, lang)).join(', ');
}

/**
 * What Petto still lacks in the report channel; empty when everything needed is there. Each problem is a permission flag
 * name (`ViewChannel`), or `gone` when the channel no longer exists.
 */
function channelProblemFlags(guild, config) {
  if (!config.channel_id) return [];
  const channel = guild.channels.cache.get(config.channel_id);
  if (!channel) return ['gone'];
  const me = guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!permissions) return [];
  const missing = CHANNEL_NEEDS.filter(([, flag]) => !permissions.has(flag)).map(([name]) => name);
  if (config.auto_thread && !permissions.has(PermissionFlagsBits.CreatePublicThreads)) missing.push('CreatePublicThreads');
  return missing;
}

/** The problems of the report channel as words people read, in `lang`. */
function channelProblems(guild, config, lang = currentLanguage()) {
  return channelProblemFlags(guild, config).map((flag) => (flag === 'gone' ? t(lang, 'reports.config.channelGoneProblem') : permissionName(flag, lang)));
}

function buildConfigPanel(guild, stored, { notice = null, lang = currentLanguage() } = {}) {
  const config = { ...DEFAULTS, ...(stored ?? {}) };
  const problems = channelProblems(guild, config, lang);
  const ready = config.enabled && config.channel_id && !problems.length;

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`${CONFIG_PREFIX}channel`)
    .setPlaceholder(t(lang, 'reports.config.channel.menu'))
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
    const { column } = TOGGLES[key];
    return new ButtonBuilder()
      .setCustomId(`${CONFIG_PREFIX}toggle:${key}`)
      .setLabel(t(lang, `reports.config.toggle.${key}.button`, { state: onOff(config[column], lang) }))
      .setStyle(config[column] ? ButtonStyle.Success : ButtonStyle.Secondary);
  };

  const rows = [
    new ActionRowBuilder().addComponents(channelSelect),
    new ActionRowBuilder().addComponents(roleSelect('urgent', t(lang, 'reports.config.urgentRole.menu'), config.urgent_role_id)),
    new ActionRowBuilder().addComponents(roleSelect('ping', t(lang, 'reports.config.pingRole.menu'), config.ping_role_id)),
    new ActionRowBuilder().addComponents(toggle('enabled'), toggle('anonymous'), toggle('reason'), toggle('notify'), toggle('thread')),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${CONFIG_PREFIX}limits`).setLabel(t(lang, 'reports.config.limits.button')).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${CONFIG_PREFIX}test`).setLabel(t(lang, 'reports.config.test.button')).setStyle(ButtonStyle.Secondary),
      toggle('claim'),
    ),
  ];

  const status = !config.channel_id
    ? t(lang, 'reports.config.status.noChannel', { emoji: EMOJI.WARNING })
    : problems.length
      ? t(lang, 'reports.config.status.missing', { emoji: EMOJI.WARNING, missing: problems.join(', '), channel: `<#${config.channel_id}>` })
      : config.enabled
        ? t(lang, 'reports.config.status.on', { emoji: EMOJI.APPROVE, channel: `<#${config.channel_id}>` })
        : t(lang, 'reports.config.status.off', { emoji: EMOJI.RELEASE_MINUS, button: t(lang, 'reports.config.toggle.enabled.button', { state: onOff(false, lang) }) });
  const none = t(lang, 'reports.config.none');

  return infoPayload({
    accent: ready ? COLORS.GREEN : problems.length ? COLORS.YELLOW : 0xfe6465,
    title: t(lang, 'reports.config.title', { emoji: EMOJI.REPORT }),
    thumbnail: guild.iconURL({ size: 256 }),
    subtitle: [guild.name, status, notice],
    sections: [
      {
        title: t(lang, 'reports.config.delivery'),
        lines: [
          t(lang, 'reports.config.channelLine', { channel: config.channel_id ? `<#${config.channel_id}>` : t(lang, 'reports.config.notSet') }),
          t(lang, 'reports.config.urgentLine', { role: config.urgent_role_id ? `<@&${config.urgent_role_id}>` : none }),
          t(lang, 'reports.config.pingLine', { role: config.ping_role_id ? `<@&${config.ping_role_id}>` : none }),
          t(lang, 'reports.config.threadLine', { state: onOff(config.auto_thread, lang) }),
        ],
      },
      {
        title: t(lang, 'reports.config.rules'),
        lines: [
          t(lang, 'reports.config.anonymousLine', { state: onOff(config.anonymous_reporting_enabled, lang) }),
          t(lang, 'reports.config.reasonLine', { state: onOff(config.require_reason, lang) }),
          t(lang, 'reports.config.notifyLine', { state: onOff(config.notify_reporter, lang) }),
          t(lang, 'reports.config.claimLine', { state: onOff(config.notify_on_claim, lang) }),
          config.cooldown_seconds ? t(lang, 'reports.config.cooldownLine', { time: formatDuration(config.cooldown_seconds * 1000, lang) }) : t(lang, 'reports.config.cooldownNone'),
          config.daily_limit ? t(lang, 'reports.config.dailyLine', { count: config.daily_limit }) : t(lang, 'reports.config.dailyNone'),
        ],
      },
    ],
    footer: t(lang, 'reports.config.footer'),
    rows,
  });
}

function limitsModal(config, lang = currentLanguage()) {
  const merged = { ...DEFAULTS, ...(config ?? {}) };
  const numberInput = (customId, value) => new TextInputBuilder().setCustomId(customId).setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(5).setValue(String(value)).setRequired(true);
  return new ModalBuilder()
    .setCustomId(LIMITS_MODAL_ID)
    .setTitle(t(lang, 'reports.limits.title'))
    .addLabelComponents(
      new LabelBuilder().setLabel(t(lang, 'reports.limits.cooldownLabel')).setDescription(t(lang, 'reports.limits.cooldownHelp')).setTextInputComponent(numberInput('cooldown', merged.cooldown_seconds)),
      new LabelBuilder().setLabel(t(lang, 'reports.limits.dailyLabel')).setDescription(t(lang, 'reports.limits.dailyHelp')).setTextInputComponent(numberInput('daily', merged.daily_limit)),
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
async function sendTestReport(interaction, config, lang) {
  if (!config.channel_id) return ephemeral(t(lang, 'reports.config.pickChannelFirst'));
  const channel = await interaction.guild.channels.fetch(config.channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) return ephemeral(t(lang, 'reports.config.channelGone'));
  const problems = channelProblems(interaction.guild, config, lang);
  if (problems.length) return ephemeral(t(lang, 'reports.config.missing', { missing: problems.join(', '), channel: `<#${channel.id}>` }));

  const sample = buildReportCard({
    report_number: 0,
    reporter_id: interaction.user.id,
    reported_user_id: interaction.client.user.id,
    category: 'other',
    reason: t(lang, 'reports.config.testReason', { user: interaction.user.username }),
    source_channel_id: interaction.channelId,
    anonymous: false,
    urgent: false,
    status: 'open',
    image_urls: [],
    created_at: new Date().toISOString(),
  }, { withActions: false, lang });

  try {
    await channel.send({ components: [sample], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
  } catch (err) {
    logger.warn(`Test report failed in guild ${interaction.guild.id}: ${err.message}`);
    return ephemeral(t(lang, 'reports.config.testFailed', { channel: `<#${channel.id}>`, error: err.message }));
  }
  return ephemeral(t(lang, 'reports.config.testSent', { emoji: EMOJI.APPROVE, channel: `<#${channel.id}>` }), COLORS.GREEN);
}

async function saveAndShow(interaction, patch, options = {}) {
  const saved = await upsertConfig(interaction.guild.id, patch);
  await interaction.update(buildConfigPanel(interaction.guild, saved, options));
}

/** Buttons and selects of the report settings panel. */
async function handleConfigComponent(interaction) {
  const lang = await languageOf(interaction);
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply(ephemeral(t(lang, 'reports.command.needsManageServer')));
    return true;
  }

  await ensureGuild(interaction.guild.id);
  const config = { ...DEFAULTS, ...((await getConfig(interaction.guild.id).catch(() => null)) ?? {}) };
  const action = interaction.customId.slice(CONFIG_PREFIX.length);

  if (action === 'channel') {
    const channel = interaction.channels?.first?.() ?? null;
    if (!channel) {
      await interaction.reply(ephemeral(t(lang, 'reports.config.chooseChannel')));
      return true;
    }
    const me = interaction.guild.members.me;
    const permissions = me ? channel.permissionsFor(me) : null;
    const missing = permissions ? CHANNEL_NEEDS.filter(([, flag]) => !permissions.has(flag)).map(([name]) => name) : [];
    if (missing.length) {
      await interaction.reply(ephemeral(t(lang, 'reports.config.needsInChannel', { missing: permissionNames(missing, lang), channel: `<#${channel.id}>` })));
      return true;
    }
    await saveAndShow(interaction, { channel_id: channel.id }, { lang });
    return true;
  }

  if (action === 'urgent' || action === 'ping') {
    const role = interaction.roles?.first?.() ?? null;
    if (role?.id === interaction.guild.id) {
      await interaction.reply(ephemeral(t(lang, 'reports.config.everyoneHere')));
      return true;
    }
    await saveAndShow(interaction, { [action === 'urgent' ? 'urgent_role_id' : 'ping_role_id']: role?.id ?? null }, { lang });
    return true;
  }

  if (action.startsWith('toggle:')) {
    const toggle = TOGGLES[action.slice('toggle:'.length)];
    if (!toggle) return false;
    if (toggle.column === 'enabled' && !config.enabled && !config.channel_id) {
      await interaction.reply(ephemeral(t(lang, 'reports.config.channelBeforeOn')));
      return true;
    }
    await saveAndShow(interaction, { [toggle.column]: !config[toggle.column] }, { lang });
    return true;
  }

  if (action === 'limits') {
    await interaction.showModal(limitsModal(config, lang));
    return true;
  }

  if (action === 'test') {
    await interaction.reply(await sendTestReport(interaction, config, lang));
    return true;
  }

  return false;
}

/** The limits form. It was opened from the panel, so it updates the panel in place. */
async function handleLimitsModal(interaction) {
  const lang = await languageOf(interaction);
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply(ephemeral(t(lang, 'reports.command.needsManageServer')));
    return;
  }

  const cooldown = parseLimit(interaction.fields.getTextInputValue('cooldown'), 86_400);
  const daily = parseLimit(interaction.fields.getTextInputValue('daily'), 100);
  if (cooldown === null || daily === null) {
    await interaction.reply(ephemeral(t(lang, 'reports.limits.invalid')));
    return;
  }

  await ensureGuild(interaction.guild.id);
  const saved = await upsertConfig(interaction.guild.id, { cooldown_seconds: cooldown, daily_limit: daily });
  const panel = buildConfigPanel(interaction.guild, saved, { lang });
  if (interaction.isFromMessage?.()) await interaction.update(panel);
  else await interaction.reply({ ...panel, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

module.exports = { CONFIG_PREFIX, LIMITS_MODAL_ID, buildConfigPanel, handleConfigComponent, handleLimitsModal, channelProblems };
