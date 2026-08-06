require('dotenv').config();

const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

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
  // Optional: powers /automod link (Google Safe Browsing URL scanning).
  googleSafeBrowsingKey: process.env.GOOGLE_SAFE_BROWSING_API_KEY || null,
  // Optional: /search result previews. Without these, the command still returns a Google link.
  googleSearchApiKey: process.env.GOOGLE_SEARCH_API_KEY || null,
  googleSearchCx: process.env.GOOGLE_SEARCH_CX || null,
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
