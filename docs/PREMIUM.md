# Petto Premium

Premium is account based. Polar tells the web which Discord user paid, the web
stores the entitlement in Supabase, and the bot reads the selected server slots
from the same tables. Free servers keep the normal limits and features.

## One time setup

1. Apply `src/db/schema.sql` to the primary Supabase database. It creates the
   `premium_entitlements`, `premium_slot_assignments` and
   `premium_slot_requests` tables.
2. In Polar, keep the webhook endpoint on the main site only:
   `https://petto.sbs/api/billing/polar/webhook`.
3. Copy Polar's webhook secret into `POLAR_WEBHOOK_SECRET` in the Cloudflare
   Pages production environment. For local development, the bot `.env` is
   loaded by Astro as well.
4. Create an Organization Access Token in Polar with checkout creation access
   and add it as `POLAR_ACCESS_TOKEN` to the Cloudflare Pages production
   environment. It is never sent to the browser.
5. Deploy the web and restart/redeploy the bot after the schema is available.

`captcha.petto.sbs` remains for Turnstile verification and
`transcript.petto.sbs` remains for ticket transcripts. Neither is a Premium
webhook endpoint.

The six Polar product IDs and the public fallback checkout link belong in the
host's configuration, while the access token and webhook secret must remain in
the encrypted production secret store. Do not create or commit an environment
template containing real deployment values.
