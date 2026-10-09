const express = require('express');
const { rateLimit } = require('express-rate-limit');
const path = require('path');
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const { verifyToken } = require('../utils/verifyToken');
const { verifyTranscriptToken } = require('../utils/transcriptToken');
const { getConfig } = require('../db/verificationConfig');
const { isRedeemed, claimRedemption, releaseRedemption } = require('../db/verificationRedemptions');
const { getTicketById } = require('../db/tickets');
const { logVerification } = require('../utils/verificationLog');
const { sendVerifiedDM } = require('../utils/verifyMessage');
const { createBackup, listBackups, getBackup, recordAudit, vault } = require('../db/backups');
const { restoreBackup } = require('../utils/backupRestore');
const { buildSnapshot } = require('../commands/config/backup');
const { renderVerifyPage } = require('./verifyPage');
const { renderHomePage } = require('./homePage');
const { setCachedPrefix } = require('../events/messageCreateCommands');
const { registerDashboardRestRoutes } = require('./dashboardDatabase');
const { registerCardRoutes } = require('./cardRoutes');
const { registerCodeRoutes } = require('./codeRoutes');
const { registerIdentityRoutes } = require('./identityRoutes');
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
  const verificationEnabled = Boolean(config.verifyBaseUrl && config.turnstileSiteKey && config.turnstileSecretKey && config.verifyTokenSecret);
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

  app.get('/verify/:token', (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8').send(renderVerifyPage({ token: req.params.token, siteKey: config.turnstileSiteKey }));
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
          await member.roles.remove(verifyConfig.unverified_role_id, 'Passed Turnstile verification');
        }
        if (verifyConfig?.verified_role_id) {
          await member.roles.add(verifyConfig.verified_role_id, 'Passed Turnstile verification');
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
