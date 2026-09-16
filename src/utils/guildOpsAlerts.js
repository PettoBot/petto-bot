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

const TEMPLATES = {
  diagnostic: {
    severity: 'warning',
    title: 'Petto diagnostic notice',
    body: 'Petto detected a configuration issue that may affect one or more features on this server.',
    action: 'Review the affected feature and Petto\'s permissions. If the issue continues, contact the Petto team.',
  },
  permissions: {
    severity: 'warning',
    title: 'Petto permissions need attention',
    body: 'Petto detected missing or insufficient permissions. Some features may be unavailable until access is restored.',
    action: 'Restore **View Channel**, **Send Messages**, **Embed Links**, and **Read Message History** where needed. Logging features may also require **Manage Webhooks** in the configured log channel.',
  },
  logs: {
    severity: 'warning',
    title: 'Petto logging configuration needs attention',
    body: 'A configured log destination or webhook is missing, inaccessible, or no longer valid.',
    action: 'Check the log channel and its permissions. Reconfigure logging if the webhook was deleted or replaced.',
  },
  policy: {
    severity: 'critical',
    title: 'Petto server review required',
    body: 'Petto detected a high-severity signal that requires manual review. This automated notice is **not** a final determination that a violation occurred.',
    action: 'Review the affected activity and Discord\'s applicable rules. Contact the Petto team if you believe the alert is incorrect.',
  },
  shop: {
    severity: 'critical',
    title: 'Petto commerce review required',
    body: 'Petto detected multiple independent signals associated with a commerce workflow that requires review. This automated notice is **not** a final policy determination.',
    action: 'Review the affected activity and verify that the server and its workflows follow Discord rules and Petto\'s supported-use requirements.',
  },
  maintenance: {
    severity: 'info',
    title: 'Petto service notice',
    body: 'Petto detected a service or configuration condition that may temporarily affect features on this server.',
    action: 'No immediate action may be necessary. If features remain unavailable after the notice clears, contact the Petto team.',
  },
};

function truncate(value, max = 700) {
  const text = String(value ?? '').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function severityStyle(severity) {
  if (severity === 'critical') return { key: 'offline', label: 'Critical review', color: 0xfe6465 };
  if (severity === 'info') return { key: 'online', label: 'Information', color: 0xa5ea7a };
  return { key: 'outage', label: 'Action recommended', color: 0xf5c451 };
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

function renderNotice({ kind, details, externalEmojis = true }) {
  const template = TEMPLATES[kind] ?? TEMPLATES.diagnostic;
  const style = severityStyle(template.severity);
  const e = externalEmojis ? SPECIAL : FALLBACK;
  const detailBlock = details ? `\n\n${e.visibility} **Details**\n> ${truncate(details, 520).replace(/\n/g, '\n> ')}` : '';

  return [
    `${e.announcement} **${template.title}**`,
    `${e[style.key]} **${style.label}**`,
    '',
    template.body + detailBlock,
    '',
    `${e.auto} **Recommended action**`,
    template.action,
    '',
    '**Automated notice** • Petto Diagnostics',
    `Need help? <${SUPPORT_URL}>`,
  ].join('\n').slice(0, 1_990);
}

function teamActionRow(guildId, kind, severity) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gops_notice:${kind}:${guildId}`)
      .setLabel('Send review notice')
      .setStyle(ButtonStyle.Primary),
  );

  if (severity === 'critical') {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`gops_leave_prepare:${guildId}`)
        .setLabel('Leave server')
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
  return 'Not delivered';
}

async function sendTeamAlert(client, {
  guild,
  kind = 'diagnostic',
  severity = null,
  details = null,
  source = 'Petto diagnostics',
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
    .setTitle('Petto guild alert')
    .setDescription([
      `${SPECIAL.announcement} **${template.title}**`,
      `${SPECIAL[style.key]} **${style.label}**`,
      '',
      truncate(details || template.body, 1_200),
    ].join('\n'))
    .addFields(
      { name: 'Server', value: `${truncate(guild.name, 80)}\n\`${guild.id}\``, inline: true },
      { name: 'Members', value: String(guild.memberCount ?? 'unknown'), inline: true },
      { name: 'Severity', value: `\`${effectiveSeverity}\``, inline: true },
      { name: 'Owner', value: owner ? `<@${owner.id}>\n\`${owner.id}\`` : 'Unavailable', inline: true },
      { name: 'Notice delivery', value: describeDelivery({ deliveredChannel, deliveryType, deliveredRecipientId }), inline: true },
      { name: 'Source', value: `\`${truncate(source, 120)}\``, inline: true },
    )
    .setFooter({ text: requestedBy ? `Requested by ${requestedBy}` : 'Petto automated guild diagnostics' })
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
  source = 'Petto diagnostics',
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

  const channel = await findPrivateNoticeChannel(guild);
  let sent = null;
  let deliveryType = null;
  let recipientId = null;

  if (channel) {
    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    sent = await channel.send({
      content: renderNotice({ kind, details, externalEmojis: canUseExternalEmojis(channel, me) }),
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
    const dm = await sendOwnerDm(guild, renderNotice({ kind, details, externalEmojis: true }));
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
      details: details || (sent ? null : 'Petto could not find a safe private delivery route. No public channel was used.'),
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

  if (/\[(?:guildpolicy|discordcompliance|shopdetector)\]/i.test(text) || /explicit policy violation signal/i.test(text)) {
    return { kind: lower.includes('shop') ? 'shop' : 'policy', details: truncate(text, 650), teamAlert: true };
  }

  if (lower.includes('[logengine] no webhook found for configured log')
      || lower.includes('no webhook found for configured log')
      || lower.includes('unknown webhook')
      || lower.includes('configured log webhook')) {
    return {
      kind: 'logs',
      details: '`[logEngine]` could not use the configured logging webhook. The webhook may have been deleted, moved, or become inaccessible.',
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
      details: 'Petto received a Discord permissions/access error while trying to use a configured feature.',
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
      source: context.command ?? context.source ?? 'runtime diagnostic',
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
  createGuildDiagnosticSink,
  reportGuildIncident,
  sendGuildNotice,
  sendTeamAlert,
};
