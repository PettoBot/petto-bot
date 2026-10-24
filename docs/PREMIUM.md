# Petto Premium

Premium is account based. Polar tells the web which Discord user paid, the web
stores the entitlement through the private bot API, and the bot reads the
selected server slots from Discloud PostgreSQL. Free servers keep the normal
limits and features.

## What Premium is (and is not)

Petto is meant to be free for almost everything. Premium is never needed to run a
server: moderation, automod, anti-nuke, anti-scam, verification, logging (every
event, any channel), tickets, leveling and level rewards, giveaways, forms,
appeals, backups, the dashboard and the embed builder work the same on Free.
Premium adds about twice the room on the items below and a few small touches.

## Limits per server

`FREE_LIMITS` and `PREMIUM_LIMITS` in `src/db/premium.js` are the source of
truth. The website keeps the same numbers in `src/utils/planLimits.ts` (the
dashboard pages and the public Premium page read them from there), so change
both together. The commands and the dashboard check the same numbers; a command
reads one with `guildLimit(guildId, key)` and answers "this server already has
N ...; Premium raises it to M" in the language of the server.

| Limit | Free | Premium | Checked by |
| --- | --- | --- | --- |
| Custom commands | 125 | 250 | `!customcommand`, dashboard, Petto Code API |
| Autoresponders | 75 | 150 | `!autoresponder`, dashboard |
| Ticket types (categories) | 25 | 50 | `!ticket category add`, `!ticket setup`, dashboard |
| Giveaway presets | 15 | 30 | `!giveawaypreset create`, dashboard |
| Image cards | 30 | 60 | dashboard (cards are only made there) |
| Uploaded card pictures | 50 (100 MB) | 120 (240 MB) | dashboard (pictures are only uploaded there) |
| Partner channels | 25 | 50 | `!partnerconfig`, dashboard |
| Upload channels | 100 | 200 | `!uploadconfig`, dashboard |
| Button responders | 250 | 500 | `!responder`, dashboard |
| Button panels | 50 | 100 | `!panel`, dashboard |
| Counters | 25 | 50 | `!counter`, dashboard |

Level rewards and log channels have no Premium limit: every server can add as
many as it needs. (Older pages listed "level rewards" and "log routes" limits,
but they were never counted anywhere, so they were removed.)

Lowering a number never deletes anything: a server over a limit keeps what it
has and can only not add more until it is under it again.

Discord's own limits still apply inside each item: a ticket panel shows at most
5 buttons or 25 dropdown options, a message at most 5 buttons per row, an embed
at most 25 fields.

## Premium touches

Small extras, none of them needed to run a server. Each one falls back quietly
when Premium ends (nothing breaks and nothing is deleted).

| Touch | Where | Without Premium |
| --- | --- | --- |
| Advanced layer editor and the 25 extra fonts for image cards (15 are free) | dashboard Cards | the card is drawn with its basic settings |
| Moving avatar decoration on the level-up card (`animateDecoration`) | dashboard Cards, Level-up layout | the decoration is the still picture |
| Server avatar, banner, bio and name style (gradient, neon, glow) of Petto | dashboard Customize | reset to the defaults; the nickname is free and kept |
| Animated backgrounds `aurora` and `waves` for the web page of a form | dashboard Forms, `!form set <form> background` | shown as the plain gradient |
| Hide the "Forms by Petto" line at the bottom of a form page | dashboard Forms, `!form set <form> branding off` | the line is shown |
| Statistics for the last 60 and 90 days (Free: 7, 14 and 30) | dashboard Statistics | the 30 day view |
| A claimed request goes back to open by itself after N hours | `!requestconfig timeout`, dashboard Tools | staff unclaim it by hand |
| Your own prefix in every server (`!myprefix`) | the account of the buyer | also open to boosters of the support server, partners and the team |
| A Premium role in the support server | support server | none |

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
