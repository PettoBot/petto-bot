require('dotenv').config();

const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

function resolveVaultDatabaseUrl() {
  const rawUrl = process.env.PETTO_VAULT_DATABASE_URL || null;
  if (!rawUrl) return null;

  const configuredHost = process.env.PETTO_VAULT_DATABASE_HOST?.trim() || null;

  try {
    const url = new URL(rawUrl);
    const host = configuredHost || (url.hostname === 'tailscale-discloud' ? 'lian636' : null);
    if (!host) return rawUrl;

    url.hostname = host;
    return url.toString();
  } catch {
    // Keep the original value so pg can return its normal, useful connection error.
    return rawUrl;
  }
}

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}. Copy .env.example to .env and fill it in.`);
  }
}

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  devGuildId: process.env.DISCORD_DEV_GUILD_ID || null,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  // Optional: direct Postgres connection string (Settings -> Database -> Connection string).
  // When set, index.js runs schema.sql on every boot. When unset, migrations are skipped
  // and the schema must be applied manually in the Supabase SQL editor.
  databaseUrl: process.env.DATABASE_URL || null,
  // Optional dedicated PostgreSQL database for Petto Vault backups and audit history.
  // Discloud's private VLAN hostname can override an older Tailscale URL safely.
  vaultDatabaseUrl: resolveVaultDatabaseUrl(),
  // Shared secret for server-side dashboard requests. Keep this identical to the
  // web worker secret, but never send it to the browser.
  dashboardApiSecret: process.env.PETTO_DASHBOARD_API_SECRET || null,
  // Optional: powers /automod link (Google Safe Browsing URL scanning).
  googleSafeBrowsingKey: process.env.GOOGLE_SAFE_BROWSING_API_KEY || null,
  // Optional: verification system (Cloudflare Turnstile). All four must be set for /verify to work.
  verifyBaseUrl: process.env.VERIFY_BASE_URL || null,
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null,
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY || null,
  verifyTokenSecret: process.env.VERIFY_TOKEN_SECRET || null,
  webPort: Number(process.env.WEB_PORT) || 8787,
  // Optional: dedicated domain for ticket transcript links. Falls back to VERIFY_BASE_URL —
  // both point at the same Express process/port, this just lets it have its own hostname.
  transcriptBaseUrl: process.env.TRANSCRIPT_BASE_URL || null,
  // Optional: a Cloudflare Tunnel token (Zero Trust dashboard -> Networks -> Tunnels -> your
  // tunnel -> Install connector). When set, index.js runs `cloudflared tunnel run` alongside
  // the bot so VERIFY_BASE_URL/TRANSCRIPT_BASE_URL get real HTTPS from Cloudflare's edge without
  // needing the host's externally-exposed port to be one Cloudflare's proxy can forward.
  cloudflareTunnelToken: process.env.CLOUDFLARE_TUNNEL_TOKEN || null,
};
