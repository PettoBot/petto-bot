const express = require('express');
const path = require('path');
const { MessageFlags } = require('discord.js');
const config = require('../config');
const { verifyToken } = require('../utils/verifyToken');
const { verifyTranscriptToken } = require('../utils/transcriptToken');
const { getConfig } = require('../db/verificationConfig');
const { isRedeemed, claimRedemption, releaseRedemption } = require('../db/verificationRedemptions');
const { getTicketById } = require('../db/tickets');
const { logVerification } = require('../utils/verificationLog');
const { buildVerifiedDM } = require('../utils/verifyMessage');
const { renderVerifyPage } = require('./verifyPage');
const { renderHomePage } = require('./homePage');
const logger = require('../utils/logger');

async function checkTurnstile(responseToken, remoteIp) {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: config.turnstileSecretKey, response: responseToken, remoteip: remoteIp ?? '' }),
  });
  return res.json();
}

/**
 * Starts the verification web server (serves the Turnstile page and applies role
 * changes on success). Needs the live discord.js client to fetch guilds/members.
 * Returns null (and skips starting) if the Turnstile/token env vars aren't set,
 * /verify's slash command still works for config, it just can't send working links.
 */
function startServer(client) {
  if (!config.verifyBaseUrl || !config.turnstileSiteKey || !config.turnstileSecretKey || !config.verifyTokenSecret) {
    logger.warn('Verification env vars not fully set, web server not started. /verify links will not work until they are.');
    return null;
  }

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  // Petto's brand icons (approve/deny/alert/favicon), also referenced by public URL
  // from the Components V2 verification DM, since Discord needs a real image URL.
  app.use('/assets', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

  app.get('/', (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8').send(renderHomePage({ guildCount: client.guilds.cache.size }));
  });

  app.get('/verify/:token', (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8').send(renderVerifyPage({ token: req.params.token, siteKey: config.turnstileSiteKey }));
  });

  app.post('/api/verify', async (req, res) => {
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
      await member
        .send({ components: [buildVerifiedDM({ guild })], flags: MessageFlags.IsComponentsV2 })
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

  app.use((req, res) => res.status(404).send('Not found.'));

  app.listen(config.webPort, () => {
    logger.info(`Verification web server listening on port ${config.webPort} (public: ${config.verifyBaseUrl}).`);
  });

  return app;
}

module.exports = { startServer };
