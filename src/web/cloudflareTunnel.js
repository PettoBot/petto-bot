const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { install } = require('cloudflared');
const logger = require('../utils/logger');

const BIN_PATH = path.join(__dirname, '..', '..', '.cloudflared', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
const INITIAL_RESTART_DELAY_MS = 5_000;
const MAX_RESTART_DELAY_MS = 60_000;

// The token is passed with --token and cloudflared also prints the environment variables it can see, so the tunnel
// gets an environment without the token, and every line is cleaned before it reaches the logs.
const TUNNEL_ENV_NAMES = ['CLOUDFLARE_TUNNEL_TOKEN', 'TUNNEL_TOKEN'];
const TOKEN_SHAPE = /eyJ[A-Za-z0-9_-]{20,}/g;

/** The environment for the tunnel process: ours, without the variables that hold the token. */
function tunnelEnv(env = process.env) {
  const clean = { ...env };
  for (const name of TUNNEL_ENV_NAMES) delete clean[name];
  return clean;
}

/** One line of cloudflared output that is safe to log, or null for a line that only lists environment variables. */
function cleanTunnelLine(line, token) {
  const text = String(line);
  if (/Environmental variables/i.test(text)) return null;
  let safe = token ? text.split(token).join('[hidden]') : text;
  safe = safe.replace(TOKEN_SHAPE, '[hidden]');
  return safe;
}

function logTunnelOutput(chunk, token) {
  for (const line of chunk.toString().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const safe = cleanTunnelLine(trimmed, token);
    if (safe) logger.info(`[cloudflared] ${safe}`);
  }
}

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
      const proc = spawn(BIN_PATH, ['tunnel', 'run', '--token', token], { stdio: ['ignore', 'pipe', 'pipe'], env: tunnelEnv() });
      proc.stdout.on('data', (chunk) => logTunnelOutput(chunk, token));
      proc.stderr.on('data', (chunk) => logTunnelOutput(chunk, token));
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

module.exports = { startCloudflareTunnel, tunnelEnv, cleanTunnelLine };
