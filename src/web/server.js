const confessionsDb = require('../db/confessions');
const suggestionsUtil = require('../utils/suggestions');
const { postPanel: postConfessionPanel } = require('../interactions/confessions');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const path = require('path');
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const { setupEverything, sendPanelNow, setEnabled } = require('../utils/verifyProvision');
const { verifyToken } = require('../utils/verifyToken');
const { verifyTranscriptToken } = require('../utils/transcriptToken');
const { getConfig } = require('../db/verificationConfig');
const { isRedeemed, claimRedemption, releaseRedemption } = require('../db/verificationRedemptions');
const { getTicketById, getTicketByNumber } = require('../db/tickets');
const { logVerification } = require('../utils/verificationLog');
const { sendVerifiedDM } = require('../utils/verifyMessage');
const { createBackup, listBackups, getBackup, recordAudit, vault } = require('../db/backups');
const { restoreBackup } = require('../utils/backupRestore');
const { buildSnapshot } = require('../commands/config/backup');
const { renderVerifyPage, pickLanguage } = require('./verifyPage');
const { createChallenge, checkAnswer } = require('../utils/verifyCaptcha');
const { methodOf, usesTurnstile, usesLetters } = require('../utils/verifyMethod');
const { renderHomePage } = require('./homePage');
const { setCachedPrefix } = require('../events/messageCreateCommands');
const { registerDashboardRestRoutes } = require('./dashboardDatabase');
const { registerCardRoutes } = require('./cardRoutes');
const { registerCodeRoutes } = require('./codeRoutes');
const { registerIdentityRoutes } = require('./identityRoutes');
const { registerMemberRoutes } = require('./memberRoutes');
const { registerPublicLeaderboardRoute } = require('./publicLeaderboard');
const { listVariables } = require('../utils/embedVariableRegistry');
const { renderPollRequest } = require('../utils/pollApi');
const { sendMethodNow } = require('../utils/questMethod');
const { canUseQuests } = require('../utils/questAlerts');
const questsDb = require('../db/quests');
const { runGiveawayAction } = require('../utils/giveawayApi');
const { createTopggHandler } = require('../utils/voteWebhook');
const logger = require('../utils/logger');

async function checkTurnstile(responseToken, remoteIp) {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: config.turnstileSecretKey, response: responseToken, remoteip: remoteIp ?? '' }),
  });
  return res.json();
}

function createRateLimiter({ windowMs, max }) {
  const buckets = new Map();
  let lastCleanup = Date.now();

  return (req, res, next) => {
    const now = Date.now();
    if (now - lastCleanup >= windowMs) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
      lastCleanup = now;
    }

    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const current = buckets.get(key);
    const bucket = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);

    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.set('RateLimit-Reset', String(retryAfter));
    if (bucket.count > max) {
      res.set('Retry-After', String(retryAfter)).status(429).json({ ok: false, error: 'rate_limited' });
      return;
    }
    next();
  };
}

const dashboardPrefixRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ ok: false, error: 'rate_limited' });
  },
});

// The vote webhook of top.gg: a few requests a minute are normal (one per vote, plus retries), so this only stops a flood of bad calls.
const verifyPageRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).type('text/plain').send('Too many requests. Wait a minute and try again.');
  },
});

const verifyCaptchaRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ ok: false, error: 'Too many pictures asked. Wait a minute and try again.' });
  },
});

const topggRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ ok: false, error: 'rate_limited' });
  },
});

const dashboardDatabaseRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ ok: false, error: 'rate_limited' });
  },
});

/**
 * Starts the verification web server (serves the Turnstile page and applies role
 * changes on success). Needs the live discord.js client to fetch guilds/members.
 * Returns null (and skips starting) if the Turnstile/token env vars aren't set,
 * /verify's slash command still works for config, it just can't send working links.
 */
function startServer(client) {
  // The Cloudflare keys are only needed by the servers that use that method; the letters method needs only the link and its secret.
  const verificationEnabled = Boolean(config.verifyBaseUrl && config.verifyTokenSecret);
  const dashboardEnabled = Boolean(config.dashboardApiSecret);
  const votesEnabled = Boolean(config.topggWebhookSecret);
  if (!verificationEnabled && !dashboardEnabled && !votesEnabled) {
    logger.warn('Verification and dashboard API env vars are not fully set, web server not started.');
    return null;
  }

  const app = express();
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  app.disable('x-powered-by');
  app.set('trust proxy', Number.isInteger(proxyHops) && proxyHops >= 0 ? proxyHops : 1);
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  // The webhooks of the vote lists are signed over the exact bytes they send, so for those the raw body is kept next to the parsed one.
  app.use(express.json({ limit: '100kb', verify: (req, res, buffer) => { if (req.originalUrl.startsWith('/webhooks/')) req.rawBody = buffer; } }));
  // Petto's brand icons (approve/deny/alert/favicon), also referenced by public URL
  // from the Components V2 verification DM, since Discord needs a real image URL.
  app.use('/assets', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

  function dashboardAuthorized(req) {
    return Boolean(config.dashboardApiSecret && req.get('x-petto-dashboard-key') === config.dashboardApiSecret);
  }

  async function dashboardGuild(req, res) {
    if (!dashboardAuthorized(req)) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return null;
    }
    const userId = String(req.query.user_id || req.body?.user_id || '');
    if (!userId || !req.params.guildId) {
      res.status(400).json({ ok: false, error: 'missing_identity' });
      return null;
    }
    if (!vault.isConfigured()) {
      res.status(503).json({ ok: false, error: 'vault_not_configured' });
      return null;
    }
    try {
      const guild = await client.guilds.fetch(req.params.guildId);
      const member = await guild.members.fetch(userId);
      const canManage = member.permissions.has(PermissionFlagsBits.ManageGuild) || member.permissions.has(PermissionFlagsBits.Administrator);
      if (!canManage) {
        res.status(403).json({ ok: false, error: 'no_access' });
        return null;
      }
      return { guild, userId, isAdministrator: member.permissions.has(PermissionFlagsBits.Administrator) };
    } catch (err) {
      logger.error(`Dashboard could not authorize guild ${req.params.guildId}:`, err);
      res.status(404).json({ ok: false, error: 'guild_unavailable' });
      return null;
    }
  }

  // The same check as the Vault routes without needing the Vault: the person must manage the server.
  async function dashboardCardAccess(req, res) {
    if (!dashboardAuthorized(req)) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return null;
    }
    const userId = String(req.query.user_id || req.body?.user_id || '');
    if (!/^\d{15,25}$/.test(userId) || !/^\d{15,25}$/.test(String(req.params.guildId || ''))) {
      res.status(400).json({ ok: false, error: 'missing_identity' });
      return null;
    }
    try {
      const guild = await client.guilds.fetch(req.params.guildId);
      const member = await guild.members.fetch(userId);
      const canManage = member.permissions.has(PermissionFlagsBits.ManageGuild) || member.permissions.has(PermissionFlagsBits.Administrator);
      if (!canManage) {
        res.status(403).json({ ok: false, error: 'no_access' });
        return null;
      }
      return { guild, member, userId };
    } catch (err) {
      logger.error(`Dashboard could not authorize cards for guild ${req.params.guildId}:`, err);
      res.status(404).json({ ok: false, error: 'guild_unavailable' });
      return null;
    }
  }

  async function dashboardVaultData(guildId) {
    const [backups, schedule, audit] = await Promise.all([
      listBackups(guildId, 20),
      vault.getSchedule(guildId),
      vault.listAudit(guildId, 20),
    ]);
    return { backups, schedule, audit };
  }

  if (dashboardEnabled) {
    registerDashboardRestRoutes(app, dashboardDatabaseRateLimiter);

    // The variables the message engine understands, so the dashboard and other tools do not keep
    // their own copy of the list. The list changes only with a release, so callers may cache it.
    app.get('/api/dashboard/variables', dashboardDatabaseRateLimiter, (req, res) => {
      if (!dashboardAuthorized(req)) {
        res.status(401).json({ ok: false, error: 'unauthorized' });
        return;
      }
      res.set('Cache-Control', 'private, max-age=300');
      res.json({ ok: true, groups: listVariables() });
    });

    // Start, edit, end or reroll a giveaway from the dashboard. The person must manage the server; the host of a new giveaway is that person.
    app.post('/api/dashboard/guild/:guildId/giveaway/:action', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      try {
        const result = await runGiveawayAction(client, access.guild.id, String(req.params.action), { ...req.body, host_id: access.userId });
        const { status, ...body } = result;
        res.status(result.ok ? 200 : status ?? 400).json(body);
      } catch (err) {
        logger.error(`Dashboard giveaway ${req.params.action} failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, error: 'giveaway_failed', message: 'The giveaway action failed. Try again.' });
      }
    });

    // The answer of the staff to a suggestion from the dashboard: approve, deny, consider, implement or take it back to pending.
    app.post('/api/dashboard/guild/:guildId/suggestions/answer', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      try {
        const id = String(req.body?.id ?? '').trim().toLowerCase();
        const status = String(req.body?.status ?? '');
        if (!/^[a-z0-9]{5}-[a-z0-9]{5}$/.test(id) || !suggestionsUtil.STATUSES[status]) { res.status(400).json({ ok: false, message: 'That is not a suggestion or a status.' }); return; }
        const member = await access.guild.members.fetch(access.userId).catch(() => null);
        const result = await suggestionsUtil.answer({ guild: access.guild, member, id, status, reason: req.body?.reason });
        if (result.error) { res.status(400).json({ ok: false, message: result.error }); return; }
        res.json({ ok: true, message: `Now ${suggestionsUtil.STATUSES[status].label.toLowerCase()}.` });
      } catch (err) {
        logger.error(`Dashboard suggestion answer failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: 'The answer could not be saved. Try again.' });
      }
    });

    // Who voted a suggestion, for the dashboard (the staff only, the same as the command).
    app.post('/api/dashboard/guild/:guildId/suggestions/votes', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      try {
        const member = await access.guild.members.fetch(access.userId).catch(() => null);
        const result = await suggestionsUtil.voters({ guild: access.guild, member, id: String(req.body?.id ?? '') });
        if (result.error) { res.status(400).json({ ok: false, message: result.error }); return; }
        const name = async (userId) => {
          const cached = access.guild.members.cache.get(userId) ?? await access.guild.members.fetch(userId).catch(() => null);
          return { id: userId, name: cached?.displayName ?? cached?.user?.username ?? userId };
        };
        const up = await Promise.all(result.up.slice(0, 50).map(name));
        const down = await Promise.all(result.down.slice(0, 50).map(name));
        res.json({ ok: true, up, down, upTotal: result.up.length, downTotal: result.down.length });
      } catch (err) {
        logger.error(`Dashboard suggestion votes failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: 'The votes could not be read. Try again.' });
      }
    });

    // The link to the saved transcript of a ticket, for the "Closed" list of the dashboard (the same signed link the log shows).
    app.post('/api/dashboard/guild/:guildId/tickets/transcript', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      try {
        const number = Number(req.body?.number);
        const ticket = Number.isInteger(number) && number > 0 ? await getTicketByNumber(access.guild.id, number) : null;
        if (!ticket) { res.status(404).json({ ok: false, message: 'That ticket does not exist.' }); return; }
        if (!ticket.transcript_html) { res.status(404).json({ ok: false, message: 'This ticket has no saved transcript yet.' }); return; }
        const link = require('../utils/ticketActions').buildTranscriptLink({ guild: access.guild, ticket });
        if (!link) { res.status(400).json({ ok: false, message: 'The transcript viewer is not set up in the bot.' }); return; }
        res.json({ ok: true, link });
      } catch (err) {
        logger.error(`Dashboard ticket transcript failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: 'The transcript could not be opened. Try again.' });
      }
    });

    // Puts back what an anti-nuke protection stopped (channels, roles, bans, the roles taken away). Owner and administrators only.
    app.post('/api/dashboard/guild/:guildId/antinuke/restore', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      try {
        const { canRestore, restoreEvent } = require('../utils/antiNukeRestore');
        const antinukeDb = require('../db/antinuke');
        if (!canRestore(access.member)) { res.status(403).json({ ok: false, message: 'Only the server owner and administrators can restore this.' }); return; }
        const event = await antinukeDb.getEvent(access.guild.id, Number(req.body?.id));
        if (!event) { res.status(404).json({ ok: false, message: 'That event does not exist.' }); return; }
        if (event.restored_at) { res.status(400).json({ ok: false, message: 'This was already restored.' }); return; }
        const { done, failed } = await restoreEvent(access.guild, event);
        if (!failed.length) await antinukeDb.markRestored(access.guild.id, event.id);
        res.json({ ok: failed.length === 0, done, failed, message: failed.length ? failed.join(' ') : undefined });
      } catch (err) {
        logger.error(`Dashboard anti-nuke restore failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: 'It could not be restored. Try again.' });
      }
    });

    // ── Appeals ──────────────────────────────────────────────────────────────
    // The public appeal site (petto.sbs/appeal/<server id>) asks the bot for what only Discord knows and for the actions that touch Discord. The web has already
    // checked who the member is (their Discord login), so these routes trust the user id the same way the dashboard routes do.
    const appealHits = new Map();
    const appealLimited = (key, max, windowMs) => {
      const now = Date.now();
      const hits = (appealHits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (hits.length >= max) { appealHits.set(key, hits); return true; }
      hits.push(now); appealHits.set(key, hits);
      if (appealHits.size > 5000) for (const [k, v] of appealHits) if (!v.some((t) => now - t < windowMs)) appealHits.delete(k);
      return false;
    };
    async function appealAccess(req, res, { needUser = true } = {}) {
      if (!dashboardAuthorized(req)) { res.status(401).json({ ok: false, error: 'unauthorized' }); return null; }
      const guildId = String(req.params.guildId || '');
      const userId = String(req.query.user_id || req.body?.user_id || '');
      if (!/^\d{15,25}$/.test(guildId) || (needUser && !/^\d{15,25}$/.test(userId))) { res.status(400).json({ ok: false, error: 'missing_identity' }); return null; }
      const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) { res.status(404).json({ ok: false, error: 'guild_unavailable' }); return null; }
      const appealsDb = require('../db/appeals');
      const config = await appealsDb.getConfig(guildId);
      let user = null;
      if (needUser) {
        const fetched = await client.users.fetch(userId).catch(() => null);
        if (!fetched) { res.status(404).json({ ok: false, error: 'user_unavailable' }); return null; }
        user = { id: fetched.id, username: fetched.username, avatarUrl: fetched.displayAvatarURL({ extension: 'png', size: 128 }) };
      }
      return { guild, config, user };
    }

    // What the site shows before any login: the name and the icon of the server.
    app.get('/api/appeals/:guildId/guild', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await appealAccess(req, res, { needUser: false });
      if (!access) return;
      res.set('Cache-Control', 'private, max-age=60');
      res.json({ ok: true, guild: { id: access.guild.id, name: access.guild.name, icon: access.guild.iconURL({ extension: 'png', size: 128 }) ?? null, members: access.guild.memberCount ?? null } });
    });

    // The punishments of the member in the server, as the server wants them shown, and whether they are blocked from appealing.
    app.get('/api/appeals/:guildId/punishments', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await appealAccess(req, res);
      if (!access) return;
      try {
        const appealsDb = require('../db/appeals');
        const { fetchPunishments, shapePunishment } = require('../utils/appeals');
        const rows = await fetchPunishments(access.guild, access.user.id, access.config);
        const block = await appealsDb.getBlock(access.guild.id, access.user.id);
        res.json({ ok: true, punishments: rows.map((p) => shapePunishment(p, access.config)), blocked: Boolean(block), blockedUntil: block?.until ?? null });
      } catch (err) {
        logger.error(`Appeals punishments failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, error: 'failed' });
      }
    });

    app.post('/api/appeals/:guildId/submit', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await appealAccess(req, res);
      if (!access) return;
      if (appealLimited(`submit:${access.user.id}`, 5, 10 * 60_000)) { res.status(429).json({ ok: false, error: 'rate_limited' }); return; }
      try {
        const appealsDb = require('../db/appeals');
        const { submitAppeal } = require('../utils/appeals');
        const form = await appealsDb.getForm(access.guild.id, Number(req.body?.form_id));
        const result = await submitAppeal({ client, guild: access.guild, config: access.config, form, user: access.user, rawAnswers: req.body?.answers ?? {} });
        if (!result.ok) { res.status(result.error === 'invalid' ? 422 : 400).json({ ok: false, error: result.error, fields: result.fields }); return; }
        res.json({ ok: true, id: result.submission.id });
      } catch (err) {
        logger.error(`Appeals submit failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, error: 'failed' });
      }
    });

    app.post('/api/appeals/:guildId/reply', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await appealAccess(req, res);
      if (!access) return;
      if (appealLimited(`reply:${access.user.id}`, 20, 10 * 60_000)) { res.status(429).json({ ok: false, error: 'rate_limited' }); return; }
      try {
        const appealsDb = require('../db/appeals');
        const { userReply } = require('../utils/appeals');
        const submission = await appealsDb.getSubmission(access.guild.id, String(req.body?.submission_id ?? ''));
        if (!submission || submission.user_id !== access.user.id) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
        const result = await userReply({ guild: access.guild, config: access.config, submission, content: req.body?.content });
        res.status(result.ok ? 200 : 400).json(result);
      } catch (err) {
        logger.error(`Appeals reply failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, error: 'failed' });
      }
    });

    app.post('/api/appeals/:guildId/withdraw', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await appealAccess(req, res);
      if (!access) return;
      try {
        const appealsDb = require('../db/appeals');
        const { withdrawAppeal } = require('../utils/appeals');
        const submission = await appealsDb.getSubmission(access.guild.id, String(req.body?.submission_id ?? ''));
        if (!submission || submission.user_id !== access.user.id) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
        const result = await withdrawAppeal({ guild: access.guild, config: access.config, submission });
        res.status(result.ok ? 200 : 400).json(result);
      } catch (err) {
        logger.error(`Appeals withdraw failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, error: 'failed' });
      }
    });

    // The staff, from the dashboard: accept or reject an appeal, or write to the member.
    app.post('/api/dashboard/guild/:guildId/appeals/resolve', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      try {
        const appealsDb = require('../db/appeals');
        const { resolveAppeal } = require('../utils/appeals');
        const submission = await appealsDb.getSubmission(access.guild.id, String(req.body?.id ?? ''));
        if (!submission) { res.status(404).json({ ok: false, message: 'That appeal does not exist.' }); return; }
        const result = await resolveAppeal({ client, guild: access.guild, submission, status: String(req.body?.status ?? ''), moderatorId: access.userId, moderatorName: access.member.displayName, reason: req.body?.reason });
        if (!result.ok) { res.status(400).json({ ok: false, message: result.error === 'already_resolved' ? 'This appeal was already answered.' : 'That could not be done.' }); return; }
        res.json({ ok: true, dm: result.dm, lifted: result.lifted });
      } catch (err) {
        logger.error(`Dashboard appeal resolve failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: 'It could not be saved. Try again.' });
      }
    });

    app.post('/api/dashboard/guild/:guildId/appeals/reply', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      try {
        const appealsDb = require('../db/appeals');
        const { staffReply } = require('../utils/appeals');
        const submission = await appealsDb.getSubmission(access.guild.id, String(req.body?.id ?? ''));
        if (!submission) { res.status(404).json({ ok: false, message: 'That appeal does not exist.' }); return; }
        const result = await staffReply({ client, guild: access.guild, submission, content: req.body?.content, moderatorId: access.userId, moderatorName: access.member.displayName });
        res.status(result.ok ? 200 : 400).json({ ok: result.ok, dm: result.dm, message: result.ok ? undefined : 'Write something first.' });
      } catch (err) {
        logger.error(`Dashboard appeal reply failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: 'It could not be sent. Try again.' });
      }
    });

    // The AutoMod rules of Discord made from templates: list them, add one, turn one on or off, remove one.
    app.post('/api/dashboard/guild/:guildId/automod/native', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      const native = require('../utils/nativeAutomod');
      try {
        const op = String(req.body?.op ?? 'list');
        const body = req.body ?? {};
        const id = (value) => (typeof value === 'string' && /^\d{5,25}$/.test(value) ? value : null);
        const ids = (list) => (Array.isArray(list) ? list.map(String).filter((v) => /^\d{5,25}$/.test(v)) : []);
        if (op === 'add') {
          const rule = await native.createNative(access.guild, {
            template: body.template, pack: body.pack, kind: body.kind, options: body.options && typeof body.options === 'object' ? body.options : {},
            presets: Array.isArray(body.presets) ? body.presets : [], mentionLimit: body.mentionLimit, block: body.block !== false,
            alertChannelId: id(body.alertChannelId), timeoutMinutes: body.timeoutMinutes, customMessage: typeof body.customMessage === 'string' ? body.customMessage : '',
            exemptRoleIds: ids(body.exemptRoleIds), exemptChannelIds: ids(body.exemptChannelIds),
          });
          res.json({ ok: true, rule, ...(await native.listNative(access.guild)) });
          return;
        }
        if (op === 'toggle') await native.setNativeEnabled(access.guild, String(body.id), body.enabled === true);
        else if (op === 'delete') await native.deleteNative(access.guild, String(body.id));
        res.json({ ok: true, ...(await native.listNative(access.guild)) });
      } catch (err) {
        if (err.userFacing) { res.status(400).json({ ok: false, message: err.message }); return; }
        logger.error(`Dashboard native automod failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: 'Discord did not answer the AutoMod request. Try again.' });
      }
    });

    // Lockdown from the dashboard: start or end it now. Administrators only, the same as the command.
    app.post('/api/dashboard/guild/:guildId/lockdown', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      try {
        if (!access.member.permissions.has(PermissionFlagsBits.Administrator)) { res.status(403).json({ ok: false, message: 'Only administrators can start or end a lockdown.' }); return; }
        const lockdown = require('../utils/lockdown');
        const op = String(req.body?.op ?? '');
        if (op === 'start') {
          const minutes = Math.max(0, Math.min(10080, Math.floor(Number(req.body?.minutes)) || 0)) || null;
          const result = await lockdown.startLockdown(access.guild, { startedBy: access.userId, reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 300) : null, minutes });
          res.json({ ok: true, ...result });
          return;
        }
        if (op === 'end') {
          res.json({ ok: true, ...(await lockdown.endLockdown(access.guild, { endedBy: access.userId })) });
          return;
        }
        res.status(400).json({ ok: false, message: 'That is not something I can do.' });
      } catch (err) {
        if (err.userFacing) { res.status(400).json({ ok: false, message: err.message }); return; }
        logger.error(`Dashboard lockdown failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: 'The lockdown could not be changed. Try again.' });
      }
    });

    // Lifts an active sanction (ban, mute or jail) from its case. Needs the permission the command needs.
    app.post('/api/dashboard/guild/:guildId/moderation/lift', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      try {
        const { liftSanction } = require('../utils/sanctionLift');
        const modCase = require('../db/modActions');
        const row = await modCase.getCase(access.guild.id, Number(req.body?.case));
        if (!row) { res.status(404).json({ ok: false, message: 'That case does not exist.' }); return; }
        const needs = ['ban', 'tempban', 'hardban'].includes(row.type) ? PermissionFlagsBits.BanMembers : PermissionFlagsBits.ModerateMembers;
        if (!access.member.permissions.has(needs) && !access.member.permissions.has(PermissionFlagsBits.Administrator)) { res.status(403).json({ ok: false, message: 'You need the same permission as the command to lift this.' }); return; }
        const result = await liftSanction(access.guild, row.case_number, access.member.user, typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 300) : null);
        res.json({ ok: true, ...result });
      } catch (err) {
        if (err.userFacing) { res.status(400).json({ ok: false, message: err.message }); return; }
        logger.error(`Dashboard lift failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: 'It could not be lifted. Check my permissions and try again.' });
      }
    });

    // The panel of confessions (the button that opens the form), posted or updated now from the dashboard.
    app.post('/api/dashboard/guild/:guildId/confessions/panel', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      try {
        const config = await confessionsDb.getConfig(access.guild.id);
        const channelId = typeof req.body?.channel_id === 'string' && /^\d{5,25}$/.test(req.body.channel_id) ? req.body.channel_id : config.panel_channel_id || config.channel_id;
        if (!channelId) { res.status(400).json({ ok: false, message: 'Pick a channel for the panel first.' }); return; }
        const result = await postConfessionPanel(access.guild, config, channelId);
        res.status(result.ok ? 200 : 400).json(result);
      } catch (err) {
        logger.error(`Dashboard confession panel failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: 'The panel could not be posted. Try again.' });
      }
    });

    // The verification, done now instead of waiting for the panel job: `setup` makes the roles, the channel and the panel; `panel` posts it; `enable` / `disable` switch it.
    app.post('/api/dashboard/guild/:guildId/verification/:action', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      const action = String(req.params.action);
      try {
        let result;
        if (action === 'setup') result = await setupEverything(access.guild);
        else if (action === 'panel') result = await sendPanelNow(access.guild);
        else if (action === 'enable' || action === 'disable') result = await setEnabled(access.guild, action === 'enable');
        else { res.status(404).json({ ok: false, error: 'unknown_action' }); return; }
        res.status(result.ok ? 200 : 400).json(result);
      } catch (err) {
        logger.error(`Dashboard verification ${action} failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: 'The verification could not be changed. Try again.' });
      }
    });

    // Sends the quest method of a server now, from the dashboard (the newest active quest, or the one given), in its thread or channel.
    app.post('/api/dashboard/guild/:guildId/quests/method', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      if (!canUseQuests(access.userId)) { res.status(403).json({ ok: false, error: 'no_access', message: 'Quest alerts are in testing.' }); return; }
      try {
        const settings = (await questsDb.getConfig(access.guild.id)) ?? questsDb.DEFAULTS;
        const questId = typeof req.body?.quest_id === 'string' && /^[\w-]{1,64}$/.test(req.body.quest_id) ? req.body.quest_id : null;
        const result = await sendMethodNow(access.guild, { ...settings, guild_id: access.guild.id }, { questId });
        res.status(result.ok ? 200 : 400).json({ ok: result.ok, message: result.message });
      } catch (err) {
        logger.error(`Dashboard quest method failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, error: 'method_failed', message: 'The method could not be sent. Try again.' });
      }
    });

    // The message of a poll as the bot draws it (the default card or a saved V2 design), for the dashboard to post or update.
    app.post('/api/dashboard/guild/:guildId/poll-message', dashboardDatabaseRateLimiter, async (req, res) => {
      if (!dashboardAuthorized(req)) {
        res.status(401).json({ ok: false, error: 'unauthorized' });
        return;
      }
      const guildId = String(req.params.guildId || '');
      if (!/^\d{15,25}$/.test(guildId)) {
        res.status(400).json({ ok: false, error: 'invalid_guild' });
        return;
      }
      try {
        const payload = await renderPollRequest(client.guilds.cache.get(guildId) ?? null, req.body);
        if (!payload) {
          res.status(400).json({ ok: false, error: 'invalid_poll' });
          return;
        }
        res.json({ ok: true, payload });
      } catch (err) {
        logger.error(`Dashboard poll message failed for guild ${guildId}:`, err);
        res.status(500).json({ ok: false, error: 'render_failed' });
      }
    });

    registerCardRoutes(app, { authorize: dashboardCardAccess });
    registerCodeRoutes(app, { authorize: dashboardCardAccess });
    registerIdentityRoutes(app, { authorize: dashboardCardAccess });
    // Names and avatars of members for the dashboard pages, from the gateway instead of one REST call per person.
    registerMemberRoutes(app, { isAuthorized: dashboardAuthorized, authorize: dashboardCardAccess, limiter: dashboardDatabaseRateLimiter });
    // The public leaderboard page of a server that turned it on, asked for by the website.
    registerPublicLeaderboardRoute(app, { isAuthorized: dashboardAuthorized, limiter: dashboardDatabaseRateLimiter, client });

    app.post('/api/dashboard/guild/:guildId/prefix', dashboardPrefixRateLimiter, async (req, res) => {
      if (!dashboardAuthorized(req)) {
        res.status(401).json({ ok: false, error: 'unauthorized' });
        return;
      }

      const guildId = String(req.params.guildId || '');
      const rawPrefix = req.body?.prefix;
      if (!/^\d{15,25}$/.test(guildId) || typeof rawPrefix !== 'string') {
        res.status(400).json({ ok: false, error: 'invalid_prefix_request' });
        return;
      }

      const prefix = rawPrefix.trim().slice(0, 5) || '!';
      try {
        await client.guilds.fetch(guildId);
        setCachedPrefix(guildId, prefix);
        res.json({ ok: true, prefix });
      } catch (err) {
        logger.error(`Dashboard could not sync prefix for guild ${guildId}:`, err);
        res.status(404).json({ ok: false, error: 'guild_unavailable' });
      }
    });

    app.get('/api/dashboard/vault/:guildId', async (req, res) => {
      const authorized = await dashboardGuild(req, res);
      if (!authorized) return;
      try {
        res.json({ ok: true, ...(await dashboardVaultData(req.params.guildId)) });
      } catch (err) {
        logger.error('Dashboard failed to load Vault data:', err);
        res.status(500).json({ ok: false, error: 'vault_unavailable' });
      }
    });

    app.post('/api/dashboard/vault/:guildId', async (req, res) => {
      const authorized = await dashboardGuild(req, res);
      if (!authorized) return;
      const { guild, userId } = authorized;
      const action = String(req.body?.action || '');
      try {
        if (action === 'create') {
          await Promise.all([guild.roles.fetch(), guild.channels.fetch(), guild.emojis.fetch()]);
          const snapshot = buildSnapshot(guild);
          const saved = await createBackup(guild.id, userId, String(req.body?.label || '').trim() || null, snapshot);
          await recordAudit(guild.id, userId, 'backup_created', saved.backup_number, { source: saved.source || 'manual', label: saved.label });
        } else if (action === 'restore') {
          if (!authorized.isAdministrator) {
            res.status(403).json({ ok: false, error: 'administrator_required' });
            return;
          }
          const backupNumber = Number(req.body?.backup_id);
          const mode = String(req.body?.mode || 'merge');
          if (!Number.isInteger(backupNumber) || backupNumber < 1 || !['merge', 'replace'].includes(mode) || req.body?.confirm !== true) {
            res.status(400).json({ ok: false, error: 'restore_confirmation_required' });
            return;
          }
          const backup = await getBackup(guild.id, backupNumber);
          if (!backup) {
            res.status(404).json({ ok: false, error: 'backup_not_found' });
            return;
          }
          const safety = await createBackup(guild.id, userId, `Before restoring backup #${backupNumber}`, buildSnapshot(guild), 'manual');
          await recordAudit(guild.id, userId, 'backup_created', safety.backup_number, {
            source: 'manual',
            purpose: 'restore_safety',
            beforeBackupNumber: backupNumber,
          });
          const restoreResult = await restoreBackup(guild, backup.snapshot, { mode, reason: `Petto dashboard restore #${backupNumber}` });
          await recordAudit(guild.id, userId, 'backup_restored', backupNumber, { mode, safetyBackupNumber: safety.backup_number, result: restoreResult });
        } else if (action === 'schedule') {
          const hours = Number(req.body?.hours);
          const retention = Number(req.body?.retention || 7);
          if (!Number.isInteger(hours) || hours < 1 || hours > 168 || !Number.isInteger(retention) || retention < 1 || retention > 30) {
            res.status(400).json({ ok: false, error: 'invalid_schedule' });
            return;
          }
          await vault.upsertSchedule(guild.id, hours, retention, userId);
          await vault.recordAudit(guild.id, userId, 'schedule_updated', null, { intervalHours: hours, retentionCount: retention });
        } else if (action === 'unschedule') {
          if (await vault.removeSchedule(guild.id)) await vault.recordAudit(guild.id, userId, 'schedule_disabled');
        } else {
          res.status(400).json({ ok: false, error: 'unknown_action' });
          return;
        }
        res.json({ ok: true, ...(await dashboardVaultData(guild.id)) });
      } catch (err) {
        logger.error(`Dashboard Vault action failed for guild ${guild.id}:`, err);
        res.status(500).json({ ok: false, error: 'vault_action_failed' });
      }
    });

    app.get('/api/dashboard/vault/:guildId/export/:backupId', async (req, res) => {
      const authorized = await dashboardGuild(req, res);
      if (!authorized) return;
      try {
        const backup = await getBackup(req.params.guildId, req.params.backupId);
        if (!backup) {
          res.status(404).json({ ok: false, error: 'backup_not_found' });
          return;
        }
        await recordAudit(req.params.guildId, authorized.userId, 'backup_exported', backup.backup_number, { source: backup.source || 'manual' });
        res.set('Content-Disposition', `attachment; filename="petto-backup-${req.params.guildId}-${backup.backup_number}.json"`);
        res.json(backup.snapshot);
      } catch (err) {
        logger.error('Dashboard failed to export Vault backup:', err);
        res.status(500).json({ ok: false, error: 'backup_export_failed' });
      }
    });
  }

  if (votesEnabled) {
    // Votes for the bot on top.gg (v1 webhook). The URL to save in top.gg is https://<this host>/webhooks/topgg.
    app.post('/webhooks/topgg', topggRateLimiter, createTopggHandler(client));
  }

  app.get('/', (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8').send(renderHomePage({ guildCount: client.guilds.cache.size }));
  });

  app.get('/verify/:token', verifyPageRateLimiter, async (req, res) => {
    // The page shows the check the server chose and its name, and speaks the language of the visitor.
    const payload = verifyToken(req.params.token);
    const settings = payload ? await getConfig(payload.guildId).catch(() => null) : null;
    const guild = payload ? client.guilds.cache.get(payload.guildId) : null;
    res.set('Content-Type', 'text/html; charset=utf-8').send(renderVerifyPage({
      token: req.params.token,
      siteKey: config.turnstileSiteKey,
      method: methodOf(settings),
      guildName: guild?.name ?? null,
      guildIcon: guild?.iconURL?.({ size: 64, extension: 'png' }) ?? null,
      lang: pickLanguage(req.get('accept-language')),
    }));
  });

  // A new picture of letters for the letters method: the PNG as a data link and the signed ticket the page sends back with the answer.
  app.post('/api/verify/captcha', verifyCaptchaRateLimiter, async (req, res) => {
    const payload = verifyToken(req.body?.token);
    if (!payload) {
      res.status(400).json({ ok: false, error: 'This verification link is invalid or has expired. Rejoin the server to get a new one.' });
      return;
    }
    try {
      const settings = await getConfig(payload.guildId);
      if (!usesLetters(methodOf(settings))) {
        res.status(400).json({ ok: false, error: 'This server does not use the letters check.' });
        return;
      }
      if (await isRedeemed(payload.jti)) {
        res.status(400).json({ ok: false, error: "You've already verified with this link." });
        return;
      }
      const challenge = createChallenge(payload.jti);
      res.set('Cache-Control', 'no-store').json({ ok: true, image: `data:image/png;base64,${challenge.png.toString('base64')}`, ticket: challenge.ticket });
    } catch (err) {
      logger.error('Failed to make a verification picture:', err);
      res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
    }
  });

  app.post('/api/verify', createRateLimiter({ windowMs: 60_000, max: 20 }), async (req, res) => {
    const { token, turnstileToken } = req.body ?? {};

    const payload = verifyToken(token);
    if (!payload) {
      res.status(400).json({ ok: false, error: 'This verification link is invalid or has expired. Rejoin the server to get a new one.' });
      return;
    }

    // Single-use: once a token's jti has been redeemed, the (still validly-signed)
    // link is dead rather than reusable for the rest of its 24h lifetime.
    try {
      if (await isRedeemed(payload.jti)) {
        res.status(400).json({ ok: false, error: "You've already verified with this link. You should already have access, if not, contact a moderator." });
        return;
      }
    } catch (err) {
      logger.error('Failed to check token redemption status:', err);
      res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
      return;
    }

    let method;
    try {
      method = methodOf(await getConfig(payload.guildId));
    } catch (err) {
      logger.error('Failed to read the verification settings:', err);
      res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
      return;
    }

    // The letters are checked first: it is cheap, and a wrong answer must not use up the Cloudflare check.
    if (usesLetters(method)) {
      const answer = checkAnswer(payload.jti, req.body?.captchaTicket, req.body?.captchaAnswer);
      if (!answer.ok) {
        const text = { wrong: 'Those letters are not right.', locked: 'Too many wrong tries. Wait a few minutes and open the link again.', expired: 'The picture expired.', invalid: 'The picture is not valid. Ask for a new one.' }[answer.reason];
        res.status(400).json({ ok: false, code: answer.reason, error: text });
        return;
      }
    }

    if (usesTurnstile(method)) {
      if (!config.turnstileSecretKey) {
        res.status(500).json({ ok: false, error: 'This server uses the Cloudflare check, but it is not set up. Contact a moderator.' });
        return;
      }
      if (!turnstileToken) {
        res.status(400).json({ ok: false, error: 'Captcha response missing.' });
        return;
      }

      let turnstileResult;
      try {
        turnstileResult = await checkTurnstile(turnstileToken, req.ip);
      } catch (err) {
        logger.error('Turnstile verification request failed:', err);
        res.status(502).json({ ok: false, error: 'Could not reach the captcha service. Try again.' });
        return;
      }

      if (!turnstileResult.success) {
        res.status(400).json({ ok: false, error: 'Captcha check failed. Please try again.' });
        return;
      }
    }

    try {
      const guild = await client.guilds.fetch(payload.guildId);
      const member = await guild.members.fetch(payload.userId);
      const verifyConfig = await getConfig(payload.guildId);

      // The initial read above is only a fast path. Claim immediately before
      // mutating Discord so two concurrent submissions cannot both verify the
      // same token.
      const claimed = await claimRedemption({ jti: payload.jti, guildId: payload.guildId, userId: payload.userId });
      if (!claimed) {
        res.status(400).json({ ok: false, error: "You've already verified with this link. You should already have access, if not, contact a moderator." });
        return;
      }

      try {
        if (verifyConfig?.unverified_role_id && member.roles.cache.has(verifyConfig.unverified_role_id)) {
          await member.roles.remove(verifyConfig.unverified_role_id, 'Passed verification');
        }
        if (verifyConfig?.verified_role_id) {
          await member.roles.add(verifyConfig.verified_role_id, 'Passed verification');
        }
      } catch (err) {
        await releaseRedemption(payload.jti).catch((releaseErr) => logger.error('Failed to release verification claim after role failure:', releaseErr));
        throw err;
      }

      res.json({ ok: true });

      // Best-effort follow-up work, the member's already verified at this point,
      // so none of this should turn a real success into an error response.
      await logVerification(client, guild, member.user).catch((err) => logger.error('Failed to log verification:', err));
      await sendVerifiedDM(member, { guild })
        .catch(() => logger.warn(`Could not DM verified confirmation to ${member.id} in guild ${guild.id}.`));
    } catch (err) {
      logger.error('Failed to apply verification roles:', err);
      res.status(500).json({ ok: false, error: 'Verified, but I was unable to update your roles. Contact a moderator.' });
    }
  });

  // Public transcript viewer, the URL's guildId/number are cosmetic (so a link is human-readable
  // at a glance); actual access is entirely gated by the signed token, checked against the same
  // ticket row to make sure they weren't just edited to browse a different ticket.
  app.get('/transcript/:guildId/:number/:token', async (req, res) => {
    const payload = verifyTranscriptToken(req.params.token);
    if (!payload) {
      res.status(403).send('Invalid or tampered transcript link.');
      return;
    }

    try {
      const ticket = await getTicketById(payload.ticketId);
      if (!ticket || ticket.guild_id !== req.params.guildId || String(ticket.ticket_number) !== req.params.number) {
        res.status(404).send('Transcript not found.');
        return;
      }
      if (!ticket.transcript_html) {
        res.status(404).send('No transcript has been generated for this ticket yet.');
        return;
      }
      res.set('Content-Type', 'text/html; charset=utf-8').send(ticket.transcript_html);
    } catch (err) {
      logger.error('Failed to serve ticket transcript:', err);
      res.status(500).send('Something went wrong loading this transcript.');
    }
  });

  app.use((req, res) => {
    // Keep machine-facing endpoints JSON even when a route is unavailable. The
    // dashboard expects JSON and should never receive Express's plain-text 404.
    if (req.path.startsWith('/api/') || req.path.startsWith('/rest/v1/')) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    res.status(404).send('Not found.');
  });

  app.listen(config.webPort, () => {
    logger.info(`Verification web server listening on port ${config.webPort} (public: ${config.verifyBaseUrl}).`);
  });

  return app;
}

module.exports = { startServer };
