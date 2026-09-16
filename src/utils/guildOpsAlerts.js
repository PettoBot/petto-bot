const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const config = require('../config');

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
  },
  permissions: {
    severity: 'warning',
    title: 'Petto permissions need attention',
  },
  logs: {
    severity: 'warning',
    title: 'Petto logging configuration needs attention',
  },
  policy: {
    severity: 'critical',
    title: 'Petto server review required',
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

function safeCode(value) {
  return truncate(value, 700).replace(/```/g, '`\u200b``');
}

function severityStyle(severity) {
  if (severity === 'critical') return { key: 'offline', label: 'Critical review', color: 0xfe6465 };
  if (severity === 'info') return { key: 'online', label: 'Information', color: 0xa5ea7a };
  return { key: 'outage', label: 'Action recommended', color: 0xf5c451 };
}

function canSend(channel, me) {
  if (!channel?.isTextBased?.() || !channel.messages || !me) return false;
  const perms = channel.permissionsFor(me);
  return Boolean(perms?.has(PermissionFlagsBits.ViewChannel) && perms?.has(PermissionFlagsBits.SendMessages));
}

function canUseExternalEmojis(channel, me) {
  return Boolean(channel?.permissionsFor(me)?.has(PermissionFlagsBits.UseExternalEmojis));
}

async function resolveGuild(client, guildId) {
  return client.guilds.cache.get(String(guildId))
    ?? await client.guilds.fetch(String(guildId)).catch(() => null);
}

async function resolveOwner(guild) {
  if (typeof guild?.fetchOwner !== 'function') return null;
  return guild.fetchOwner().catch(() => null);
}

async function findNoticeChannel(guild) {
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me) return null;

  const preferred = [guild.systemChannel, guild.rulesChannel, guild.publicUpdatesChannel].filter(Boolean);
  for (const channel of preferred) {
    if (canSend(channel, me)) return channel;
  }

  const cached = [...guild.channels.cache.values()]
    .filter((channel) => canSend(channel, me))
    .sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0));
  if (cached.length) return cached[0];

  const fetched = await guild.channels.fetch().catch(() => null);
  if (!fetched) return null;
  return [...fetched.values()]
    .filter((channel) => canSend(channel, me))
    .sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0))[0] ?? null;
}

function renderNotice({ kind, details, externalEmojis = true }) {
  const template = TEMPLATES[kind] ?? TEMPLATES.diagnostic;
  const style = severityStyle(template.severity);
  const e = externalEmojis ? SPECIAL : FALLBACK;
  const detailBlock = details ? `\n\n${e.visibility} **Details**\n> ${truncate(details, 520).replace(/\n/g, '\n> ')}` : '';

  return [
    `${e.announcement} **${template.title}**`,
    `Need help? <${SUPPORT_URL}>`,
  ].join('\n').slice(0, 1_990);
}

}

async function getTeamChannel(client) {
  if (!DEFAULT_ALERT_CHANNEL_ID) return null;
  const channel = client.channels.cache.get(DEFAULT_ALERT_CHANNEL_ID)
    ?? await client.channels.fetch(DEFAULT_ALERT_CHANNEL_ID).catch(() => null);
  return channel?.isTextBased?.() && channel.messages ? channel : null;
}

async function sendTeamAlert(client, {
  guild,
  kind = 'diagnostic',
  severity = null,
  details = null,
  source = 'Petto diagnostics',
  deliveredChannel = null,
  requestedBy = null,
  force = false,
}) {
  if (!guild) return null;
  const template = TEMPLATES[kind] ?? TEMPLATES.diagnostic;
  const effectiveSeverity = severity ?? template.severity;
  const key = `${guild.id}:${kind}:${truncate(details, 120)}`;
  const now = Date.now();
  if (!force && now - (teamCooldowns.get(key) ?? 0) < TEAM_COOLDOWN_MS) return null;

  const channel = await getTeamChannel(client);
  if (!channel) return null;

  const owner = await resolveOwner(guild);
  const style = severityStyle(effectiveSeverity);
  const embed = new EmbedBuilder()
    .setColor(style.color)
    .setTitle(`${effectiveSeverity === 'critical' ? '🚨' : '⚠️'} Petto guild alert`)
    .setDescription(`**${template.title}**\n${truncate(details || template.body, 1_200)}`)
    .addFields(
      { name: 'Server', value: `${truncate(guild.name, 80)}\n\`${guild.id}\``, inline: true },
      { name: 'Members', value: String(guild.memberCount ?? 'unknown'), inline: true },
      { name: 'Severity', value: `\`${effectiveSeverity}\``, inline: true },
      { name: 'Owner', value: owner ? `<@${owner.id}>\n\`${owner.id}\`` : 'Unavailable', inline: true },
      { name: 'Notice delivery', value: deliveredChannel ? `<#${deliveredChannel.id}>\n\`${deliveredChannel.id}\`` : 'Not delivered', inline: true },
      { name: 'Source', value: `\`${truncate(source, 120)}\``, inline: true },
    )
    .setFooter({ text: requestedBy ? `Requested by ${requestedBy}` : 'Petto automated guild diagnostics' })
    .setTimestamp();

  const mentionOwner = effectiveSeverity === 'critical' && config.ownerId ? `<@${config.ownerId}>` : null;
  const sent = await channel.send({
    content: mentionOwner || undefined,
    embeds: [embed],
    allowedMentions: { users: mentionOwner ? [config.ownerId] : [] },
  }).catch(() => null);

  if (sent) teamCooldowns.set(key, now);
  return sent;
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
  if (!guild) return { ok: false, reason: 'guild_not_found', guild: null, channel: null };

  const template = TEMPLATES[kind] ?? TEMPLATES.diagnostic;
  const cooldownKey = `${guild.id}:${kind}`;
  const now = Date.now();
  if (!force && now - (noticeCooldowns.get(cooldownKey) ?? 0) < NOTICE_COOLDOWN_MS) {
    return { ok: true, skipped: 'cooldown', guild, channel: null };
  }

  const channel = await findNoticeChannel(guild);
  let sent = null;
  if (channel) {
    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    sent = await channel.send({
      content: renderNotice({ kind, details, externalEmojis: canUseExternalEmojis(channel, me) }),
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  if (sent) noticeCooldowns.set(cooldownKey, now);

  const shouldAlertTeam = !sent || (teamAlert ?? template.severity === 'critical');
  if (shouldAlertTeam) {
    await sendTeamAlert(client, {
      guild,
      kind,
      severity: template.severity,
      details: details || (sent ? null : 'Petto could not find a channel where it can deliver the server notice.'),
      source,
      deliveredChannel: sent ? channel : null,
      requestedBy,
      force,
    });
  }

  return { ok: Boolean(sent), guild, channel: sent ? channel : null, message: sent };
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
