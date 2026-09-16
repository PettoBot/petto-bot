const { Events } = require('discord.js');
const { sendGuildNotice, sendTeamAlert } = require('./guildOpsAlerts');
const logger = require('./logger');

const ATTACHED = Symbol.for('petto.guildComplianceMonitor.attached');
const SCAN_COOLDOWN_MS = Math.max(60_000, Number(process.env.PETTO_GUILD_COMPLIANCE_SCAN_COOLDOWN_MS) || 10 * 60 * 1000);
const SIGNAL_WINDOW_MS = Math.max(5 * 60_000, Number(process.env.PETTO_GUILD_COMPLIANCE_SIGNAL_WINDOW_MS) || 30 * 60 * 1000);
const TEAM_ALERT_SCORE = Math.max(3, Number(process.env.PETTO_GUILD_COMPLIANCE_TEAM_SCORE) || 5);
const AUTO_NOTICE_SCORE = Math.max(TEAM_ALERT_SCORE, Number(process.env.PETTO_GUILD_COMPLIANCE_NOTICE_SCORE) || 8);
const CRITICAL_SCORE = Math.max(AUTO_NOTICE_SCORE, Number(process.env.PETTO_GUILD_COMPLIANCE_CRITICAL_SCORE) || 10);
const AUTO_NOTICE_ENABLED = !/^(?:0|false|off|no)$/i.test(String(process.env.PETTO_GUILD_COMPLIANCE_AUTO_NOTICE ?? 'true'));

const scanState = new Map();
const recentSignals = new Map();

const PATTERNS = {
  commerce: /\b(?:shop|store|tienda|market|marketplace|catalog(?:ue)?|prices?|orders?|sales?|selling|vendo|venta|ventas|compras?|purchase|buy|sell|stock|vouches?)\b/i,
  payment: /\b(?:payment|payments|pay|pago|pagos|paypal|cashapp|venmo|crypto|bitcoin|btc|usdt|binance|wallet|wallets|stripe|card payment)\b/i,
  discordGoods: /\b(?:discord\s+accounts?|aged\s+accounts?|accounts?\s+for\s+sale|nitro|server\s+boosts?|boosts?\s+for\s+sale|members?\s+for\s+sale|discord\s+tokens?|tokens?\s+for\s+sale|vanity\s+urls?)\b/i,
  pricing: /(?:[$€£]\s?\d+(?:[.,]\d{1,2})?|\b\d+(?:[.,]\d{1,2})?\s?(?:usd|eur|gbp|cop|mxn|ars|brl|usdt)\b)/i,
  transaction: /\b(?:dm\s+(?:me\s+)?to\s+(?:buy|order)|open\s+(?:a\s+)?ticket\s+to\s+(?:buy|order)|buy\s+now|order\s+now|payment\s+methods?)\b/i,
};

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreText(value, { metadata = false } = {}) {
  const text = normalize(value);
  if (!text) return { score: 0, labels: [] };

  let score = 0;
  const labels = [];
  const commerce = PATTERNS.commerce.test(text);
  const payment = PATTERNS.payment.test(text);
  const discordGoods = PATTERNS.discordGoods.test(text);
  const pricing = PATTERNS.pricing.test(text);
  const transaction = PATTERNS.transaction.test(text);

  if (commerce) {
    score += metadata ? 1 : 1;
    labels.push('commerce terminology');
  }
  if (payment) {
    score += metadata ? 2 : 2;
    labels.push('payment terminology');
  }
  if (discordGoods) {
    score += 3;
    labels.push('Discord-specific goods/services');
  }
  if (pricing) {
    score += metadata ? 1 : 2;
    labels.push('explicit pricing');
  }
  if (transaction) {
    score += 2;
    labels.push('purchase/order call-to-action');
  }

  if (commerce && payment) score += 1;
  if (commerce && discordGoods) score += 2;
  if (discordGoods && pricing) score += 1;

  return { score, labels: [...new Set(labels)] };
}

function addRecentSignal(guildId, signal) {
  const now = Date.now();
  const list = recentSignals.get(guildId) ?? [];
  list.push({ ...signal, at: now });
  const kept = list.filter((item) => now - item.at <= SIGNAL_WINDOW_MS).slice(-50);
  recentSignals.set(guildId, kept);
  return kept;
}

function getRecentSignals(guildId) {
  const now = Date.now();
  const list = (recentSignals.get(guildId) ?? []).filter((item) => now - item.at <= SIGNAL_WINDOW_MS);
  if (list.length) recentSignals.set(guildId, list);
  else recentSignals.delete(guildId);
  return list;
}

function inspectGuildMetadata(guild) {
  let score = 0;
  const labels = new Set();
  const channels = new Set();

  const guildText = [guild.name, guild.description].filter(Boolean).join(' ');
  const guildResult = scoreText(guildText, { metadata: true });
  score += guildResult.score;
  guildResult.labels.forEach((label) => labels.add(`guild ${label}`));

  for (const channel of guild.channels.cache.values()) {
    const channelText = [channel.name, channel.topic].filter(Boolean).join(' ');
    const result = scoreText(channelText, { metadata: true });
    if (!result.score) continue;

    score += Math.min(result.score, 4);
    result.labels.forEach((label) => labels.add(`channel ${label}`));
    if (channels.size < 6) channels.add(channel.id);
  }

  // Channel-heavy servers can otherwise accumulate an excessive score simply from
  // repeated category names, so cap metadata contribution.
  score = Math.min(score, 8);
  return { score, labels: [...labels], channels: [...channels] };
}

function summarizeResult({ score, labels, channels, recent }) {
  const confidence = score >= CRITICAL_SCORE ? 'very high' : score >= AUTO_NOTICE_SCORE ? 'high' : score >= TEAM_ALERT_SCORE ? 'review' : 'low';
  const uniqueLabels = [...new Set(labels)].slice(0, 8);
  const recentChannels = [...new Set(recent.map((item) => item.channelId).filter(Boolean))].slice(0, 5);
  const channelIds = [...new Set([...(channels || []), ...recentChannels])].slice(0, 6);

  const parts = [
    `Confidence: **${confidence}** (score ${score})`,
    uniqueLabels.length ? `Signals: ${uniqueLabels.join(', ')}` : 'Signals: none',
  ];
  if (channelIds.length) parts.push(`Observed channels: ${channelIds.map((id) => `<#${id}>`).join(', ')}`);
  if (recent.length) parts.push(`Recent matching messages: ${recent.length} in the last ${Math.round(SIGNAL_WINDOW_MS / 60_000)} minutes.`);
  parts.push('Petto does not store matching message content in this detector; only short-lived signal metadata is kept in memory.');
  return { confidence, text: parts.join('\n') };
}

async function scanGuildForCompliance(client, guildId, {
  force = false,
  source = 'guild compliance monitor',
  requestedBy = null,
} = {}) {
  const guild = client.guilds.cache.get(String(guildId))
    ?? await client.guilds.fetch(String(guildId)).catch(() => null);
  if (!guild) return { ok: false, reason: 'guild_not_found', guild: null, score: 0, confidence: 'unknown', labels: [] };

  const now = Date.now();
  const last = scanState.get(guild.id) ?? 0;
  if (!force && now - last < SCAN_COOLDOWN_MS) {
    return { ok: true, skipped: 'cooldown', guild, score: 0, confidence: 'cooldown', labels: [] };
  }
  scanState.set(guild.id, now);

  const metadata = inspectGuildMetadata(guild);
  const recent = getRecentSignals(guild.id);
  const recentScore = Math.min(8, recent.reduce((sum, item) => sum + Math.min(item.score || 0, 4), 0));
  const recentLabels = recent.flatMap((item) => item.labels || []);
  const score = metadata.score + recentScore;
  const labels = [...new Set([...metadata.labels, ...recentLabels])];
  const summary = summarizeResult({ score, labels, channels: metadata.channels, recent });

  if (score < TEAM_ALERT_SCORE) {
    return { ok: true, guild, score, confidence: summary.confidence, labels, teamAlerted: false, noticeSent: false };
  }

  const severity = score >= CRITICAL_SCORE ? 'critical' : 'warning';
  const teamMessage = await sendTeamAlert(client, {
    guild,
    kind: 'shop',
    severity,
    details: summary.text,
    source,
    requestedBy,
    force,
  });

  let notice = null;
  if (AUTO_NOTICE_ENABLED && score >= AUTO_NOTICE_SCORE) {
    notice = await sendGuildNotice(client, {
      guildId: guild.id,
      kind: 'shop',
      details: 'Petto detected multiple commerce-related signals that require administrator review. This is an automated review notice, not a final policy determination.',
      source,
      requestedBy,
      force,
      teamAlert: false,
    });
  }

  logger.warn(
    { guildId: guild.id, action: 'guild-compliance-scan', score, confidence: summary.confidence },
    `Guild compliance monitor produced a ${summary.confidence} commerce-review signal.`,
  );

  return {
    ok: true,
    guild,
    score,
    confidence: summary.confidence,
    labels,
    teamAlerted: Boolean(teamMessage),
    noticeSent: Boolean(notice?.ok),
    noticeChannel: notice?.channel ?? null,
  };
}

async function inspectMessage(message) {
  if (!message?.guild || message.author?.bot || message.system) return;
  const content = String(message.content ?? '').slice(0, 2_000);
  const result = scoreText(content, { metadata: false });
  if (result.score < 3) return;

  const signals = addRecentSignal(message.guild.id, {
    score: Math.min(result.score, 4),
    labels: result.labels.map((label) => `message ${label}`),
    channelId: message.channelId,
    messageId: message.id,
  });

  const rollingScore = signals.reduce((sum, item) => sum + Math.min(item.score || 0, 4), 0);
  if (rollingScore < TEAM_ALERT_SCORE) return;

  await scanGuildForCompliance(message.client, message.guild.id, {
    source: 'guild compliance live monitor',
  }).catch((error) => {
    logger.warn({ guildId: message.guild.id, action: 'guild-compliance-message' }, 'Compliance scan after message signal failed:', error);
  });
}

function scheduleScan(client, guildId, source, delayMs = 2_500) {
  const timer = setTimeout(() => {
    scanGuildForCompliance(client, guildId, { source }).catch((error) => {
      logger.warn({ guildId, action: 'guild-compliance-scheduled' }, 'Scheduled guild compliance scan failed:', error);
    });
  }, delayMs);
  timer.unref?.();
}

function attachGuildComplianceMonitor(client) {
  if (!client || client[ATTACHED]) return;
  client[ATTACHED] = true;

  client.on(Events.GuildCreate, (guild) => scheduleScan(client, guild.id, 'guild joined', 15_000));
  client.on(Events.ChannelCreate, (channel) => {
    if (channel.guildId) scheduleScan(client, channel.guildId, 'channel created');
  });
  client.on(Events.ChannelUpdate, (_before, after) => {
    if (after?.guildId) scheduleScan(client, after.guildId, 'channel updated');
  });
  client.on(Events.MessageCreate, (message) => {
    inspectMessage(message).catch((error) => {
      if (message.guildId) logger.warn({ guildId: message.guildId, action: 'guild-compliance-message' }, 'Live guild compliance inspection failed:', error);
    });
  });
}

module.exports = {
  attachGuildComplianceMonitor,
  scanGuildForCompliance,
  scoreText,
};
