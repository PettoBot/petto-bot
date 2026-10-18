# Petto Premium

Premium is account based. Polar tells the web which Discord user paid, the web
stores the entitlement through the private bot API, and the bot reads the
selected server slots from Discloud PostgreSQL. Free servers keep the normal
limits and features.

## Limits per server

`FREE_LIMITS` and `PREMIUM_LIMITS` in `src/db/premium.js` are the source of
truth. The website keeps the same numbers in `src/utils/planLimits.ts` (the
dashboard pages and the public Premium page read them from there), so change
both together.

| Limit | Free | Premium |
| --- | --- | --- |
| Custom commands | 100 | 250 |
| Autoresponders | 30 | 150 |
| Ticket types (categories) | 10 | 50 |
| Level rewards | 20 | 100 |
| Giveaway presets | 6 | 30 |
| Log routes | 20 | Unlimited |
| Image cards | 6 | 60 |
| Uploaded card pictures | 10 (30 MB) | 120 (240 MB) |
| Partner channels | 12 | 50 |
| Upload channels | 40 | 200 |
| Button responders | 40 | 500 |
| Button panels | 20 | 100 |
| Counters | 12 | 50 |

Discord's own limits still apply inside each item: a ticket panel shows at most
5 buttons or 25 dropdown options, a message at most 5 buttons per row, an embed
at most 25 fields.

## One time setup

1. Apply `src/db/schema.sql` to the Discloud PostgreSQL database. It creates the
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
