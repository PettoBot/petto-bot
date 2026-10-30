const confessionsDb = require('../db/confessions');
const suggestionsUtil = require('../utils/suggestions');
const { postPanel: postConfessionPanel } = require('../interactions/confessions');
const express = require('express');
const websub = require('../feeds/websub');
const { saveGuildSnapshot } = require('../utils/guildSnapshots');
const { rateLimit } = require('express-rate-limit');
const path = require('path');
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const { setEnabled } = require('../utils/verifyProvision');
const verifyJobs = require('../utils/verifyJobs');
const { linkProblem, warnOperator } = require('../utils/verifyLink');
const { verifyToken } = require('../utils/verifyToken');
const { verifyTranscriptToken } = require('../utils/transcriptToken');
const { getConfig } = require('../db/verificationConfig');
const { isRedeemed, claimRedemption, releaseRedemption } = require('../db/verificationRedemptions');
const { getTicketById, getTicketByNumber } = require('../db/tickets');
const { logVerification } = require('../utils/verificationLog');
const { sendVerifiedDM } = require('../utils/verifyMessage');
const { createBackup, listBackups, getBackup, deleteBackup, deleteAllBackups, recordAudit, vault } = require('../db/backups');
const { planRestore, restoreParts, backupContents } = require('../utils/backupRestore');
const backupJobs = require('../utils/backupJobs');
const { buildFullSnapshot } = require('../commands/config/backup');
const { renderVerifyPage } = require('./verifyPage');
const { createChallenge, checkAnswer } = require('../utils/verifyCaptcha');
const { methodOf, usesTurnstile, usesLetters } = require('../utils/verifyMethod');
const { renderHomePage } = require('./homePage');
const { setCachedPrefix } = require('../events/messageCreateCommands');
const guildPrefixes = require('../utils/guildPrefixes');
const { ensureGuild, updateGuild } = require('../db/guilds');
const { registerDashboardRestRoutes } = require('./dashboardDatabase');
const { registerCardRoutes } = require('./cardRoutes');
const { registerAppealImageRoutes } = require('./appealImageRoutes');
const { registerCodeRoutes } = require('./codeRoutes');
const { registerIdentityRoutes } = require('./identityRoutes');
const { registerMemberRoutes } = require('./memberRoutes');
const { registerFormRoutes } = require('./formRoutes');
const { registerCounterRoutes } = require('./counterRoutes');
const { registerFeedRoutes } = require('./feedRoutes');
const { registerHoneypotRoutes } = require('./honeypotRoutes');
const { registerPaginationRoutes } = require('./paginationRoutes');
const { registerInviteRoutes } = require('./inviteRoutes');
const { registerCaseRoutes } = require('./caseRoutes');
const { registerTimerRoutes } = require('./timerRoutes');
const { registerBoosterRoleRoutes } = require('./boosterRoleRoutes');
const { registerTicketLiveRoutes } = require('./ticketLiveRoutes');
const { fetchDashboardMember } = require('./dashboardMember');
const { roleGrantAllows } = require('./dashboardRoleAccess');
const { supportOwnerAllows } = require('./supportOwner');
const { registerGuildLanguageRoute } = require('./languageRoutes');
const { refreshGuildPanels } = require('../utils/panelRefresh');
const { registerPublicLeaderboardRoute } = require('./publicLeaderboard');
const { listVariables } = require('../utils/embedVariableRegistry');
const { renderPollRequest } = require('../utils/pollApi');
const { sendMethodNow } = require('../utils/questMethod');
const { canUseQuests } = require('../utils/questAlerts');
const questsDb = require('../db/quests');
const { runGiveawayAction } = require('../utils/giveawayApi');
const { createTopggHandler } = require('../utils/voteWebhook');
const logger = require('../utils/logger');
const { t, requestLanguage, peekGuildLanguage, runWithLanguage } = require('../i18n');

const SNOWFLAKE = /^\d{15,25}$/;

async function checkTurnstile(responseToken, remoteIp) {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: config.turnstileSecretKey, response: responseToken, remoteip: remoteIp ?? '' }),
  });
  return res.json();
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
  handler: (req, res) => {
    res.status(429).type('text/plain').send(t(requestLanguage(req), 'web.limit.verifyPage'));
  },
});

const verifyCaptchaRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ ok: false, error: t(requestLanguage(req), 'web.limit.captcha') });
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

// YouTube push: the hub calls once for each new entry of the channels followed (and once to confirm each subscription), so a few hundred a minute can be normal.
const youtubePushRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ ok: false, error: 'rate_limited' });
  },
});

// Each visitor can try the verification a few times a minute.
const verifyRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ ok: false, error: 'rate_limited' });
  },
});

// The public page of a ticket transcript opens with its signed link; a visitor cannot ask for it over and over.
const transcriptRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).send(t(requestLanguage(req, SNOWFLAKE.test(req.params?.guildId ?? '') ? req.params.guildId : null), 'web.limit.transcript'));
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
  // Said once at start when members cannot be given a verification link that opens (also on the dashboard's verification card).
  if (linkProblem()) warnOperator(linkProblem());
  if (!verificationEnabled && !dashboardEnabled && !votesEnabled) {
    logger.warn('Verification and dashboard API env vars are not fully set, web server not started.');
    return null;
  }

  const app = express();
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  app.disable('x-powered-by');
  app.set('trust proxy', Number.isInteger(proxyHops) && proxyHops >= 0 ? proxyHops : 1); // i18n-ignore: Express setting
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
      // Not in the server (a developer's read-only view of it): no access, quietly.
      const member = await fetchDashboardMember(guild, userId);
      const canManage = Boolean(member) && (member.permissions.has(PermissionFlagsBits.ManageGuild) || member.permissions.has(PermissionFlagsBits.Administrator));
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

  // The same check as the Vault routes without needing the Vault: the person must manage the server. Routes of a page that "Dashboard
  // access" by role can open (counters, forms) pass `{ page, edit }`: a member without Manage Server is let in when the site vouches for
  // them on that page and the bot's own reading of the rules and of their roles agrees (dashboardRoleAccess.js).
  async function dashboardCardAccess(req, res, { page = null, edit = true } = {}) {
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
      // Not in the server (a developer's read-only view of it): no access, quietly.
      const member = await fetchDashboardMember(guild, userId);
      const canManage = Boolean(member) && (member.permissions.has(PermissionFlagsBits.ManageGuild) || member.permissions.has(PermissionFlagsBits.Administrator));
      if (!canManage) {
        // The Petto owner's support mode: only the routes of supportOwner.js, never a general bypass.
        if (supportOwnerAllows(req, userId, guild.id)) return { guild, member, userId, viaSupport: true };
        const byRole = page && member ? await roleGrantAllows({ guildId: guild.id, member, page, grant: req.get('x-petto-dashboard-grant'), needEdit: edit }) : false;
        if (!byRole) {
          res.status(403).json({ ok: false, error: 'no_access' });
          return null;
        }
        return { guild, member, userId, viaRole: true };
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
    return { backups, schedule, audit, restoreJob: backupJobs.describeJob(backupJobs.getJob(guildId)) };
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
      res.set('Cache-Control', 'private, max-age=300'); // i18n-ignore: HTTP header
      res.json({ ok: true, groups: listVariables(requestLanguage(req)) });
    });

    // Start, edit, end or reroll a giveaway from the dashboard. The person must manage the server; the host of a new giveaway is that person.
    app.post('/api/dashboard/guild/:guildId/giveaway/:action', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      const lang = requestLanguage(req, access.guild.id);
      try {
        const result = await runGiveawayAction(client, access.guild.id, String(req.params.action), { ...req.body, host_id: access.userId }, lang);
        const { status, ...body } = result;
        res.status(result.ok ? 200 : status ?? 400).json(body);
      } catch (err) {
        logger.error(`Dashboard giveaway ${req.params.action} failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, error: 'giveaway_failed', message: t(lang, 'web.api.giveawayFailed') });
      }
    });

    // The answer of the staff to a suggestion from the dashboard: approve, deny, consider, implement or take it back to pending.
    app.post('/api/dashboard/guild/:guildId/suggestions/answer', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      const lang = requestLanguage(req, access.guild.id);
      try {
        const id = String(req.body?.id ?? '').trim().toLowerCase();
        const status = String(req.body?.status ?? '');
        if (!/^[a-z0-9]{5}-[a-z0-9]{5}$/.test(id) || !suggestionsUtil.STATUSES[status]) { res.status(400).json({ ok: false, message: t(lang, 'web.api.suggestions.invalid') }); return; }
        const member = await access.guild.members.fetch(access.userId).catch(() => null);
        const result = await suggestionsUtil.answer({ guild: access.guild, member, id, status, reason: req.body?.reason });
        if (result.error) { res.status(400).json({ ok: false, message: result.error }); return; }
        res.json({ ok: true, message: t(lang, 'web.api.suggestions.now', { status: suggestionsUtil.statusLabel(status, lang).toLocaleLowerCase(lang) }) });
      } catch (err) {
        logger.error(`Dashboard suggestion answer failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: t(lang, 'web.api.suggestions.answerFailed') });
      }
    });

    // Who voted a suggestion, for the dashboard (the staff only, the same as the command).
    app.post('/api/dashboard/guild/:guildId/suggestions/votes', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      const lang = requestLanguage(req, access.guild.id);
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
        res.status(500).json({ ok: false, message: t(lang, 'web.api.suggestions.votesFailed') });
      }
    });

    // The link to the saved transcript of a ticket, for the "Closed" list of the dashboard (the same signed link the log shows).
    app.post('/api/dashboard/guild/:guildId/tickets/transcript', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      const lang = requestLanguage(req, access.guild.id);
      try {
        const number = Number(req.body?.number);
        const ticket = Number.isInteger(number) && number > 0 ? await getTicketByNumber(access.guild.id, number) : null;
        if (!ticket) { res.status(404).json({ ok: false, message: t(lang, 'web.api.tickets.notFound') }); return; }
        if (!ticket.transcript_html) { res.status(404).json({ ok: false, message: t(lang, 'web.api.tickets.noTranscript') }); return; }
        const link = require('../utils/ticketActions').buildTranscriptLink({ guild: access.guild, ticket });
        if (!link) { res.status(400).json({ ok: false, message: t(lang, 'web.api.tickets.noViewer') }); return; }
        res.json({ ok: true, link });
      } catch (err) {
        logger.error(`Dashboard ticket transcript failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: t(lang, 'web.api.tickets.transcriptFailed') });
      }
    });

    // Puts back what an anti-nuke protection stopped (channels, roles, bans, the roles taken away). Owner and administrators only.
    app.post('/api/dashboard/guild/:guildId/antinuke/restore', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      const lang = requestLanguage(req, access.guild.id);
      try {
        const { canRestore, restoreEvent } = require('../utils/antiNukeRestore');
        const antinukeDb = require('../db/antinuke');
        if (!canRestore(access.member, await antinukeDb.getConfig(access.guild.id).catch(() => null))) { res.status(403).json({ ok: false, message: t(lang, 'web.api.antinuke.ownerOnly') }); return; }
        const event = await antinukeDb.getEvent(access.guild.id, Number(req.body?.id));
        if (!event) { res.status(404).json({ ok: false, message: t(lang, 'web.api.antinuke.notFound') }); return; }
        if (event.restored_at) { res.status(400).json({ ok: false, message: t(lang, 'web.api.antinuke.alreadyRestored') }); return; }
        const { done, failed } = await restoreEvent(access.guild, event, lang);
        if (!failed.length) await antinukeDb.markRestored(access.guild.id, event.id);
        res.json({ ok: failed.length === 0, done, failed, message: failed.length ? failed.join(' ') : undefined });
      } catch (err) {
        logger.error(`Dashboard anti-nuke restore failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: t(lang, 'web.api.antinuke.failed') });
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
      res.set('Cache-Control', 'private, max-age=60'); // i18n-ignore: HTTP header
      res.json({ ok: true, guild: { id: access.guild.id, name: access.guild.name, icon: access.guild.iconURL({ extension: 'png', size: 128 }) ?? null, members: access.guild.memberCount ?? null } });
    });

    // The punishments of the member in the server, as the server wants them shown, and whether they are blocked from appealing.
    app.get('/api/appeals/:guildId/punishments', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await appealAccess(req, res);
      if (!access) return;
      try {
        const appealsDb = require('../db/appeals');
        const { fetchPunishments, shapePunishment, appealOpensAt } = require('../utils/appeals');
        const rows = await fetchPunishments(access.guild, access.user.id, access.config);
        const block = await appealsDb.getBlock(access.guild.id, access.user.id);
        // `opensAt`: the server asks to wait after a punishment before appealing it, and the member can appeal from then.
        res.json({ ok: true, punishments: rows.map((p) => shapePunishment(p, access.config)), blocked: Boolean(block), blockedUntil: block?.until ?? null, opensAt: appealOpensAt(rows, access.config) });
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

    // The files a member attaches to the answers of a form: uploaded while the form is filled, tied to the submission when it is sent.
    const sendAppealFile = (res, file) => {
      const image = file.mime.startsWith('image/');
      res.set({
        'Content-Type': file.mime, // i18n-ignore: HTTP header
        'Content-Disposition': `${image ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`, // i18n-ignore: HTTP header
        'X-Content-Type-Options': 'nosniff', // i18n-ignore: HTTP header
        'Content-Security-Policy': "default-src 'none'; sandbox", // i18n-ignore: HTTP header
        'Cache-Control': 'private, no-store', // i18n-ignore: HTTP header
        'X-Petto-File-Name': encodeURIComponent(file.name), // i18n-ignore: HTTP header
      }).send(file.bytes);
    };

    app.post('/api/appeals/:guildId/files', dashboardDatabaseRateLimiter, express.raw({ type: () => true, limit: '5.5mb' }), async (req, res) => {
      const access = await appealAccess(req, res);
      if (!access) return;
      if (appealLimited(`file:${access.user.id}`, 30, 10 * 60_000)) { res.status(429).json({ ok: false, error: 'rate_limited' }); return; }
      try {
        const appealsDb = require('../db/appeals');
        const filesDb = require('../db/appealFiles');
        const { prepareFile, MAX_LOOSE } = require('../utils/appealFile');
        const formId = Number(req.query.form_id);
        const questionId = String(req.query.question_id || '');
        const form = Number.isInteger(formId) ? await appealsDb.getForm(access.guild.id, formId) : null;
        if (!access.config.enabled || !form || form.status !== 'live') { res.status(404).json({ ok: false, error: 'form_unavailable' }); return; }
        const question = (form.sections ?? []).flatMap((section) => section.questions ?? []).find((q) => q.id === questionId && q.type === 'file');
        if (!question) { res.status(400).json({ ok: false, error: 'unknown_question' }); return; }
        const sameQuestion = await filesDb.listLoose(access.guild.id, access.user.id, formId, questionId);
        if (sameQuestion.length >= (question.max_files ?? 3) || await filesDb.countLoose(access.guild.id, access.user.id) >= MAX_LOOSE) { res.status(409).json({ ok: false, error: 'too_many_files' }); return; }
        let prepared;
        try {
          // The body is bytes only when it came as raw bytes; it is copied, so what the checks read is a Buffer and nothing else.
          const upload = Buffer.isBuffer(req.body) ? Buffer.from(req.body) : Buffer.alloc(0);
          prepared = await prepareFile(upload, { accept: question.accept, name: String(req.query.name || 'file') });
        } catch (err) {
          const code = { too_big: 413, unsupported: 415 }[err.message] ?? 400;
          res.status(code).json({ ok: false, error: ['too_big', 'unsupported'].includes(err.message) ? err.message : 'unreadable' }); // i18n-ignore: an error code for the website
          return;
        }
        const row = await filesDb.createFile({ guildId: access.guild.id, userId: access.user.id, formId, questionId, name: prepared.name, mime: prepared.mime, bytes: prepared.bytes });
        res.json({ ok: true, file: { id: row.id, name: row.name, mime: row.mime, size: row.size, question_id: row.question_id } });
      } catch (err) {
        logger.error(`Appeal file upload failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, error: 'failed' });
      }
    });

    app.delete('/api/appeals/:guildId/files/:fileId', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await appealAccess(req, res);
      if (!access) return;
      try {
        res.json({ ok: true, removed: await require('../db/appealFiles').removeLoose(access.guild.id, access.user.id, String(req.params.fileId)) });
      } catch (err) {
        logger.error(`Appeal file removal failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, error: 'failed' });
      }
    });

    // A file the member uploaded or sent: only they can read it here (the staff read it from the dashboard).
    app.get('/api/appeals/:guildId/files/:fileId', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await appealAccess(req, res);
      if (!access) return;
      try {
        const file = await require('../db/appealFiles').getFile(access.guild.id, String(req.params.fileId));
        if (!file || file.user_id !== access.user.id) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
        sendAppealFile(res, file);
      } catch (err) {
        logger.error(`Appeal file read failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, error: 'failed' });
      }
    });

    app.get('/api/dashboard/guild/:guildId/appeals/files/:fileId', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      try {
        const file = await require('../db/appealFiles').getFile(access.guild.id, String(req.params.fileId));
        if (!file || !file.submission_id) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
        sendAppealFile(res, file);
      } catch (err) {
        logger.error(`Dashboard appeal file read failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, error: 'failed' });
      }
    });

    // The staff, from the dashboard: accept or reject an appeal, or write to the member.
    app.post('/api/dashboard/guild/:guildId/appeals/resolve', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      const lang = requestLanguage(req, access.guild.id);
      try {
        const appealsDb = require('../db/appeals');
        const { resolveAppeal } = require('../utils/appeals');
        const submission = await appealsDb.getSubmission(access.guild.id, String(req.body?.id ?? ''));
        if (!submission) { res.status(404).json({ ok: false, message: t(lang, 'web.api.appeals.notFound') }); return; }
        const result = await resolveAppeal({ client, guild: access.guild, submission, status: String(req.body?.status ?? ''), moderatorId: access.userId, moderatorName: access.member.displayName, reason: req.body?.reason });
        if (!result.ok) { res.status(400).json({ ok: false, message: t(lang, result.error === 'already_resolved' ? 'web.api.appeals.alreadyAnswered' : 'web.api.appeals.cannotDo') }); return; }
        res.json({ ok: true, dm: result.dm, lifted: result.lifted });
      } catch (err) {
        logger.error(`Dashboard appeal resolve failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: t(lang, 'web.api.appeals.saveFailed') });
      }
    });

    app.post('/api/dashboard/guild/:guildId/appeals/reply', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      const lang = requestLanguage(req, access.guild.id);
      try {
        const appealsDb = require('../db/appeals');
        const { staffReply } = require('../utils/appeals');
        const submission = await appealsDb.getSubmission(access.guild.id, String(req.body?.id ?? ''));
        if (!submission) { res.status(404).json({ ok: false, message: t(lang, 'web.api.appeals.notFound') }); return; }
        const result = await staffReply({ client, guild: access.guild, submission, content: req.body?.content, moderatorId: access.userId, moderatorName: access.member.displayName });
        res.status(result.ok ? 200 : 400).json({ ok: result.ok, dm: result.dm, message: result.ok ? undefined : t(lang, 'web.api.appeals.empty') });
      } catch (err) {
        logger.error(`Dashboard appeal reply failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: t(lang, 'web.api.appeals.sendFailed') });
      }
    });

    // The AutoMod rules of Discord made from templates: list them, add one, turn one on or off, remove one.
    app.post('/api/dashboard/guild/:guildId/automod/native', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      const lang = requestLanguage(req, access.guild.id);
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
            exemptRoleIds: ids(body.exemptRoleIds), exemptChannelIds: ids(body.exemptChannelIds), lang,
          });
          res.json({ ok: true, rule, ...(await native.listNative(access.guild)) });
          return;
        }
        if (op === 'toggle') await native.setNativeEnabled(access.guild, String(body.id), body.enabled === true, lang);
        else if (op === 'delete') await native.deleteNative(access.guild, String(body.id), lang);
        res.json({ ok: true, ...(await native.listNative(access.guild)) });
      } catch (err) {
        if (err.userFacing) { res.status(400).json({ ok: false, message: err.message }); return; }
        logger.error(`Dashboard native automod failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: t(lang, 'web.api.automod.failed') });
      }
    });

    // Lockdown from the dashboard: start or end it now. Administrators only, the same as the command.
    app.post('/api/dashboard/guild/:guildId/lockdown', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      const lang = requestLanguage(req, access.guild.id);
      try {
        if (!access.member.permissions.has(PermissionFlagsBits.Administrator)) { res.status(403).json({ ok: false, message: t(lang, 'web.api.lockdown.adminOnly') }); return; }
        const lockdown = require('../utils/lockdown');
        const op = String(req.body?.op ?? '');
        if (op === 'start') {
          const minutes = Math.max(0, Math.min(10080, Math.floor(Number(req.body?.minutes)) || 0)) || null;
          // Its errors are in the language of the request; what it posts in the server is in the server's language.
          const result = await runWithLanguage(lang, () => lockdown.startLockdown(access.guild, { startedBy: access.userId, reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 300) : null, minutes }));
          res.json({ ok: true, ...result });
          return;
        }
        if (op === 'end') {
          res.json({ ok: true, ...(await runWithLanguage(lang, () => lockdown.endLockdown(access.guild, { endedBy: access.userId }))) });
          return;
        }
        res.status(400).json({ ok: false, message: t(lang, 'web.api.lockdown.unknownOp') });
      } catch (err) {
        if (err.userFacing) { res.status(400).json({ ok: false, message: err.message }); return; }
        logger.error(`Dashboard lockdown failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: t(lang, 'web.api.lockdown.failed') });
      }
    });

    // Lifts an active sanction (ban, mute or jail) from its case. Needs the permission the command needs.
    app.post('/api/dashboard/guild/:guildId/moderation/lift', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      const lang = requestLanguage(req, access.guild.id);
      try {
        const { liftSanction } = require('../utils/sanctionLift');
        const modCase = require('../db/modActions');
        const row = await modCase.getCase(access.guild.id, Number(req.body?.case));
        if (!row) { res.status(404).json({ ok: false, message: t(lang, 'web.api.lift.notFound') }); return; }
        const needs = ['ban', 'tempban', 'hardban'].includes(row.type) ? PermissionFlagsBits.BanMembers : PermissionFlagsBits.ModerateMembers;
        if (!access.member.permissions.has(needs) && !access.member.permissions.has(PermissionFlagsBits.Administrator)) { res.status(403).json({ ok: false, message: t(lang, 'web.api.lift.permission') }); return; }
        const result = await runWithLanguage(lang, () => liftSanction(access.guild, row.case_number, access.member.user, typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 300) : null));
        res.json({ ok: true, ...result });
      } catch (err) {
        if (err.userFacing) { res.status(400).json({ ok: false, message: err.message }); return; }
        logger.error(`Dashboard lift failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: t(lang, 'web.api.lift.failed') });
      }
    });

    // The panel of confessions (the button that opens the form), posted or updated now from the dashboard.
    app.post('/api/dashboard/guild/:guildId/confessions/panel', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      const lang = requestLanguage(req, access.guild.id);
      try {
        const config = await confessionsDb.getConfig(access.guild.id);
        const channelId = typeof req.body?.channel_id === 'string' && /^\d{5,25}$/.test(req.body.channel_id) ? req.body.channel_id : config.panel_channel_id || config.channel_id;
        if (!channelId) { res.status(400).json({ ok: false, message: t(lang, 'web.api.confessions.pickChannel') }); return; }
        const result = await postConfessionPanel(access.guild, config, channelId);
        res.status(result.ok ? 200 : 400).json(result);
      } catch (err) {
        logger.error(`Dashboard confession panel failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: t(lang, 'web.api.confessions.failed') });
      }
    });

    // The verification from the dashboard, done now instead of waiting for the panel job: `setup` makes the roles, the channel and the panel;
    // `panel` posts it; `enable` / `disable` switch it. All but `disable` run as a job (verifyJobs.js): setting it up on a big server edits
    // every channel and takes longer than the website waits. The answer comes when the job ends within a moment, otherwise
    // `{ ok: true, status: 'running', job }` and the page asks GET .../verification/job until it ends. One job per server: a second press
    // while one runs gets that one.
    const VERIFY_JOB_WAIT_MS = 1_500;
    app.get('/api/dashboard/guild/:guildId/verification/job', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      res.set('Cache-Control', 'no-store');
      // `link`: whether members can get a verification link (VERIFY_BASE_URL a public address, VERIFY_TOKEN_SECRET set), so the page can warn.
      const problem = linkProblem();
      res.json({ ok: true, job: verifyJobs.describeJob(verifyJobs.getJob(access.guild.id), requestLanguage(req, access.guild.id)), link: { ok: !problem, problem, lettersInstead: Boolean(problem && config.verifyTokenSecret) } });
    });
    app.post('/api/dashboard/guild/:guildId/verification/:action', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      const action = String(req.params.action);
      const lang = requestLanguage(req, access.guild.id);
      try {
        if (action === 'disable') {
          const result = await setEnabled(access.guild, false);
          res.status(result.ok ? 200 : 400).json(result);
          return;
        }
        if (!verifyJobs.JOB_ACTIONS.has(action)) { res.status(404).json({ ok: false, error: 'unknown_action' }); return; }
        const { job, already } = verifyJobs.startVerifyJob(access.guild, action, { userId: access.userId ?? null });
        const ended = await verifyJobs.waitForJob(job, VERIFY_JOB_WAIT_MS);
        const described = verifyJobs.describeJob(job, lang);
        if (!ended) { res.status(202).json({ ok: true, status: 'running', already, job: described, message: described.progress }); return; }
        res.status(job.ok ? 200 : 400).json({ ok: Boolean(job.ok), status: job.status, already, job: described, message: job.message ?? t(lang, 'web.api.verification.failed') });
      } catch (err) {
        logger.error(`Dashboard verification ${action} failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: t(lang, 'web.api.verification.failed') });
      }
    });

    // Saves the bot's copy of the server (roles, channels) now, so the dashboard lists show a role or channel made a moment ago.
    app.post('/api/dashboard/guild/:guildId/resync', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      try {
        await Promise.all([access.guild.channels.fetch(), access.guild.roles.fetch()]);
        await saveGuildSnapshot(access.guild, { refreshMe: true }); // the bot's own roles are read again too: they decide where it may post
        res.json({ ok: true, roles: access.guild.roles.cache.size, channels: access.guild.channels.cache.size });
      } catch (err) {
        logger.error(`Dashboard resync failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, message: t(requestLanguage(req, access.guild.id), 'web.api.resync.failed') });
      }
    });

    // Sends the quest method of a server now, from the dashboard (the newest active quest, or the one given), in its thread or channel.
    app.post('/api/dashboard/guild/:guildId/quests/method', dashboardDatabaseRateLimiter, async (req, res) => {
      const access = await dashboardCardAccess(req, res);
      if (!access) return;
      const lang = requestLanguage(req, access.guild.id);
      if (!canUseQuests(access.userId)) { res.status(403).json({ ok: false, error: 'no_access', message: t(lang, 'web.api.quests.testing') }); return; }
      try {
        const settings = (await questsDb.getConfig(access.guild.id)) ?? questsDb.DEFAULTS;
        const questId = typeof req.body?.quest_id === 'string' && /^[\w-]{1,64}$/.test(req.body.quest_id) ? req.body.quest_id : null;
        const result = await sendMethodNow(access.guild, { ...settings, guild_id: access.guild.id }, { questId, lang });
        res.status(result.ok ? 200 : 400).json({ ok: result.ok, message: result.message });
      } catch (err) {
        logger.error(`Dashboard quest method failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, error: 'method_failed', message: t(lang, 'web.api.quests.methodFailed') });
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
    registerAppealImageRoutes(app, { authorize: dashboardCardAccess, isAuthorized: dashboardAuthorized });
    registerCodeRoutes(app, { authorize: dashboardCardAccess });
    registerIdentityRoutes(app, { authorize: dashboardCardAccess });
    // Names and avatars of members for the dashboard pages, from the gateway instead of one REST call per person.
    registerMemberRoutes(app, { isAuthorized: dashboardAuthorized, authorize: dashboardCardAccess, limiter: dashboardDatabaseRateLimiter });
    // Forms: accept or deny a submission and post a panel, from the dashboard.
    registerFormRoutes(app, { authorize: dashboardCardAccess, limiter: dashboardDatabaseRateLimiter, isAuthorized: dashboardAuthorized, client });
    // Live counters: values for the previews, create, quick setup, refresh now and delete.
    registerCounterRoutes(app, { authorize: dashboardCardAccess, limiter: dashboardDatabaseRateLimiter });
    // Feeds: look up an account, follow it, change a feed, delete it, post a test notice and preview the card.
    registerFeedRoutes(app, { authorize: dashboardCardAccess, limiter: dashboardDatabaseRateLimiter });
    // Honeypot: add, remove, choose the message of the bait channel and post it again, from the dashboard (administrators, like the command).
    registerHoneypotRoutes(app, { authorize: dashboardCardAccess, limiter: dashboardDatabaseRateLimiter });
    // Paginated messages (Embeds page): post one from saved embeds, take its buttons off or delete it, put the buttons back (Manage Messages, like the command).
    registerPaginationRoutes(app, { authorize: dashboardCardAccess, limiter: dashboardDatabaseRateLimiter });
    // Invite tracking (Statistics, Invites): rewards by invites, bonus invites, resets and fake joins, with the checks of /invites.
    registerInviteRoutes(app, { authorize: dashboardCardAccess, limiter: dashboardDatabaseRateLimiter });
    // Case log (Moderation): a new reason for a case or delete it, like /case edit and /case delete, written to the sanctions log.
    registerCaseRoutes(app, { authorize: dashboardCardAccess, limiter: dashboardDatabaseRateLimiter });
    // Timers (Automation): "Send now", like `!timer run`; the schedule does not change.
    registerTimerRoutes(app, { authorize: dashboardCardAccess, limiter: dashboardDatabaseRateLimiter });
    // Booster roles: list them with their owners, and create, change, link, delete or clean them up, from the dashboard (Manage Server, like `!boosterrole admin`).
    registerBoosterRoleRoutes(app, { authorize: dashboardCardAccess, limiter: dashboardDatabaseRateLimiter });
    // Live tickets: the open tickets of a server, the last messages of one, and reply, claim, add/remove a member and close from the
    // dashboard (Manage Server, or a role with the Tickets section of Dashboard access; the actions also need the ticket's staff).
    registerTicketLiveRoutes(app, { authorize: dashboardCardAccess, limiter: dashboardDatabaseRateLimiter });
    // The public leaderboard page of a server that turned it on, asked for by the website.
    registerPublicLeaderboardRoute(app, { isAuthorized: dashboardAuthorized, limiter: dashboardDatabaseRateLimiter, client });

    // The dashboard saved a new language for a server: use it at once (the bot caches each server's language for 5 minutes).
    registerGuildLanguageRoute(app, {
      isAuthorized: dashboardAuthorized,
      limiter: dashboardPrefixRateLimiter,
      // The panels Petto posted there (VoiceMaster, tickets, verification…) are redrawn in the new language, after the answer.
      // The dashboard is a person choosing: the language is marked as chosen, so Petto never offers to change the one it detected.
      onChange: async (guildId, language) => {
        await require('../db/guilds').updateGuild(guildId, { language_source: 'manual' }).catch((err) => logger.warn(`Could not mark the language of ${guildId} as chosen: ${err.message}`));
        await refreshGuildPanels(client.guilds.cache.get(guildId), language);
      },
    });

    app.post('/api/dashboard/guild/:guildId/prefix', dashboardPrefixRateLimiter, async (req, res) => {
      if (!dashboardAuthorized(req)) {
        res.status(401).json({ ok: false, error: 'unauthorized' });
        return;
      }

      const guildId = String(req.params.guildId || '');
      // The whole list (`prefixes`, from the Manage prefixes window) or, from an older dashboard, one prefix that becomes the only one.
      const rawList = Array.isArray(req.body?.prefixes) ? req.body.prefixes : typeof req.body?.prefix === 'string' ? [req.body.prefix] : null;
      if (!/^\d{15,25}$/.test(guildId) || !rawList) {
        res.status(400).json({ ok: false, error: 'invalid_prefix_request' });
        return;
      }

      let checked = guildPrefixes.validateList(rawList.map((p) => String(p).trim()), 'en');
      // An older dashboard sends the single prefix of its field on every save: when it is still the main one, the list is left as it is.
      if (!checked.error && !Array.isArray(req.body?.prefixes)) {
        const current = guildPrefixes.prefixesOf(await ensureGuild(guildId).catch(() => null));
        if (current[0].toLocaleLowerCase() === checked.prefixes[0].toLocaleLowerCase()) checked = { prefixes: current };
      }
      if (checked.error) {
        res.status(400).json({ ok: false, error: 'invalid_prefix', message: checked.error });
        return;
      }
      try {
        await client.guilds.fetch(guildId);
        // The list is saved here too (the dashboard already wrote it), so what the bot uses is always what passed these rules.
        await updateGuild(guildId, guildPrefixes.columnsFor(checked.prefixes)).catch((err) => logger.warn(`Dashboard prefix save for guild ${guildId}: ${err.message}`));
        setCachedPrefix(guildId, checked.prefixes);
        res.json({ ok: true, prefix: checked.prefixes[0], prefixes: checked.prefixes });
      } catch (err) {
        logger.error(`Dashboard could not sync prefix for guild ${guildId}:`, err);
        res.status(404).json({ ok: false, error: 'guild_unavailable' });
      }
    });

    app.get('/api/dashboard/vault/:guildId', dashboardDatabaseRateLimiter, async (req, res) => {
      const authorized = await dashboardGuild(req, res);
      if (!authorized) return;
      try {
        res.json({ ok: true, ...(await dashboardVaultData(req.params.guildId)) });
      } catch (err) {
        logger.error('Dashboard failed to load Vault data:', err);
        res.status(500).json({ ok: false, error: 'vault_unavailable' });
      }
    });

    app.post('/api/dashboard/vault/:guildId', dashboardDatabaseRateLimiter, async (req, res) => {
      const authorized = await dashboardGuild(req, res);
      if (!authorized) return;
      const { guild, userId } = authorized;
      const action = String(req.body?.action || '');
      try {
        if (action === 'create') {
          await Promise.all([guild.roles.fetch(), guild.channels.fetch(), guild.emojis.fetch()]);
          const snapshot = await buildFullSnapshot(guild);
          const saved = await createBackup(guild.id, userId, String(req.body?.label || '').trim() || null, snapshot);
          await recordAudit(guild.id, userId, 'backup_created', saved.backup_number, { source: saved.source || 'manual', label: saved.label });
        } else if (action === 'restore') {
          // A restore now goes through its own steps (preview, human check, progress), never in one call.
          res.status(400).json({ ok: false, error: 'restore_use_steps' });
          return;
        } else if (action === 'delete') {
          if (!authorized.isAdministrator) { res.status(403).json({ ok: false, error: 'administrator_required' }); return; }
          const backupNumber = Number(req.body?.backup_id);
          if (!Number.isInteger(backupNumber) || backupNumber < 1) { res.status(400).json({ ok: false, error: 'invalid_backup' }); return; }
          if (!(await deleteBackup(guild.id, backupNumber))) { res.status(404).json({ ok: false, error: 'backup_not_found' }); return; }
          await recordAudit(guild.id, userId, 'backup_deleted', backupNumber, {});
        } else if (action === 'delete_all') {
          if (!authorized.isAdministrator) { res.status(403).json({ ok: false, error: 'administrator_required' }); return; }
          // Every backup and the schedule: asked for by name of the action only, the dashboard confirms before.
          const count = await deleteAllBackups(guild.id);
          await recordAudit(guild.id, userId, 'backups_deleted_all', null, { count });
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

    // The steps of a restore: what it would do, a human check, the start, how far it is and the way to stop it.
    const restoreAdmin = async (req, res) => {
      const authorized = await dashboardGuild(req, res);
      if (!authorized) return null;
      if (!authorized.isAdministrator) {
        res.status(403).json({ ok: false, error: 'administrator_required' });
        return null;
      }
      return authorized;
    };
    // `parts` (optional): only some parts of the backup, like "roles,channels" (backupRestore.js RESTORE_PARTS); none means all of it.
    const restoreInput = (source) => ({ number: Number(source?.backup_id), mode: String(source?.mode || 'merge'), parts: [...restoreParts(source?.parts)] });
    const validRestoreInput = ({ number, mode }) => Number.isInteger(number) && number >= 1 && ['merge', 'replace'].includes(mode);

    app.get('/api/dashboard/vault/:guildId/restore/status', dashboardDatabaseRateLimiter, async (req, res) => {
      const authorized = await dashboardGuild(req, res);
      if (!authorized) return;
      res.json({ ok: true, job: backupJobs.describeJob(backupJobs.getJob(authorized.guild.id)) });
    });

    app.get('/api/dashboard/vault/:guildId/restore/preview', dashboardDatabaseRateLimiter, async (req, res) => {
      const authorized = await restoreAdmin(req, res);
      if (!authorized) return;
      const input = restoreInput(req.query);
      if (!validRestoreInput(input)) { res.status(400).json({ ok: false, error: 'invalid_restore' }); return; }
      try {
        const backup = await getBackup(authorized.guild.id, input.number);
        if (!backup) { res.status(404).json({ ok: false, error: 'backup_not_found' }); return; }
        await Promise.all([authorized.guild.roles.fetch(), authorized.guild.channels.fetch(), authorized.guild.emojis.fetch()]);
        const plan = planRestore(authorized.guild, backup.snapshot, { mode: input.mode, parts: input.parts });
        res.json({ ok: true, contents: backupContents(backup.snapshot), plan: { ...plan, deleteChannelCount: plan.deleteChannels.length, deleteRoleCount: plan.deleteRoles.length, deleteChannels: plan.deleteChannels.slice(0, 25), deleteRoles: plan.deleteRoles.slice(0, 25) }, running: backupJobs.isRunning(authorized.guild.id) });
      } catch (err) {
        logger.error('Dashboard failed to preview a restore:', err);
        res.status(500).json({ ok: false, error: 'restore_preview_failed' });
      }
    });

    app.post('/api/dashboard/vault/:guildId/restore/challenge', dashboardDatabaseRateLimiter, async (req, res) => {
      const authorized = await restoreAdmin(req, res);
      if (!authorized) return;
      const challenge = backupJobs.createRestoreChallenge(authorized.guild, authorized.userId);
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, challenge: { id: challenge.id, kind: challenge.kind, name: challenge.name ?? null, seconds: challenge.seconds, image: challenge.png ? `data:image/png;base64,${challenge.png.toString('base64')}` : null } });
    });

    app.post('/api/dashboard/vault/:guildId/restore/start', dashboardDatabaseRateLimiter, async (req, res) => {
      const authorized = await restoreAdmin(req, res);
      if (!authorized) return;
      const { guild, userId } = authorized;
      const input = restoreInput(req.body);
      if (!validRestoreInput(input)) { res.status(400).json({ ok: false, error: 'invalid_restore' }); return; }
      try {
        if (backupJobs.isRunning(guild.id)) { res.status(409).json({ ok: false, error: 'restore_running' }); return; }
        const checked = backupJobs.checkRestoreChallenge(String(req.body?.challenge_id || ''), guild.id, userId, req.body?.answer);
        if (!checked.ok) { res.status(checked.reason === 'locked' ? 429 : 400).json({ ok: false, error: `captcha_${checked.reason}` }); return; }
        const backup = await getBackup(guild.id, input.number);
        if (!backup) { res.status(404).json({ ok: false, error: 'backup_not_found' }); return; }
        await Promise.all([guild.roles.fetch(), guild.channels.fetch(), guild.emojis.fetch()]);
        // The label is kept with the backup and shown to everyone in the server, so it is in the server's language (as with !backup).
        const serverLang = peekGuildLanguage(guild.id);
        const job = backupJobs.startRestoreJob(guild, {
          userId,
          number: input.number,
          mode: input.mode,
          parts: input.parts,
          snapshot: backup.snapshot,
          reason: t(serverLang, 'web.audit.restore', { number: input.number }),
          prepare: async () => {
            const safety = await createBackup(guild.id, userId, t(serverLang, 'backup.restore.safetyLabel', { number: input.number }), await buildFullSnapshot(guild), 'manual');
            await recordAudit(guild.id, userId, 'backup_created', safety.backup_number, { source: 'manual', purpose: 'restore_safety', beforeBackupNumber: input.number });
            return safety.backup_number;
          },
          finish: async (ended) => {
            await recordAudit(guild.id, userId, 'backup_restored', input.number, { mode: input.mode, parts: input.parts, safetyBackupNumber: ended.safetyNumber, status: ended.status, result: ended.result });
          },
        });
        res.json({ ok: true, job: backupJobs.describeJob(job) });
      } catch (err) {
        logger.error(`Dashboard failed to start a restore for guild ${guild.id}:`, err);
        res.status(err.code === 'restore_running' ? 409 : 500).json({ ok: false, error: err.code === 'restore_running' ? 'restore_running' : 'restore_start_failed' });
      }
    });

    app.post('/api/dashboard/vault/:guildId/restore/cancel', dashboardDatabaseRateLimiter, async (req, res) => {
      const authorized = await restoreAdmin(req, res);
      if (!authorized) return;
      const stopped = backupJobs.cancelJob(authorized.guild.id);
      res.json({ ok: true, stopped, job: backupJobs.describeJob(backupJobs.getJob(authorized.guild.id)) });
    });

    app.get('/api/dashboard/vault/:guildId/export/:backupId', dashboardDatabaseRateLimiter, async (req, res) => {
      const authorized = await dashboardGuild(req, res);
      if (!authorized) return;
      try {
        const backup = await getBackup(req.params.guildId, req.params.backupId);
        if (!backup) {
          res.status(404).json({ ok: false, error: 'backup_not_found' });
          return;
        }
        await recordAudit(req.params.guildId, authorized.userId, 'backup_exported', backup.backup_number, { source: backup.source || 'manual' });
        res.set('Content-Disposition', `attachment; filename="petto-backup-${req.params.guildId}-${backup.backup_number}.json"`); // i18n-ignore: HTTP header
        res.json(backup.snapshot);
      } catch (err) {
        logger.error('Dashboard failed to export Vault backup:', err);
        res.status(500).json({ ok: false, error: 'backup_export_failed' });
      }
    });
  }

  if (websub.enabled()) {
    // YouTube push: the hub confirms a subscription (GET) and sends the new entries of the channels followed (POST, signed). The URL is https://<this host>/webhooks/youtube.
    app.get('/webhooks/youtube', youtubePushRateLimiter, (req, res) => { websub.verifyHandler(req, res).catch((error) => { logger.warn(`YouTube push: a confirmation failed: ${error.message}`); if (!res.headersSent) res.status(500).send('error'); }); });
    app.post('/webhooks/youtube', youtubePushRateLimiter, express.raw({ type: () => true, limit: '200kb' }), (req, res) => { websub.pushHandler(req, res).catch(() => { if (!res.headersSent) res.status(204).end(); }); });
  }

  if (votesEnabled) {
    // Votes for the bot on top.gg (v1 webhook). The URL to save in top.gg is https://<this host>/webhooks/topgg.
    app.post('/webhooks/topgg', topggRateLimiter, createTopggHandler(client));
  }

  app.get('/', (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8').send(renderHomePage({ guildCount: client.guilds.cache.size, lang: requestLanguage(req) })); // i18n-ignore: HTTP header
  });

  app.get('/verify/:token', verifyPageRateLimiter, async (req, res) => {
    // The page shows the check the server chose and its name, and speaks the language of the visitor.
    const payload = verifyToken(req.params.token);
    const settings = payload ? await getConfig(payload.guildId).catch(() => null) : null;
    const guild = payload ? client.guilds.cache.get(payload.guildId) : null;
    // i18n-ignore: HTTP header
    res.set('Content-Type', 'text/html; charset=utf-8').send(renderVerifyPage({
      token: req.params.token,
      siteKey: config.turnstileSiteKey,
      method: methodOf(settings),
      guildName: guild?.name ?? null,
      guildIcon: guild?.iconURL?.({ size: 64, extension: 'png' }) ?? null,
      lang: requestLanguage(req, payload?.guildId),
    }));
  });

  // A new picture of letters for the letters method: the PNG as a data link and the signed ticket the page sends back with the answer.
  app.post('/api/verify/captcha', verifyCaptchaRateLimiter, async (req, res) => {
    const payload = verifyToken(req.body?.token);
    const lang = requestLanguage(req, payload?.guildId);
    if (!payload) {
      res.status(400).json({ ok: false, error: t(lang, 'web.verifyApi.invalidLink') });
      return;
    }
    try {
      const settings = await getConfig(payload.guildId);
      if (!usesLetters(methodOf(settings))) {
        res.status(400).json({ ok: false, error: t(lang, 'web.verifyApi.noLetters') });
        return;
      }
      if (await isRedeemed(payload.jti)) {
        res.status(400).json({ ok: false, error: t(lang, 'web.verifyApi.alreadyShort') });
        return;
      }
      const challenge = createChallenge(payload.jti);
      res.set('Cache-Control', 'no-store').json({ ok: true, image: `data:image/png;base64,${challenge.png.toString('base64')}`, ticket: challenge.ticket });
    } catch (err) {
      logger.error('Failed to make a verification picture:', err);
      res.status(500).json({ ok: false, error: t(lang, 'web.verifyApi.failed') });
    }
  });

  app.post('/api/verify', verifyRateLimiter, async (req, res) => {
    const { token, turnstileToken } = req.body ?? {};

    const payload = verifyToken(token);
    const lang = requestLanguage(req, payload?.guildId);
    if (!payload) {
      res.status(400).json({ ok: false, error: t(lang, 'web.verifyApi.invalidLink') });
      return;
    }

    // Single-use: once a token's jti has been redeemed, the (still validly-signed)
    // link is dead rather than reusable for the rest of its 24h lifetime.
    try {
      if (await isRedeemed(payload.jti)) {
        res.status(400).json({ ok: false, error: t(lang, 'web.verifyApi.already') });
        return;
      }
    } catch (err) {
      logger.error('Failed to check token redemption status:', err);
      res.status(500).json({ ok: false, error: t(lang, 'web.verifyApi.failed') });
      return;
    }

    let method;
    try {
      method = methodOf(await getConfig(payload.guildId));
    } catch (err) {
      logger.error('Failed to read the verification settings:', err);
      res.status(500).json({ ok: false, error: t(lang, 'web.verifyApi.failed') });
      return;
    }

    // The letters are checked first: it is cheap, and a wrong answer must not use up the Cloudflare check.
    if (usesLetters(method)) {
      const answer = checkAnswer(payload.jti, req.body?.captchaTicket, req.body?.captchaAnswer);
      if (!answer.ok) {
        res.status(400).json({ ok: false, code: answer.reason, error: t(lang, `web.verifyApi.letters.${answer.reason}`) });
        return;
      }
    }

    if (usesTurnstile(method)) {
      if (!config.turnstileSecretKey) {
        res.status(500).json({ ok: false, error: t(lang, 'web.verifyApi.turnstileMissing') });
        return;
      }
      if (!turnstileToken) {
        res.status(400).json({ ok: false, error: t(lang, 'web.verifyApi.captchaMissing') });
        return;
      }

      let turnstileResult;
      try {
        turnstileResult = await checkTurnstile(turnstileToken, req.ip);
      } catch (err) {
        logger.error('Turnstile verification request failed:', err);
        res.status(502).json({ ok: false, error: t(lang, 'web.verifyApi.captchaUnreachable') });
        return;
      }

      if (!turnstileResult.success) {
        res.status(400).json({ ok: false, error: t(lang, 'web.verifyApi.captchaFailed') });
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
        res.status(400).json({ ok: false, error: t(lang, 'web.verifyApi.already') });
        return;
      }

      // The audit log reason is in the server's language, the same as when the member verifies inside Discord (utils/verifyApply.js).
      const serverLang = peekGuildLanguage(guild.id);
      try {
        if (verifyConfig?.unverified_role_id && member.roles.cache.has(verifyConfig.unverified_role_id)) {
          await member.roles.remove(verifyConfig.unverified_role_id, t(serverLang, 'verify.reason.passed'));
        }
        if (verifyConfig?.verified_role_id) {
          await member.roles.add(verifyConfig.verified_role_id, t(serverLang, 'verify.reason.passed'));
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
      res.status(500).json({ ok: false, error: t(lang, 'web.verifyApi.rolesFailed') });
    }
  });

  // Public transcript viewer, the URL's guildId/number are cosmetic (so a link is human-readable
  // at a glance); actual access is entirely gated by the signed token, checked against the same
  // ticket row to make sure they weren't just edited to browse a different ticket.
  app.get('/transcript/:guildId/:number/:token', transcriptRateLimiter, async (req, res) => {
    const payload = verifyTranscriptToken(req.params.token);
    const lang = requestLanguage(req, SNOWFLAKE.test(req.params.guildId) ? req.params.guildId : null);
    if (!payload) {
      res.status(403).send(t(lang, 'web.transcript.invalid'));
      return;
    }

    try {
      const ticket = await getTicketById(payload.ticketId);
      if (!ticket || ticket.guild_id !== req.params.guildId || String(ticket.ticket_number) !== req.params.number) {
        res.status(404).send(t(lang, 'web.transcript.notFound'));
        return;
      }
      if (!ticket.transcript_html) {
        res.status(404).send(t(lang, 'web.transcript.notGenerated'));
        return;
      }
      res.set('Content-Type', 'text/html; charset=utf-8').send(ticket.transcript_html); // i18n-ignore: HTTP header
    } catch (err) {
      logger.error('Failed to serve ticket transcript:', err);
      res.status(500).send(t(lang, 'web.transcript.failed'));
    }
  });

  app.use((req, res) => {
    // Keep machine-facing endpoints JSON even when a route is unavailable. The
    // dashboard expects JSON and should never receive Express's plain-text 404.
    if (req.path.startsWith('/api/') || req.path.startsWith('/rest/v1/')) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    res.status(404).send(t(requestLanguage(req), 'web.notFound'));
  });

  app.listen(config.webPort, () => {
    logger.info(`Verification web server listening on port ${config.webPort} (public: ${config.verifyBaseUrl}).`);
  });

  return app;
}

module.exports = { startServer };
