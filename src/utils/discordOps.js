const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const logger = require('./logger');

const STATUS_MARKER = 'Petto operational status';
const STATUS_INTERVAL_MS = 60_000;
const statusMessages = new Map();
let loggerAttached = false;

function channelIdFor(kind) {
  return config.opsChannels?.[kind] ?? null;
}

async function getTextChannel(client, channelId) {
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased?.() && channel.messages ? channel : null;
}

async function sendToChannel(client, channelId, payload) {
  const channel = await getTextChannel(client, channelId);
  if (!channel) return null;
  return channel.send(payload).catch(() => null);
}

function safeText(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function redact(text) {
  return String(text)
    .replace(/(token|secret|password|authorization|api[_-]?key)\s*[:=]\s*[^\s,}]+/gi, '$1=[redacted]')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://[redacted]')
    .slice(0, 1800);
}

function lifecycleEmbed({ kind, guild, ownerId, inviter, inviteUrl }) {
  const joined = kind === 'join';
  const fields = [
    { name: 'Server', value: `${guild.name}\n\`${guild.id}\``, inline: true },
    { name: 'Members', value: String(guild.memberCount ?? 'unknown'), inline: true },
  ];

  if (ownerId) fields.push({ name: 'Owner', value: `<@${ownerId}>\n\`${ownerId}\``, inline: true });
  if (inviter) fields.push({ name: 'Added by', value: `<@${inviter.id}>\n\`${inviter.id}\``, inline: true });
  if (inviteUrl) fields.push({ name: 'Invite', value: inviteUrl, inline: false });
  if (!joined) fields.push({ name: 'Note', value: 'Discord does not expose whether Petto left voluntarily or was removed.', inline: false });

  const embed = new EmbedBuilder()
    .setColor(joined ? 0xa5ea7a : 0xfe6465)
    .setTitle(joined ? 'Petto joined a server' : 'Petto left a server')
    .setDescription(joined ? 'A new server added Petto.' : 'Petto is no longer in this server.')
    .addFields(fields)
    .setTimestamp();
  const icon = guild.iconURL?.({ extension: 'png', size: 128 });
  if (icon) embed.setThumbnail(icon);
  return embed;
}

async function sendGuildLifecycleLog(client, options) {
  const embed = lifecycleEmbed(options);
  const specific = options.kind === 'join' ? channelIdFor('joinLog') : channelIdFor('leaves');
  const ids = [...new Set([specific, channelIdFor('general')].filter(Boolean))];
  await Promise.all(ids.map((id) => sendToChannel(client, id, { embeds: [embed] })));
}

function guildCount(client) {
  return client.guilds.cache.size;
}

function memberCount(client) {
  return [...client.guilds.cache.values()].reduce((total, guild) => total + (guild.memberCount || 0), 0);
}

function publicStatusEmbed(client) {
  return new EmbedBuilder()
    .setColor(0xa5ea7a)
    .setTitle('Petto status')
    .setDescription('Petto is online and serving Discord communities.')
    .addFields(
      { name: 'Status', value: 'Online', inline: true },
      { name: 'Servers', value: String(guildCount(client)), inline: true },
      { name: 'Members', value: String(memberCount(client)), inline: true },
      { name: 'Latency', value: `${Math.max(0, Math.round(client.ws.ping))} ms`, inline: true },
      { name: 'Uptime', value: `<t:${Math.floor((Date.now() - process.uptime() * 1000) / 1000)}:R>`, inline: true },
    )
    .setFooter({ text: STATUS_MARKER })
    .setTimestamp();
}

function internalStatusEmbed(client) {
  const memory = process.memoryUsage();
  const shards = [...client.ws.shards.values()].map((shard) => `Shard ${shard.id}: ${shard.status} · ${Math.round(shard.ping)} ms`);
  return new EmbedBuilder()
    .setColor(0x8799ff)
    .setTitle('Petto internal status')
    .setDescription('Operational snapshot for developers and owners.')
    .addFields(
      { name: 'Process', value: `Node ${process.version}\nPID ${process.pid}\nUptime ${Math.floor(process.uptime())}s`, inline: true },
      { name: 'Runtime', value: `${(memory.rss / 1024 / 1024).toFixed(1)} MB RSS\nHeap ${(memory.heapUsed / 1024 / 1024).toFixed(1)} MB`, inline: true },
      { name: 'Discord', value: `${guildCount(client)} servers\n${memberCount(client)} cached members`, inline: true },
      { name: 'Shards', value: shards.join('\n').slice(0, 1024) || 'No shard data', inline: false },
    )
    .setFooter({ text: STATUS_MARKER })
    .setTimestamp();
}

async function upsertStatusMessage(client, kind, embed) {
  const channelId = channelIdFor(kind);
  const channel = await getTextChannel(client, channelId);
  if (!channel) return;

  const key = `${kind}:${channelId}`;
  let message = statusMessages.get(key) || null;
  if (!message) {
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    message = recent?.find((candidate) => candidate.author?.id === client.user?.id && candidate.embeds?.some((item) => item.footer?.text === STATUS_MARKER)) || null;
  }

  if (message) {
    const edited = await message.edit({ embeds: [embed] }).catch(() => null);
    if (edited) {
      statusMessages.set(key, edited);
      return;
    }
  }

  const sent = await channel.send({ embeds: [embed] }).catch(() => null);
  if (sent) statusMessages.set(key, sent);
}

async function reportDiscordStatus(client) {
  if (!client.user) return;
  await Promise.all([
    upsertStatusMessage(client, 'publicStatus', publicStatusEmbed(client)),
    upsertStatusMessage(client, 'internalStatus', internalStatusEmbed(client)),
  ]);
}

function startDiscordStatusJob(client) {
  reportDiscordStatus(client).catch(() => {});
  const timer = setInterval(() => reportDiscordStatus(client).catch(() => {}), STATUS_INTERVAL_MS);
  timer.unref?.();
}

function attachDiscordLogger(client) {
  if (loggerAttached) return;
  loggerAttached = true;
  logger.setDiscordSink((level, args, stamp) => {
    // Status heartbeats are persisted in Supabase every ten seconds; forwarding those
    // routine success messages would drown the operational channel.
    const text = redact(args.map(safeText).join(' '));
    if (!text || /Status heartbeat job started|Failed to report status/i.test(text)) return;
    return sendToChannel(client, channelIdFor('general'), {
      content: `\`${stamp}\` **${level.toUpperCase()}** ${text}`,
      allowedMentions: { parse: [] },
    });
  });
}

module.exports = {
  attachDiscordLogger,
  sendGuildLifecycleLog,
  startDiscordStatusJob,
};
