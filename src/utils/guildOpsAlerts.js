// Notices Petto sends to a server (its private staff/log channel, or the owner by DM), in the language of that server, and the
// alerts of the Petto team about servers, which stay in English.
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const config = require('../config');
const { getLogConfig } = require('../db/logConfig');
const { t, defaultText, peekGuildLanguage } = require('../i18n');

const SUPPORT_URL = 'https://petto.sbs/support';
const DEFAULT_ALERT_CHANNEL_ID = process.env.PETTO_GUILD_ALERT_CHANNEL_ID || config.opsChannels?.general || config.errorLogChannelId || null;
const NOTICE_COOLDOWN_MS = Math.max(60_000, Number(process.env.PETTO_GUILD_NOTICE_COOLDOWN_MS) || 6 * 60 * 60 * 1000);
const TEAM_COOLDOWN_MS = Math.max(60_000, Number(process.env.PETTO_GUILD_TEAM_ALERT_COOLDOWN_MS) || 30 * 60 * 1000);

const SPECIAL = {
  announcement: '<a:Anouncements_Animated:1385677878259355733>',
  idle: '<:idle:1485744880654487552>',
  online: '<:online:1485744828422819880>',
  outage: '<:outage:1485744863101321467>',
  offline: '<:offline:1485744929958264893>',
  auto: '<:pe_auto:1533211330734194810>',
  visibility: '<:pe_Visibility:1533574204287484145>',
};

const FALLBACK = {
  announcement: '📣',
  idle: '🟡',
  online: '🟢',
  outage: '🟠',
  offline: '🔴',
  auto: '🤖',
  visibility: '👁️',
};

const noticeCooldowns = new Map();
const teamCooldowns = new Map();

// The English of each notice (the team alerts use it as it is); the notice a server gets is drawn from notices.<kind>.* in its
// language.
const template = (kind, severity) => ({
  severity,
  title: t('en', `notices.${kind}.title`),
  body: t('en', `notices.${kind}.body`),
  action: t('en', `notices.${kind}.action`),
});
const TEMPLATES = {
  diagnostic: template('diagnostic', 'warning'),
  permissions: template('permissions', 'warning'),
  logs: template('logs', 'warning'),
  policy: template('policy', 'critical'),
  maintenance: template('maintenance', 'info'),
};

// Details Petto writes itself (the diagnostic classifier, the team review button): shown in the language of the server while
// they are exactly the English text. Any other details come from Discord or the team and are shown as they are.
const DETAIL_KEYS = ['notices.details.logs', 'notices.details.permissions', 'notices.details.teamReview'];
function noticeDetails(details, lang) {
  for (const key of DETAIL_KEYS) {
    const shown = defaultText(lang, details, key);
    if (shown !== details) return shown;
  }
  return details;
}

function truncate(value, max = 700) {
  const text = String(value ?? '').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function severityStyle(severity, lang = 'en') {
  if (severity === 'critical') return { key: 'offline', label: t(lang, 'notices.severity.critical'), color: 0xfe6465 };
  if (severity === 'info') return { key: 'online', label: t(lang, 'notices.severity.info'), color: 0xa5ea7a };
  return { key: 'outage', label: t(lang, 'notices.severity.warning'), color: 0xf5c451 };
}

function canSend(channel, me) {
  if (!channel?.isTextBased?.() || !channel.messages || !me) return false;
  if (channel.isThread?.()) return false;
  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) return false;
  const perms = channel.permissionsFor(me);
  return Boolean(perms?.has(PermissionFlagsBits.ViewChannel) && perms?.has(PermissionFlagsBits.SendMessages));
}

function canUseExternalEmojis(channel, me) {
  return Boolean(channel?.permissionsFor(me)?.has(PermissionFlagsBits.UseExternalEmojis));
}

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHiddenFromEveryone(channel, guild) {
  const everyone = guild?.roles?.everyone;
  if (!everyone) return false;
  const perms = channel.permissionsFor(everyone);
  return Boolean(perms && !perms.has(PermissionFlagsBits.ViewChannel));
}

function staffChannelScore(channel, configuredIds) {
  const name = normalizeName(channel.name);
  const parentName = normalizeName(channel.parent?.name);
  const staffPattern = /\b(?:staff|team|equipo|equipe|admin|admins|mod|mods|moderation|moderacion|moderacao|logs?|audit|auditoria|security|seguridad|seguranca|management|gestion|gestao|petto|bot config|bot logs?)\b/i;

  let score = 0;
  if (configuredIds.has(channel.id)) score += 100;
  if (staffPattern.test(name)) score += 50;
  if (staffPattern.test(parentName)) score += 20;
  return score;
}

async function resolveGuild(client, guildId) {
  return client.guilds.cache.get(String(guildId))
    ?? await client.guilds.fetch(String(guildId)).catch(() => null);
}

async function resolveOwner(guild) {
  if (typeof guild?.fetchOwner !== 'function') return null;
  return guild.fetchOwner().catch(() => null);
}

async function configuredLogChannelIds(guildId) {
  const logConfig = await getLogConfig(guildId).catch(() => null);
  if (!logConfig) return new Set();
  return new Set([
    ...(logConfig.entries || []).map((entry) => String(entry.channel_id)),
    ...(logConfig.webhooks || []).map((entry) => String(entry.channel_id)),
  ]);
}

async function findPrivateNoticeChannel(guild) {
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me) return null;

  const configuredIds = await configuredLogChannelIds(guild.id);
  const scoreCandidates = (channels) => [...channels]
    .filter((channel) => canSend(channel, me) && isHiddenFromEveryone(channel, guild))
    .map((channel) => ({ channel, score: staffChannelScore(channel, configuredIds) }))
    // Do not drop notices into arbitrary private tickets or personal channels.
    // Require either a configured log target or a channel/category that looks staff-facing.
    .filter((entry) => entry.score >= 20)
    .sort((a, b) => b.score - a.score || (a.channel.rawPosition ?? a.channel.position ?? 0) - (b.channel.rawPosition ?? b.channel.position ?? 0));

  const cached = scoreCandidates(guild.channels.cache.values());
  if (cached.length) return cached[0].channel;

  const fetched = await guild.channels.fetch().catch(() => null);
  if (!fetched) return null;
  return scoreCandidates(fetched.values())[0]?.channel ?? null;
}

/** The notice a server gets, in `lang` (the language of that server). */
function renderNotice({ kind, details, externalEmojis = true, lang = 'en' }) {
  const noticeKind = TEMPLATES[kind] ? kind : 'diagnostic';
  const style = severityStyle(TEMPLATES[noticeKind].severity, lang);
  const e = externalEmojis ? SPECIAL : FALLBACK;
  const detailBlock = details
    ? `\n\n${t(lang, 'notices.detailsHeading', { emoji: e.visibility })}\n> ${truncate(noticeDetails(details, lang), 520).replace(/\n/g, '\n> ')}`
    : '';

  return [
    `${e.announcement} **${t(lang, `notices.${noticeKind}.title`)}**`,
    `${e[style.key]} **${style.label}**`,
    '',
    t(lang, `notices.${noticeKind}.body`) + detailBlock,
    '',
    t(lang, 'notices.recommendedAction', { emoji: e.auto }),
    t(lang, `notices.${noticeKind}.action`),
    '',
    t(lang, 'notices.footer'),
    t(lang, 'notices.help', { url: `<${SUPPORT_URL}>` }),
  ].join('\n').slice(0, 1_990);
}

// The buttons of a team alert, for the Petto team only.
function teamActionRow(guildId, kind, severity) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gops_notice:${kind}:${guildId}`)
      .setLabel('Send review notice') // i18n-ignore: team channel
      .setStyle(ButtonStyle.Primary),
  );

  if (severity === 'critical') {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`gops_leave_prepare:${guildId}`)
        .setLabel('Leave server') // i18n-ignore: team channel
        .setStyle(ButtonStyle.Danger),
    );
  }

  return row;
}

async function getTeamChannel(client) {
  if (!DEFAULT_ALERT_CHANNEL_ID) return null;
  const channel = client.channels.cache.get(DEFAULT_ALERT_CHANNEL_ID)
    ?? await client.channels.fetch(DEFAULT_ALERT_CHANNEL_ID).catch(() => null);
  return channel?.isTextBased?.() && channel.messages ? channel : null;
}

function describeDelivery({ deliveredChannel = null, deliveryType = null, deliveredRecipientId = null }) {
  if (deliveryType === 'private_channel' && deliveredChannel) {
    return `<#${deliveredChannel.id}>\n\`${deliveredChannel.id}\``;
  }
  if (deliveryType === 'owner_dm' && deliveredRecipientId) {
    return `Owner DM <@${deliveredRecipientId}>\n\`${deliveredRecipientId}\``;
  }
  return 'Not delivered'; // i18n-ignore: team channel
}

/** The alert in the Petto team's own channel, in English (the team reads it). */
async function sendTeamAlert(client, {
  guild,
  kind = 'diagnostic',
  severity = null,
  details = null,
  source = 'Petto diagnostics', // i18n-ignore: internal source label, never shown to a server
  deliveredChannel = null,
  deliveryType = null,
  deliveredRecipientId = null,
  requestedBy = null,
  force = false,
}) {
  if (!guild) return null;
  const template = TEMPLATES[kind] ?? TEMPLATES.diagnostic;
  const effectiveSeverity = severity ?? template.severity;
  const key = `${guild.id}:${kind}:${effectiveSeverity}`;
  const now = Date.now();
  if (!force && now - (teamCooldowns.get(key) ?? 0) < TEAM_COOLDOWN_MS) return null;

  const channel = await getTeamChannel(client);
  if (!channel) return null;

  const owner = await resolveOwner(guild);
  const style = severityStyle(effectiveSeverity);
  const embed = new EmbedBuilder()
    .setColor(style.color)
    .setTitle('Petto guild alert') // i18n-ignore: team channel
    .setDescription([
      `${SPECIAL.announcement} **${template.title}**`,
      `${SPECIAL[style.key]} **${style.label}**`,
      '',
      truncate(details || template.body, 1_200),
    ].join('\n'))
    .addFields(
      { name: 'Server', value: `${truncate(guild.name, 80)}\n\`${guild.id}\``, inline: true }, // i18n-ignore: team channel
      { name: 'Members', value: String(guild.memberCount ?? 'unknown'), inline: true }, // i18n-ignore: team channel
      { name: 'Severity', value: `\`${effectiveSeverity}\``, inline: true }, // i18n-ignore: team channel
      { name: 'Owner', value: owner ? `<@${owner.id}>\n\`${owner.id}\`` : 'Unavailable', inline: true }, // i18n-ignore: team channel
      { name: 'Notice delivery', value: describeDelivery({ deliveredChannel, deliveryType, deliveredRecipientId }), inline: true }, // i18n-ignore: team channel
      { name: 'Source', value: `\`${truncate(source, 120)}\``, inline: true }, // i18n-ignore: team channel
    )
    .setFooter({ text: requestedBy ? `Requested by ${requestedBy}` : 'Petto automated guild diagnostics' }) // i18n-ignore: team channel
    .setTimestamp();

  const mentionOwner = effectiveSeverity === 'critical' && config.ownerId ? `<@${config.ownerId}>` : null;
  const sent = await channel.send({
    content: mentionOwner || undefined,
    embeds: [embed],
    components: [teamActionRow(guild.id, kind, effectiveSeverity)],
    allowedMentions: { users: mentionOwner ? [config.ownerId] : [] },
  }).catch(() => null);

  if (sent) teamCooldowns.set(key, now);
  return sent;
}

async function sendOwnerDm(guild, content) {
  const owner = await resolveOwner(guild);
  if (!owner) return null;
  const message = await owner.send({
    content,
    allowedMentions: { parse: [] },
  }).catch(() => null);
  if (!message) return null;
  return { message, ownerId: owner.id };
}

async function sendGuildNotice(client, {
  guildId,
  kind = 'diagnostic',
  details = null,
  source = 'Petto diagnostics', // i18n-ignore: internal source label, never shown to a server
  requestedBy = null,
  force = false,
  teamAlert = null,
}) {
  const guild = await resolveGuild(client, guildId);
  if (!guild) return { ok: false, reason: 'guild_not_found', guild: null, channel: null, deliveryType: null };

  const template = TEMPLATES[kind] ?? TEMPLATES.diagnostic;
  const cooldownKey = `${guild.id}:${kind}`;
  const now = Date.now();
  if (!force && now - (noticeCooldowns.get(cooldownKey) ?? 0) < NOTICE_COOLDOWN_MS) {
    return { ok: true, skipped: 'cooldown', guild, channel: null, deliveryType: 'cooldown' };
  }

  const lang = peekGuildLanguage(guild.id);
  const channel = await findPrivateNoticeChannel(guild);
  let sent = null;
  let deliveryType = null;
  let recipientId = null;

  if (channel) {
    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    sent = await channel.send({
      content: renderNotice({ kind, details, externalEmojis: canUseExternalEmojis(channel, me), lang }),
      allowedMentions: { parse: [] },
    }).catch(() => null);
    if (sent) deliveryType = 'private_channel';
  }

  // Never fall back to a random public channel. If no suitable staff/log channel is
  // private and writable, try the guild owner's DMs. If DMs are closed, the team
  // alert remains the final fallback.
  if (!sent) {
    // In DMs there is no guild permission gate for external emoji usage. Use Petto's
    // branded emoji IDs here too so owner notices keep the same visual language as
    // private guild notices. Discord will render them when the bot has access to them.
    const dm = await sendOwnerDm(guild, renderNotice({ kind, details, externalEmojis: true, lang }));
    if (dm) {
      sent = dm.message;
      deliveryType = 'owner_dm';
      recipientId = dm.ownerId;
    }
  }

  if (sent) noticeCooldowns.set(cooldownKey, now);

  const shouldAlertTeam = !sent || (teamAlert ?? template.severity === 'critical');
  if (shouldAlertTeam) {
    await sendTeamAlert(client, {
      guild,
      kind,
      severity: template.severity,
      details: details || (sent ? null : 'Petto could not find a safe private delivery route. No public channel was used.'), // i18n-ignore: team channel
      source,
      deliveredChannel: deliveryType === 'private_channel' ? channel : null,
      deliveryType,
      deliveredRecipientId: recipientId,
      requestedBy,
      force,
    });
  }

  return {
    ok: Boolean(sent),
    guild,
    channel: deliveryType === 'private_channel' ? channel : null,
    message: sent,
    deliveryType,
    recipientId,
  };
}

function compactLogText(args) {
  return args.map((value) => {
    if (value instanceof Error) return value.message;
    if (value && typeof value === 'object') return value.message || JSON.stringify(value);
    return String(value ?? '');
  }).join(' ').trim();
}

function classifyDiagnostic(text) {
  const lower = String(text).toLowerCase();

  if (lower.includes('[logengine] no webhook found for configured log')
      || lower.includes('no webhook found for configured log')
      || lower.includes('unknown webhook')
      || lower.includes('configured log webhook')) {
    return {
      kind: 'logs',
      details: t('en', 'notices.details.logs'),
      teamAlert: false,
    };
  }

  if (lower.includes('missing permissions')
      || lower.includes('missing permission')
      || lower.includes('insufficient permissions')
      || lower.includes('missing access')
      || /(?:code|discordapierror)\D*50013/.test(lower)
      || /(?:code|discordapierror)\D*50001/.test(lower)) {
    return {
      kind: 'permissions',
      details: t('en', 'notices.details.permissions'),
      teamAlert: false,
    };
  }

  return null;
}

function createGuildDiagnosticSink(client) {
  return async (level, args, _stamp, context = {}) => {
    if (level !== 'error' && level !== 'warn') return;
    const guildId = context.guildId ?? context.serverId;
    if (!guildId) return;

    const classified = classifyDiagnostic(compactLogText(args));
    if (!classified) return;

    await sendGuildNotice(client, {
      guildId,
      kind: classified.kind,
      details: classified.details,
      source: context.command ?? context.source ?? 'runtime diagnostic', // i18n-ignore: internal source label, never shown to a server
      teamAlert: classified.teamAlert,
    }).catch(() => {});
  };
}

async function reportGuildIncident(client, options) {
  const kind = TEMPLATES[options.kind] ? options.kind : 'diagnostic';
  return sendGuildNotice(client, { ...options, kind, teamAlert: options.teamAlert ?? TEMPLATES[kind].severity === 'critical' });
}

module.exports = {
  TEMPLATES,
  renderNotice,
  createGuildDiagnosticSink,
  reportGuildIncident,
  sendGuildNotice,
  sendTeamAlert,
};
