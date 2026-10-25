// i18n-ignore-file: operations messages for the Petto team channels.
const { ContainerBuilder, EmbedBuilder, Events, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, Status, TextDisplayBuilder } = require('discord.js');
const config = require('../config');
const logger = require('./logger');
const { exclusiveTask } = require('./concurrency');

const STATUS_MARKER = 'Petto operational status';
const STATUS_INTERVAL_MS = 60_000; // two message edits each minute, a small share of the request limit
const statusMessages = new Map();
const STATUS_EMOJIS = {
  online: '<:online:1535353909751709768>',
  outage: '<:outage:1535353911488159825>',
  idle: '<:idle:1535353913258151957>',
  offline: '<:offline:1535353908027986040>',
};
let lastHistoryState = null;
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

function lifecycleEmbed({ kind, guild, ownerId, inviter }) {
  const joined = kind === 'join';
  const fields = [
    { name: 'Server', value: `${guild.name}\n\`${guild.id}\``, inline: true },
    { name: 'Members', value: String(guild.memberCount ?? 'unknown'), inline: true },
  ];

  if (ownerId) fields.push({ name: 'Owner', value: `<@${ownerId}>\n\`${ownerId}\``, inline: true });
  if (inviter) fields.push({ name: 'Added by', value: `<@${inviter.id}>\n\`${inviter.id}\``, inline: true });
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
  logger.info(`Guild lifecycle: ${options.kind === 'join' ? 'joined' : 'left'} guild=${options.guild.id} name=${options.guild.name} members=${options.guild.memberCount ?? 'unknown'}`);
  await Promise.all(ids.map((id) => sendToChannel(client, id, { embeds: [embed] })));
}

function guildCount(client) {
  return client.guilds.cache.size;
}

// Discord sometimes gives no member count for a server for a moment (it is unavailable, or its data is still arriving), and the
// total then dropped by the whole server. The last count that was good is kept, so a missing one does not take members away.
const lastMemberCounts = new Map();

function memberCount(client) {
  const present = new Set();
  let total = 0;
  for (const guild of client.guilds.cache.values()) {
    present.add(guild.id);
    const current = Number(guild.memberCount);
    if (Number.isFinite(current) && current > 0) lastMemberCounts.set(guild.id, current);
    total += lastMemberCounts.get(guild.id) ?? 0;
  }
  // A server the bot left is forgotten, so it stops adding members.
  for (const id of lastMemberCounts.keys()) if (!present.has(id)) lastMemberCounts.delete(id);
  return total;
}

function aggregateGatewayState(client) {
  const shards = [...client.ws.shards.values()];
  if (!shards.length || shards.every((shard) => shard.status === Status.Ready)) return 'online';
  if (shards.every((shard) => shard.status === Status.Disconnected)) return 'offline';
  if (shards.some((shard) => [Status.Disconnected, Status.Reconnecting].includes(shard.status))) return 'outage';
  return 'idle';
}

// Only an outage is red and only a healthy service is green; the other states have no color.
const STATE_COLORS = { online: 0xa5ea7a, idle: null, outage: 0xfe6465, offline: 0xfe6465 };
const STATE_LABELS = { online: 'All services operational', idle: 'Service degradation detected', outage: 'Partial outage detected', offline: 'Petto is offline' };

/** A card with a title, some text under a line and a small footer. */
function statusCard({ color, title, lines, footer }) {
  const card = new ContainerBuilder().setAccentColor(color ?? null)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  if (footer) card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footer}`));
  return card;
}

function statusHistoryPayload(state, details) {
  const emoji = STATUS_EMOJIS[state] || STATUS_EMOJIS.idle;
  const lines = [details];
  return {
    components: [statusCard({ color: STATE_COLORS[state] ?? STATE_COLORS.idle, title: `${emoji} ${STATE_LABELS[state] || 'Status update'}`, lines, footer: `<t:${Math.floor(Date.now() / 1000)}:f>` })],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }, // a status message never pings anyone
  };
}

async function announceStatusHistory(client, state, details, { force = false } = {}) {
  if (!force && state === lastHistoryState) return;
  const channelId = channelIdFor('statusHistory');
  const channel = await getTextChannel(client, channelId);
  if (!channel) return;

  logger.info(`Status event: state=${state} channel=${channelId} details=${details}`);

  const sent = await channel.send(statusHistoryPayload(state, details)).catch(() => null);
  if (sent) lastHistoryState = state;
}

function registerGatewayStatusEvents(client) {
  const announce = (state, details) => announceStatusHistory(client, state, details).catch(() => {});
  client.on(Events.ShardReconnecting, (shardId) => {
    announce('idle', `Shard **${Number(shardId) + 1}** is reconnecting. Some servers may respond slowly while Discord restores the connection.`);
  });
  client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
    announce('outage', `Shard **${Number(shardId) + 1}** disconnected (code \`${closeEvent?.code ?? 'unknown'}\`). Petto is attempting to recover automatically.`);
  });
  client.on(Events.ShardError, (error, shardId) => {
    announce('outage', `Shard **${Number(shardId) + 1}** reported an error: \`${redact(error?.message || error)}\``);
  });
  client.on(Events.ShardReady, (shardId) => {
    const state = aggregateGatewayState(client);
    announce(state, state === 'online'
      ? `Shard **${Number(shardId) + 1}** recovered. **All services are restored.**`
      : `Shard **${Number(shardId) + 1}** is ready, but another shard is still recovering.`);
  });
  client.on(Events.ShardResume, (shardId, replayedEvents) => {
    const state = aggregateGatewayState(client);
    announce(state, state === 'online'
      ? `Shard **${Number(shardId) + 1}** resumed successfully. **All services are restored.**`
      : `Shard **${Number(shardId) + 1}** resumed with ${replayedEvents ?? 0} replayed events.`);
  });
}

const SHARD_STATE = { [Status.Ready]: 'Online', [Status.Connecting]: 'Connecting', [Status.Reconnecting]: 'Reconnecting', [Status.Resuming]: 'Resuming', [Status.Disconnected]: 'Disconnected' };

/** The ping of a shard in ms. Right after a start the first heartbeat has not answered yet, so it says so instead of leaving it out. */
function pingText(client, shard) {
  const own = Number(shard.ping);
  if (Number.isFinite(own) && own >= 0) return ` · ${Math.round(own)} ms`;
  const average = Number(client.ws.ping);
  if (Number.isFinite(average) && average >= 0) return ` · ${Math.round(average)} ms`;
  return ' · measuring ping';
}

/** One line per shard, numbered from 1: how it is and how many servers it has. */
function shardLines(client) {
  const perShard = new Map();
  for (const guild of client.guilds.cache.values()) perShard.set(guild.shardId ?? 0, (perShard.get(guild.shardId ?? 0) ?? 0) + 1);
  return [...client.ws.shards.values()].map((shard) => `${SHARD_EMOJI[shard.status === Status.Ready ? 'on' : 'off']} **Shard ${shard.id + 1}** · ${SHARD_STATE[shard.status] ?? 'Unknown'} · ${perShard.get(shard.id) ?? 0} servers${pingText(client, shard)}`);
}
const SHARD_EMOJI = { on: STATUS_EMOJIS.online, off: STATUS_EMOJIS.outage };

function publicStatusCard(client) {
  const state = aggregateGatewayState(client);
  return statusCard({
    color: STATE_COLORS[state] ?? STATE_COLORS.idle,
    title: `${STATUS_EMOJIS[state] || STATUS_EMOJIS.idle} Petto status`,
    lines: [
      state === 'online' ? 'Petto is online and serving Discord communities.' : STATE_LABELS[state],
      `**Servers** ${guildCount(client)} · **Online since** <t:${Math.floor((Date.now() - process.uptime() * 1000) / 1000)}:R>`,
      ...shardLines(client),
    ],
    footer: `${STATUS_MARKER} · updated <t:${Math.floor(Date.now() / 1000)}:R>`,
  });
}

function internalStatusCard(client) {
  const memory = process.memoryUsage();
  return statusCard({
    color: 0x8799ff,
    title: 'Petto internal status',
    lines: [
      'Operational snapshot for developers and owners.',
      `**Process** Node ${process.version} · PID ${process.pid} · uptime ${Math.floor(process.uptime())}s`,
      `**Runtime** ${(memory.rss / 1024 / 1024).toFixed(1)} MB RSS · heap ${(memory.heapUsed / 1024 / 1024).toFixed(1)} MB`,
      `**Discord** ${guildCount(client)} servers · ${memberCount(client)} cached members`,
      ...shardLines(client),
    ],
    footer: `${STATUS_MARKER} · updated <t:${Math.floor(Date.now() / 1000)}:R>`,
  });
}

/** Whether a message is one of the status messages: the embed ones from before, or the cards that replaced them. */
function isStatusMessage(candidate, clientId) {
  if (candidate.author?.id !== clientId) return false;
  if (candidate.embeds?.some((item) => item.footer?.text === STATUS_MARKER)) return true;
  try { return JSON.stringify(candidate.components?.map((c) => c.toJSON?.() ?? c) ?? []).includes(STATUS_MARKER); } catch { return false; }
}

async function upsertStatusMessage(client, kind, card) {
  const channelId = channelIdFor(kind);
  const channel = await getTextChannel(client, channelId);
  if (!channel) return;

  const key = `${kind}:${channelId}`;
  let message = statusMessages.get(key) || null;
  if (!message) {
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    message = recent?.find((candidate) => isStatusMessage(candidate, client.user?.id)) || null;
  }

  const payload = { components: [card], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
  if (message) {
    // A message cannot change from an embed to a card: the old embed goes and the card takes its place.
    if (message.flags?.has?.(MessageFlags.IsComponentsV2)) {
      const edited = await message.edit(payload).catch(() => null);
      if (edited) { statusMessages.set(key, edited); return; }
    } else {
      await message.delete().catch(() => {});
    }
  }

  const sent = await channel.send(payload).catch(() => null);
  if (sent) statusMessages.set(key, sent);
}

async function reportDiscordStatus(client) {
  if (!client.user) return;
  const shards = [...client.ws.shards.values()]
    .map((shard) => `${shard.id + 1}:${Status[shard.status] || shard.status}`)
    .join(' ');
  logger.info(
    `Discord health snapshot: state=${aggregateGatewayState(client)} guilds=${guildCount(client)} members=${memberCount(client)} ` +
    `uptime=${Math.floor(process.uptime())}s ` +
    `rss=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB shards=[${shards || 'none'}]`,
  );
  await Promise.all([
    upsertStatusMessage(client, 'publicStatus', publicStatusCard(client)),
    upsertStatusMessage(client, 'internalStatus', internalStatusCard(client)),
  ]);
}

function startDiscordStatusJob(client) {
  registerGatewayStatusEvents(client);
  announceStatusHistory(client, 'online', `Petto is online and serving **${guildCount(client)}** servers.`, { force: true }).catch(() => {});
  const report = exclusiveTask(() => reportDiscordStatus(client));
  report().catch(() => {});
  const timer = setInterval(() => {
    report().catch(() => {});
    const state = aggregateGatewayState(client);
    announceStatusHistory(client, state, state === 'online'
      ? `Petto is healthy with **${guildCount(client)}** servers.`
      : 'Discord connectivity is not fully healthy. Petto is attempting to recover automatically.').catch(() => {});
  }, STATUS_INTERVAL_MS);
  timer.unref?.();
}

// The log lines go to the general channel in groups instead of one message each: every line used to be its own request, and a busy
// minute (or a warning about requests, which is itself a message) multiplied them.
const LOG_FLUSH_MS = 5_000;
const LOG_MESSAGE_LIMIT = 1900;
let logLines = []; // { level, text }
let logTimer = null;

const LEVEL_COLORS = { error: 0xfe6465, warn: null, info: null };
const LEVEL_RANK = { info: 0, warn: 1, error: 2 };

function flushLogLines(client) {
  logTimer = null;
  const lines = logLines;
  logLines = [];
  const groups = [];
  let current = { text: '', level: 'info' };
  for (const line of lines) {
    if (current.text && current.text.length + line.text.length + 1 > LOG_MESSAGE_LIMIT) { groups.push(current); current = { text: '', level: 'info' }; }
    current.text += `${current.text ? '\n' : ''}${line.text}`;
    if (LEVEL_RANK[line.level] > LEVEL_RANK[current.level]) current.level = line.level;
  }
  if (current.text) groups.push(current);
  // At most three cards per flush; the rest of a flood is dropped from the channel (it is still in the host log).
  for (const group of groups.slice(0, 3)) {
    const card = new ContainerBuilder().setAccentColor(LEVEL_COLORS[group.level] ?? null).addTextDisplayComponents(new TextDisplayBuilder().setContent(group.text));
    sendToChannel(client, channelIdFor('general'), { components: [card], flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications, allowedMentions: { parse: [] } }).catch(() => {});
  }
}

function attachDiscordLogger(client) {
  if (loggerAttached) return;
  loggerAttached = true;
  logger.addDiscordSink((level, args, stamp) => {
    // Keep the original operational log stream in the general channel. The separate
    // diagnostics sink handles WARN/ERROR embeds in its own channel as well.
    const text = redact(args.map(safeText).join(' '));
    if (!text || /Status heartbeat job started|Failed to report status/i.test(text)) return;
    if (!channelIdFor('general')) return;
    const unix = Math.floor(Date.parse(stamp) / 1000) || Math.floor(Date.now() / 1000);
    const tag = level === 'error' ? 'ERROR' : level === 'warn' ? 'WARN' : 'INFO';
    logLines.push({ level, text: `-# <t:${unix}:T> **${tag}**\n${text.slice(0, 600)}` });
    if (!logTimer) { logTimer = setTimeout(() => flushLogLines(client), LOG_FLUSH_MS); logTimer.unref?.(); }
    // Told what happened before it was connected too (the Cloudflare tunnel starts first): see the logger.
  }, { replayEarly: true });
}

module.exports = {
  memberCount,
  attachDiscordLogger,
  sendGuildLifecycleLog,
  startDiscordStatusJob,
};
