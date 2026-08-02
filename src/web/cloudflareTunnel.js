const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { install } = require('cloudflared');
const logger = require('../utils/logger');

const BIN_PATH = path.join(__dirname, '..', '..', '.cloudflared', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
const INITIAL_RESTART_DELAY_MS = 5_000;
const MAX_RESTART_DELAY_MS = 60_000;

/**
 * Starts a Cloudflare Tunnel (`cloudflared tunnel run --token ...`) as a child process, so
 * captcha.petto.sbs/transcript.petto.sbs get real HTTPS from Cloudflare's edge without needing
 * the host's externally-exposed port to be one Cloudflare's proxy will forward (most hosting
 * panels only expose a single non-standard port, which rules out plain DNS-only proxying).
 * The tunnel's Public Hostnames (configured in the Cloudflare Zero Trust dashboard) point at
 * this same container's localhost:WEB_PORT — no inbound port needs to be reachable at all.
 * No-ops if `token` isn't set (the web server still works locally / for hosts that don't need this).
 */
async function startCloudflareTunnel(token) {
  if (!token) return;

  try {
    if (!fs.existsSync(BIN_PATH)) {
      logger.info('Downloading cloudflared binary...');
      fs.mkdirSync(path.dirname(BIN_PATH), { recursive: true });
      await install(BIN_PATH);
    }

    let restartDelay = INITIAL_RESTART_DELAY_MS;
    const spawnTunnel = () => {
      const proc = spawn(BIN_PATH, ['tunnel', 'run', '--token', token], { stdio: ['ignore', 'pipe', 'pipe'] });
      proc.stdout.on('data', (chunk) => logger.info(`[cloudflared] ${chunk.toString().trim()}`));
      proc.stderr.on('data', (chunk) => logger.info(`[cloudflared] ${chunk.toString().trim()}`));
      proc.on('error', (err) => logger.error('Cloudflare Tunnel process error:', err));
      proc.on('exit', (code, signal) => {
        logger.warn(`Cloudflare Tunnel exited (code ${code}, signal ${signal ?? 'none'}); restarting in ${restartDelay / 1000}s.`);
        const delay = restartDelay;
        restartDelay = Math.min(restartDelay * 2, MAX_RESTART_DELAY_MS);
        setTimeout(spawnTunnel, delay);
      });
      logger.info('Cloudflare Tunnel started.');
    };
    spawnTunnel();
  } catch (err) {
    logger.error('Failed to start Cloudflare Tunnel:', err);
  }
}

module.exports = { startCloudflareTunnel };
