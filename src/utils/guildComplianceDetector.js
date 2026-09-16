const { Events } = require('discord.js');
const { sendGuildNotice, sendTeamAlert } = require('./guildOpsAlerts');
const logger = require('./logger');

const ATTACHED = Symbol.for('petto.guildComplianceMonitor.attached');
const SWEEP_STARTED = Symbol.for('petto.guildComplianceMonitor.sweepStarted');
const SCAN_COOLDOWN_MS = Math.max(60_000, Number(process.env.PETTO_GUILD_COMPLIANCE_SCAN_COOLDOWN_MS) || 10 * 60 * 1000);
const SIGNAL_WINDOW_MS = Math.max(5 * 60_000, Number(process.env.PETTO_GUILD_COMPLIANCE_SIGNAL_WINDOW_MS) || 30 * 60 * 1000);
const TEAM_ALERT_SCORE = Math.max(3, Number(process.env.PETTO_GUILD_COMPLIANCE_TEAM_SCORE) || 5);
const AUTO_NOTICE_SCORE = Math.max(TEAM_ALERT_SCORE, Number(process.env.PETTO_GUILD_COMPLIANCE_NOTICE_SCORE) || 8);
const CRITICAL_SCORE = Math.max(AUTO_NOTICE_SCORE, Number(process.env.PETTO_GUILD_COMPLIANCE_CRITICAL_SCORE) || 10);
const AUTO_NOTICE_ENABLED = !/^(?:0|false|off|no)$/i.test(String(process.env.PETTO_GUILD_COMPLIANCE_AUTO_NOTICE ?? 'true'));
const SWEEP_INTERVAL_MS = Math.max(30_000, Number(process.env.PETTO_GUILD_COMPLIANCE_SWEEP_INTERVAL_MS) || 60_000);
const SWEEP_BATCH_SIZE = Math.max(1, Math.min(100, Number(process.env.PETTO_GUILD_COMPLIANCE_SWEEP_BATCH) || 20));

const scanState = new Map();
const recentSignals = new Map();
const scheduledScans = new Map();
let sweepCursor = 0;

// Detection is intentionally multilingual and evidence-based. Bare words such as
// "boost", "nitro", "shop" or "payment" are not enough by themselves to trigger
// a server notice. We look for combinations that indicate an actual transaction.
const PATTERNS = {
  commerce: /\b(?:shop|store|tienda|loja|market|marketplace|mercado|catalog|catalogo|catalogue|price|prices|precio|precios|preco|precos|order|orders|pedido|pedidos|sale|sales|venta|ventas|venda|vendas|selling|vendiendo|vendendo|vendo|vender|compra|compras|comprar|purchase|buy|sell|stock|estoque|vouch|vouches|comprovante|comprovantes)\b/i,
  payment: /\b(?:payment|payments|pay|pago|pagos|pagamento|pagamentos|paypal|cashapp|venmo|crypto|cripto|criptomoeda|bitcoin|btc|usdt|binance|wallet|wallets|carteira|carteiras|stripe|pix|boleto|mercadopago|mercado\s+pago|bizum|transferencia|transferencias|cartao|cartoes|tarjeta|tarjetas)\b/i,
  discordGoods: /\b(?:discord\s+accounts?|accounts?\s+discord|cuentas?\s+discord|contas?\s+discord|aged\s+accounts?|cuentas?\s+antiguas?|contas?\s+antigas?|nitro|server\s+boosts?|boosts?|impulsos?|members?|miembros?|membros?|discord\s+tokens?|tokens?\s+discord|vanity\s+urls?|vanity\s+url)\b/i,
  pricing: /(?:[$€£]\s?\d+(?:[.,]\d{1,2})?|\b\d+(?:[.,]\d{1,2})?\s?(?:usd|eur|gbp|cop|mxn|ars|brl|usdt|reais?|dolares?|dollars?|euros?)\b)/i,
  transaction: /\b(?:dm\s+(?:me\s+)?to\s+(?:buy|order)|open\s+(?:a\s+)?ticket\s+to\s+(?:buy|order)|buy\s+now|order\s+now|payment\s+methods?|metodos?\s+de\s+pago|formas?\s+de\s+pago|abre\s+(?:un\s+)?ticket\s+para\s+comprar|abrir\s+(?:un\s+)?ticket\s+para\s+comprar|compra\s+ahora|comprar\s+ahora|manda\s+dm\s+para\s+comprar|metodos?\s+de\s+pagamento|formas?\s+de\s+pagamento|abra\s+(?:um\s+)?ticket\s+para\s+comprar|abrir\s+(?:um\s+)?ticket\s+para\s+comprar|compre\s+agora|comprar\s+agora|manda\s+dm\s+para\s+comprar|chama\s+na\s+dm\s+para\s+comprar)\b/i,
};

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreText(value, { metadata = false, channelName = false } = {}) {
  const text = normalize(value);
  if (!text) return { score: 0, labels: [], families: [], actionable: false };

  const commerce = PATTERNS.commerce.test(text);
  const payment = PATTERNS.payment.test(text);
  const discordGoods = PATTERNS.discordGoods.test(text);
  const pricing = PATTERNS.pricing.test(text);
  const transaction = PATTERNS.transaction.test(text);
  const trade = discordGoods && (commerce || pricing || transaction);

  let score = 0;
  const labels = [];
  const families = [];

  if (commerce) {
    score += 1;
    labels.push('commerce terminology');
    families.push('commerce');
  }
  if (payment) {
    score += metadata || channelName ? 1 : 2;
    labels.push('payment terminology');
    families.push('payment');
  }
  if (pricing) {
    score += channelName ? 0 : metadata ? 1 : 2;
    labels.push('explicit pricing');
    families.push('pricing');
  }
  if (transaction) {
    score += channelName ? 1 : metadata ? 2 : 3;
    labels.push('purchase/order call-to-action');
    families.push('transaction');
  }

  // A bare "nitro", "boost" or "members" reference is intentionally worth 0.
  // It only becomes meaningful when the same text also contains sale/payment context.
  if (trade) {
    score += channelName ? 3 : 4;
    labels.push('Discord goods/services with transaction context');
    families.push('discord-trade');
  }

  if (commerce && payment) score += 1;
  if (pricing && (commerce || payment)) score += 1;

  const actionable = Boolean(
    trade
    || transaction
    || (pricing && (commerce || payment))
    || (!metadata && commerce && payment),
  );

  return {
    score,
    labels: [...new Set(labels)],
    families: [...new Set(families)],
    actionable,
  };
}

function addRecentSignal(guildId, signal) {
  const now = Date.now();
  const list = recentSignals.get(guildId) ?? [];
  const withoutDuplicate = signal.messageId
    ? list.filter((item) => item.messageId !== signal.messageId)
    : list;
  withoutDuplicate.push({ ...signal, at: now });
  const kept = withoutDuplicate.filter((item) => now - item.at <= SIGNAL_WINDOW_MS).slice(-30);
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
  const familyHits = new Set();
  const labels = new Set();
  const channels = new Set();
  let actionable = false;

  function absorb(result, prefix, channelId = null) {
    if (!result.score) return;
    result.families.forEach((family) => familyHits.add(family));
    result.labels.forEach((label) => labels.add(`${prefix} ${label}`));
    if (result.actionable) actionable = true;
    if (channelId && channels.size < 6) channels.add(channelId);
  }

  absorb(scoreText([guild.name, guild.description].filter(Boolean).join(' '), { metadata: true }), 'guild');

  for (const channel of guild.channels.cache.values()) {
    absorb(scoreText(channel.name, { metadata: true, channelName: true }), 'channel', channel.id);
    if (channel.topic) absorb(scoreText(channel.topic, { metadata: true }), 'channel topic', channel.id);
  }

  // Count each evidence family only once across the entire server. This prevents a
  // large social server with repeated #boost/#payment-style utility channels from
  // accumulating a high score just because it has many channels.
  let score = 0;
  if (familyHits.has('commerce')) score += 1;
  if (familyHits.has('payment')) score += 1;
  if (familyHits.has('pricing')) score += 1;
  if (familyHits.has('transaction')) score += 2;
  if (familyHits.has('discord-trade')) score += 4;
  if (familyHits.has('discord-trade') && familyHits.has('pricing')) score += 1;

  return {
    score: Math.min(score, 8),
    labels: [...labels],
    families: [...familyHits],
    channels: [...channels],
    actionable,
  };
}

function summarizeResult({ score, labels, channels, recent, actionable }) {
  const confidence = !actionable
    ? 'low'
    : score >= CRITICAL_SCORE
      ? 'very high'
      : score >= AUTO_NOTICE_SCORE
        ? 'high'
        : score >= TEAM_ALERT_SCORE
          ? 'review'
          : 'low';
  const uniqueLabels = [...new Set(labels)].slice(0, 8);
  const recentChannels = [...new Set(recent.map((item) => item.channelId).filter(Boolean))].slice(0, 5);
  const channelIds = [...new Set([...(channels || []), ...recentChannels])].slice(0, 6);

  const parts = [
    `Confidence: **${confidence}** (score ${score})`,
    `Actionable transaction evidence: **${actionable ? 'yes' : 'no'}**`,
    uniqueLabels.length ? `Signals: ${uniqueLabels.join(', ')}` : 'Signals: none',
  ];
  if (channelIds.length) parts.push(`Observed channels: ${channelIds.map((id) => `<#${id}>`).join(', ')}`);
  if (recent.length) parts.push(`Recent matching messages: ${recent.length} in the last ${Math.round(SIGNAL_WINDOW_MS / 60_000)} minutes.`);
  parts.push('Petto does not store matching message content in this detector; only short-lived signal metadata is kept in memory.');
  return { confidence, text: parts.join('\n') };
}

async function scanGuildForCompliance(client, guildId, {
  force = false,
  bypassScanCooldown = false,
  source = 'guild compliance monitor',
  requestedBy = null,
} = {}) {
  const guild = client.guilds.cache.get(String(guildId))
    ?? await client.guilds.fetch(String(guildId)).catch(() => null);
  if (!guild) return { ok: false, reason: 'guild_not_found', guild: null, score: 0, confidence: 'unknown', labels: [] };

  const now = Date.now();
  const last = scanState.get(guild.id) ?? 0;
  if (!force && !bypassScanCooldown && now - last < SCAN_COOLDOWN_MS) {
    return { ok: true, skipped: 'cooldown', guild, score: 0, confidence: 'cooldown', labels: [], actionable: false };
  }
  scanState.set(guild.id, now);

  const metadata = inspectGuildMetadata(guild);
  const recent = getRecentSignals(guild.id);
  const recentScores = recent.map((item) => Math.min(item.score || 0, 6)).sort((a, b) => b - a).slice(0, 2);
  const recentScore = Math.min(8, recentScores.reduce((sum, value) => sum + value, 0));
  const recentLabels = recent.flatMap((item) => item.labels || []);
  const score = Math.min(16, metadata.score + recentScore);
  const labels = [...new Set([...metadata.labels, ...recentLabels])];
  const actionable = metadata.actionable || recent.some((item) => item.actionable);
  const summary = summarizeResult({ score, labels, channels: metadata.channels, recent, actionable });

  // Do not alert on generic words alone. A social/community server can legitimately
  // have channels such as #boost, #payments, #shop or #prices without being a shop.
  if (!actionable || score < TEAM_ALERT_SCORE) {
    return {
      ok: true,
      guild,
      score,
      confidence: summary.confidence,
      labels,
      actionable,
      teamAlerted: false,
      noticeSent: false,
      noticeDelivery: null,
    };
  }

  let notice = null;
  if (AUTO_NOTICE_ENABLED && score >= AUTO_NOTICE_SCORE) {
    notice = await sendGuildNotice(client, {
      guildId: guild.id,
      kind: 'shop',
      details: 'Petto detected multiple independent commerce signals that include transaction context and require administrator review. This automated review notice is not a final policy determination.',
      source,
      requestedBy,
      force,
      teamAlert: false,
    });
  }

  const severity = score >= CRITICAL_SCORE ? 'critical' : 'warning';
  const teamMessage = await sendTeamAlert(client, {
    guild,
    kind: 'shop',
    severity,
    details: summary.text,
    source,
    deliveredChannel: notice?.channel ?? null,
    deliveryType: notice?.deliveryType ?? null,
    deliveredRecipientId: notice?.recipientId ?? null,
    requestedBy,
    force,
  });

  logger.warn(
    { guildId: guild.id, action: 'guild-compliance-scan', score, confidence: summary.confidence, actionable },
    `Guild compliance monitor produced a ${summary.confidence} commerce-review signal.`,
  );

  return {
    ok: true,
    guild,
    score,
    confidence: summary.confidence,
    labels,
    actionable,
    teamAlerted: Boolean(teamMessage),
    noticeSent: Boolean(notice?.ok),
    noticeChannel: notice?.channel ?? null,
    noticeDelivery: notice?.deliveryType ?? null,
  };
}

async function inspectMessage(message) {
  if (!message?.guild || message.author?.bot || message.system) return;
  const content = String(message.content ?? '').slice(0, 2_000);
  const result = scoreText(content, { metadata: false });
  if (result.score < 3 || !result.actionable) return;

  const signals = addRecentSignal(message.guild.id, {
    score: Math.min(result.score, 6),
    labels: result.labels.map((label) => `message ${label}`),
    families: result.families,
    actionable: result.actionable,
    channelId: message.channelId,
    messageId: message.id,
  });

  const rollingScore = signals
    .map((item) => Math.min(item.score || 0, 6))
    .sort((a, b) => b - a)
    .slice(0, 2)
    .reduce((sum, value) => sum + value, 0);
  if (rollingScore < TEAM_ALERT_SCORE) return;

  // Re-evaluate immediately after a live signal, but do not bypass notice/team
  // cooldowns. This fixes the old behaviour where the 10-minute scan cooldown made
  // the automatic detector appear to work only when !guildsend scan was used.
  await scanGuildForCompliance(message.client, message.guild.id, {
    bypassScanCooldown: true,
    source: 'guild compliance live monitor',
  }).catch((error) => {
    logger.warn({ guildId: message.guild.id, action: 'guild-compliance-message' }, 'Compliance scan after message signal failed:', error);
  });
}

function scheduleScan(client, guildId, source, delayMs = 2_500) {
  const key = String(guildId);
  const existing = scheduledScans.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    scheduledScans.delete(key);
    scanGuildForCompliance(client, guildId, {
      bypassScanCooldown: true,
      source,
    }).catch((error) => {
      logger.warn({ guildId, action: 'guild-compliance-scheduled' }, 'Scheduled guild compliance scan failed:', error);
    });
  }, delayMs);
  timer.unref?.();
  scheduledScans.set(key, timer);
}

function startBackgroundSweep(client) {
  if (!client || client[SWEEP_STARTED]) return;
  client[SWEEP_STARTED] = true;

  const runBatch = async () => {
    const guilds = [...client.guilds.cache.values()];
    if (!guilds.length) return;

    for (let i = 0; i < Math.min(SWEEP_BATCH_SIZE, guilds.length); i += 1) {
      const guild = guilds[(sweepCursor + i) % guilds.length];
      // eslint-disable-next-line no-await-in-loop
      await scanGuildForCompliance(client, guild.id, { source: 'guild compliance background sweep' }).catch((error) => {
        logger.warn({ guildId: guild.id, action: 'guild-compliance-sweep' }, 'Background guild compliance scan failed:', error);
      });
    }
    sweepCursor = (sweepCursor + SWEEP_BATCH_SIZE) % guilds.length;
  };

  const first = setTimeout(() => runBatch().catch(() => {}), 30_000);
  first.unref?.();
  const interval = setInterval(() => runBatch().catch(() => {}), SWEEP_INTERVAL_MS);
  interval.unref?.();
}

function attachGuildComplianceMonitor(client) {
  if (!client || client[ATTACHED]) return;
  client[ATTACHED] = true;

  const onReady = () => startBackgroundSweep(client);
  if (client.isReady?.()) onReady();
  else client.once(Events.ClientReady, onReady);

  client.on(Events.GuildCreate, (guild) => scheduleScan(client, guild.id, 'guild joined', 15_000));
  client.on(Events.GuildUpdate, (_before, after) => {
    if (after?.id) scheduleScan(client, after.id, 'guild updated');
  });
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
