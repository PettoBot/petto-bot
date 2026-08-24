# Petto

A multi-purpose Discord bot focused on moderation (inspired by YAGPDB, Dyno and La Cabra), grown out into a full ticket system, welcome/leave/boost announcements, leveling, giveaways, reaction roles, custom commands, invite tracking, and a general utility/info command set.

## Stack

- Node.js 18+, discord.js v14, Supabase (Postgres) via `@supabase/supabase-js`
- Prefix commands (default `!`, configurable per guild) — see "Command system" below for why, and how the same command files serve both without being rewritten. Slash is reserved for future interactive/game commands.
- Dynamically loaded from `src/commands/**`
- All per-guild config lives in the database — nothing is hardcoded
- Brand palette (`src/utils/colors.js`): green `#a5ea7a` (success), yellow `#fed53c` (warning/pending), red `#fe6465` (error/destructive), blue `#8399ff` (neutral/informational, the default accent). Every status-colored card/embed across the bot draws from this set — previously a handful of one-off hex values (Discord's default blurple, a semi-random pink/orange here and there).

## Project layout

```
index.js                    entry point: loads commands/events, migrates DB, deploys commands, logs in, starts the expiry job + web server
deploy-commands.js           standalone CLI to (re-)register slash commands without starting the bot
src/
  config.js                  loads and validates environment variables
  db/
    supabase.js              Supabase client (service_role key, for normal queries at runtime)
    schema.sql                table definitions + create_mod_case() RPC
    migrate.js                 runs schema.sql via a direct Postgres connection on every boot
    guilds.js                 get/create per-guild config
    modActions.js             numbered case log (ban/kick/mute/unmute/unban/tempban/tempmute/warn) + case CRUD for /case edit, /case delete, etc.
    warns.js                   warn-specific history on top of mod_actions
    notes.js                   non-punitive staff notes on a user
    logConfig.js               data access for the audit-log system (entries/webhooks/ignore list)
    automod.js                  get/upsert automod config, banned words, immune roles, silent channels
    antinuke.js                  get/upsert anti-nuke config + executor whitelist
    escalation.js                 CRUD for per-guild warn-threshold escalation rules
    embedTemplates.js           get/create/update/delete/list named embeds (guild_id + name unique, data is one JSONB blob)
    verificationConfig.js       get/upsert the Turnstile join-gate settings (enabled, gate role, bonus role) per guild
    verificationRedemptions.js  redemption tracking for single-use magic links + hasEverVerified() for persistent verify
    report.js                    get/upsert the report system's destination channel + enabled flag per guild
    tickets.js                   panels/categories/tickets CRUD + createTicket() (create_ticket RPC, same advisory-lock
                                 numbering pattern as create_mod_case)
    memberEvents.js               get/upsert welcome/leave/boost channel + message + /embed template per guild
    bumpReminders.js              get/upsert/ensure bump reminder config, getDueReminders() for the polling job
    boosterRole.js                 both booster-role tables: per-member (booster_roles) and per-guild config
                                  (booster_role_config) — same one-file-per-feature bundling as tickets.js
    levelConfig.js                  get/upsert/ensure per-guild leveling config
    levelUsers.js                   per-member xp/level — addXp() calls the add_level_xp() RPC (atomic upsert +
                                    increment), plus leaderboard/rank queries and admin set/reset operations
    levelRewards.js                 level -> role reward CRUD
    levelMultipliers.js             role/channel XP multiplier CRUD
    afk.js                           AFK status + mention log (listRecentMentions/countRecentMentions filter to the
                                    last 3 days themselves — no TTL cleanup, same precedent as verification_redemptions)
    autoResponders.js                trigger/reply CRUD, short random ar_id generation, 100-per-guild cap
    stickyMessages.js                per-channel sticky content + the currently-live message_id
    poj.js                           ping-on-join config + up to 10 channels per guild
    disabledCommands.js              disabled-command rules (server-wide or per-channel)
    giveaways.js                      giveaways + giveaway_entries + giveaway_winners (one file, three tables, same
                                      bundling as poj.js) — CRUD, listDueGiveaways()/listExpiredClaims() for the job
    giveawayPresets.js                 giveaway_presets + giveaway_preset_roles (role -> bonus entries/claim time)
    giveawayTemplates.js               saved full giveaway configs, same get/upsert/delete/list shape as embedTemplates.js
    giveawayConfig.js                  single-row-per-guild defaults (entry mode, reaction, embed, per-event messages)
    reactionRoles.js                    emoji -> role bindings per message (add/remove/list/clear)
    customCommands.js                   admin-defined command name -> response/embed_template, 100-per-guild cap
    reminders.js                        personal reminders, listDue()/markSent() for the polling job, 25-per-user cap
    inviteTracking.js                    recordJoin()/recordLeave() (both call increment_invite_stat() for an atomic
                                        upsert), plus getStats()/getLeaderboard()/getInviter()
  handlers/
    commandHandler.js         recursively loads src/commands/** into client.commands; collectCommandData() (used only
                              for slash deployment) filters out regular chat-input commands, now prefix-only — see
                              "Command system" below
    prefixInteraction.js       the prefix parser: tokenizer, subcommand/option resolution off a command's existing
                              `data`, and the pseudo-interaction shim that lets every command run unmodified
    eventHandler.js            loads src/events/*.js onto the client
    deployCommands.js          registers commands with Discord's API (used by index.js and deploy-commands.js)
  interactions/
    embedPanel.js               the interactive modal-based /embed builder — renderPanel()/handleButton()/handleModal(),
                                 dispatched from interactionCreate.js by customId prefix (eb_.../em_...) rather than a
                                 short-lived collector, since the panel message can be edited minutes or hours later
    reportModal.js               handles the reason modal shown by the "Report Message" context-menu command (rp_msg::...)
    ticketPanel.js                panel button (tk_open::key) / dropdown (tk_open_select) clicks -> opens a ticket
    ticketControls.js             every in-ticket button (tk_claim/unclaim/close/reopen/delete/transcript/addmember/
                                 removemember), the close-reason modal, and the add/remove-member user-select follow-up
    giveawayButton.js              Enter/Accept/Deny button clicks (gw_enter::/gw_accept::/gw_deny::), dispatched by
                                   customId prefix like every other component here
  jobs/
    expireSanctions.js         polls every 60s for expired tempban/tempmute rows and reverses them
    bumpReminderJob.js          polls every 60s for guilds whose bump cooldown has elapsed
    voiceXpJob.js                polls every 60s, granting voice XP to everyone currently connected (and not deafened)
                                across every guild — no join/leave session-tracking needed, it just reads live voice state
    giveawayJob.js                polls every 15s (tighter than the others — see "Giveaways" below): ends due giveaways,
                                  draws winners, and expires unclaimed claim-time windows
    reminderJob.js                 polls every 30s for due /remind reminders and pings the user in-channel
  logging/
    engine.js                  sendLog()/getAvatar()/fetchMod() — delivers embeds through per-channel webhooks
    messageLog.js               delete/edit/bulk-delete embeds
    memberLog.js                join/leave/nickname/role/username/avatar/ban/unban embeds
    serverLog.js                role/channel/invite/guild-settings embeds
    voiceLog.js                  voice connect/disconnect/move/mute/deafen/stream embeds (mute/deafen entries are
                                 attributed to the acting moderator via the audit log, same lookup as disconnect/move)
    emojiLog.js                  emoji add/remove/rename embeds
  web/
    server.js                   Express app: GET /verify/:token (serves the page), POST /api/verify (checks the
                                 token + Turnstile response, then applies the role changes), GET /transcript/:guildId/
                                 :number/:token (serves a persisted ticket transcript) — started alongside the bot in
                                 the same process, listening on WEB_PORT
    verifyPage.js                self-contained HTML/CSS/JS for the verification page (Discord-dark theme, inline SVGs)
  events/
    ready.js
    interactionCreate.js       dispatches slash commands (dormant — nothing's registered right now, see "Command
                              system" below), button/select/modal component interactions, applies cooldowns, catches errors
    messageCreateCommands.js   the prefix command dispatcher: resolves the guild's prefix (or the bot's own mention,
                              always accepted as a fallback), tokenizes, looks up the command, enforces cooldowns +
                              default_member_permissions, builds the pseudo-interaction, calls execute()
    guildMemberAddVerification.js  gates new members behind the "Unverified" role and DMs them their magic link
    guildMemberAddAntiRaid.js      tracks join bursts, alerts/kicks per !automod raid config
    guildMemberAddAntiAlt.js       flags/kicks accounts younger than the configured minimum age
    guildBanAddAntiNuke.js         feeds guild bans into anti-nuke's executor tracking
    channelDeleteAntiNuke.js       feeds channel deletions into anti-nuke's executor tracking
    roleDeleteAntiNuke.js          feeds role deletions into anti-nuke's executor tracking
    emojiDeleteAntiNuke.js         feeds emoji deletions into anti-nuke's executor tracking
    webhooksUpdateAntiNuke.js      feeds webhook creation into anti-nuke's executor tracking (best-effort: WebhooksUpdate
                                    only reports the channel, not what changed, so this correlates via audit-log recency)
    messageCreateAutomod.js        scans messages for silent-channel/word-filter/anti-spam violations
    guildMemberAddWelcome.js       sends the configured welcome message/embed on join
    guildMemberRemoveLeave.js      sends the configured leave message/embed on leave
    messageCreateBoost.js          reads MessageType.GuildBoost/GuildBoostTier1-3 system messages to fire per-boost
                                    and boost-level-up announcements (see "Welcome / leave / boost / bump" below)
    messageCreateBump.js           detects a successful DISBOARD /bump + deletes bump-channel chatter when autoclean is on
    messageCreateLevelXp.js        grants message XP (cooldown + multiplier applied), checks for a level-up
    guildMemberAddLevelJoin.js     grants the configured join-bonus xp/level to genuinely new members only
    messageCreateAfk.js            mention-of-an-AFK-member detection + author-return detection
    messageCreateAutoresponder.js  matches every configured trigger against each message, sends the reply
    messageCreateSticky.js         reposts a channel's sticky message to the bottom whenever someone else posts
    guildMemberAddDmJoin.js        sends the configured join DM (separate from guildMemberAddWelcome.js's channel post)
    guildMemberAddPoj.js           "ping on join": pings the new member in configured channels, deletes it after a delay
    messageReactionAddGiveaway.js  tracks a reaction-mode giveaway's entries (needs the GuildMessageReactions intent)
    messageReactionRemoveGiveaway.js  un-reacting removes that entry
    messageReactionAddRoles.js     grants a reaction role's role (or removes it, in `remove` mode)
    messageReactionRemoveRoles.js  un-reacting removes a `toggle`-mode reaction role
    inviteCreateTracking.js        keeps the invite-tracking cache (utils/inviteCache.js) current as invites are made
    inviteDeleteTracking.js        ...and as they're deleted
    guildMemberAddInviteTracking.js  diffs invite use-counts on join to attribute an inviter, records the join
    guildMemberRemoveInviteTracking.js  increments the attributed inviter's leave count
    (~20 more files wiring discord.js events — messageDelete, guildMemberAdd (logging), roleCreate, voiceStateUpdate,
    etc. — to src/logging/*; note guildMemberAdd has three independent listener files: logging, the verification gate,
    and the welcome message)
  commands/
    moderation/                see "Moderation commands" below — 9 top-level commands, each with subcommands
      ban.js                    user / users / temp / remove / remove-all
      kick.js                   user / users
      mute.js                   user / users / temp / remove / remove-users
      warn.js                   user / users
      case.js                   list / last / last-many / view / edit / edit-many / delete / delete-all
      note.js                   add / view / list
      role.js                   add / remove
      channel.js                lock / unlock / slowmode / clear
      voice.js                  mute / unmute / deafen / undeafen / disconnect / move
    config/
      logs.js                  /logs — configure the audit-log system
      automod.js                !automod — link (Google Safe Browsing check)
      embed.js                  /embed — create / preview / send / delete / list / edit / field / vars
      verify.js                 /verify — setup / status / send (Cloudflare Turnstile join-verification gate)
      welcome.js                /welcome — setup / status / test / disable
      leave.js                  /leave — setup / status / test / disable
      boost.js                  /boost — setup / level-up / status / test / disable
      bumpreminder.js            /bumpreminder — channel / message / thankyou / pingable / autolock / autoclean / status
      level.js                   /level — see "Leveling / rank / leaderboard" below: enable / xp / voice-xp / cooldown /
                                 curve / max-level / notify / role-mode / ignore / join / sync-join / reset / status,
                                 plus reward/multiplier/manage admin groups
      autoresponder.js            /autoresponder (alias `ar`) — add / remove / edit / list / show / reset, plus a
                                 channel group — see "AFK / autoresponder / sticky / join extras" below
      stickymessage.js            /stickymessage (alias `sticky`) — set / remove / list
      dmonjoin.js                 /dmonjoin (alias `dmjoin`) — setup / status / test / disable; separate from /welcome,
                                 DMs the member directly instead of posting in a channel
      poj.js                      /poj — add / remove / list / enable / clear ("ping on join": mentions a new member in
                                 specific channels, then deletes the ping after a delay)
      disablecommand.js           /disablecommand (alias `dc`) — disable / enable / list; per-command, server-wide or
                                 per-channel, enforced in messageCreateCommands.js before a resolved command ever runs
      giveaway.js                 /giveaway (alias `gw`) — quick / start / template / reroll / end / edit, plus
                                 embed/reaction/entry-mode/*-message config subcommands — see "Giveaways" below
      giveawaypreset.js           /giveawaypreset (alias `gwp`) — create / view / remove / add-role / remove-role
      giveawaytemplate.js         /giveawaytemplate (alias `gwt`) — list / create / edit / remove
      reactionrole.js              /reactionrole (alias `rr`) — add / remove / list / clear
      customcommand.js             /customcommand (alias `cc`) — add / edit / remove / list / show
    utility/
      help.js                    /help — modeled on bli's help command: category -> command -> subcommand browser,
                                 plus direct lookup with bli-style pagination through a command's subcommands when no
                                 specific one is given (see "Command system" below); aliases `h`/`hlp`
      report.js                 /report — send (any member) / config (staff, Manage Server)
      boosterrole.js             /boosterrole (alias `br`) — self-service custom colored role for Nitro boosters, plus
                                 an admin group that can directly manage anyone's (ported from "bli", which only ever
                                 let the booster themselves touch it) — see "Booster roles" below
      reportMessage.js          "Report Message" — message context-menu command (right-click → Apps), opens a reason
                                 modal handled by interactions/reportModal.js
      rank.js                    /rank (aliases `nivel`/`lvl`) — embed-style level/XP card (no image rank card), see
                                 "Leveling / rank / leaderboard" below
      top.js                     /top (aliases `leaderboard`/`lb`/`ranking`) — paginated XP leaderboard, embed style
      afk.js                     /afk — set / mentions — see "AFK / autoresponder / sticky / join extras" below
      steal.js                   /steal — add an emoji/sticker from elsewhere; the sticker-from-a-reply case only
                                 works via prefix (needs the real message's .reference/.stickers, see rawMessage below)
      remind.js                  /remind — add / list / cancel — see "Reminders" below
    tickets/
      ticket.js                 /ticket — see "Ticket system" below: panel/category/support-role/ping-role admin groups
                                 plus open/close/reopen/delete/claim/unclaim/add/remove/rename/transcript/info
    info/                      see "Info / utility commands" below — all public, classic-embed replies
      avatar.js / banner.js / userinfo.js / serverinfo.js / channelinfo.js / roleinfo.js / roles.js /
      emojiinfo.js / botinfo.js / ping.js / uptime.js / permissions.js / firstmessage.js / inviteinfo.js /
      color.js / snowflake.js
      invites.js                 /invites — user / top — see "Invite tracking" below
  utils/
    permissions.js            permission + role-hierarchy checks shared by all mod commands
    caseCard.js                Components V2 "Case #N" card builder (buildCaseCard, textCard) for the command reply
    caseLog.js                  builds the classic-embed version of a case and sends it to the /logs 'sanctions' category
    caseFormat.js               one-line / detail-block text formatters for case list/lookup commands
    sanctionMessage.js          shared DM template sent to sanctioned users
    emojis.js                   Petto's custom application emoji IDs + per-type emoji map
    duration.js                 parses/formats strings like "10m", "2h", "7d" (wraps `ms`)
    muteRole.js                 auto-provisions and caches the guild's mute role (native timeout caps at 28 days)
    verifyRole.js                auto-provisions the "Unverified" gate role (denies View Channel everywhere), same pattern as muteRole.js
    verifyToken.js               signs/verifies the stateless HMAC-SHA256 magic-link tokens (user id + guild id + expiry)
    roleResolve.js              parses/validates multi-role strings for /role add, /role remove
    userResolve.js              parses multi-user strings for the *-many/*-users subcommands
    channelResolve.js           parses multi-channel strings, same shape as roleResolve.js/userResolve.js — used by
                                /autoresponder's channels option
    safeBrowsing.js             Google Safe Browsing API client for !automod link
    automodChecks.js             local (regex/in-memory) word filter, caps, mentions, invite, and repeat-flood detection
    automodAction.js              applies an automod hit: delete + warn/tempmute/kick via the normal case/DM/log path
    antiRaid.js                   in-memory sliding window of joins per guild for anti-raid detection
    antiNuke.js                    per-executor sliding window of destructive actions + quarantine/ban response —
                                    trackDestructiveAction() (clean target id: bans/channel/role/emoji deletes) and
                                    trackDestructiveActionByRecency() (no target id: webhook creation) both funnel
                                    into the same threshold/response logic
    escalation.js                  applies a warn-escalation rule once a user's warn count matches it
    reportCard.js                  Components V2 card posted to the report channel, shared by /report send and the
                                    "Report Message" context-menu command
    ticketActions.js               all ticket business logic (openTicket, claim/unclaim, closeTicket, reopenTicket,
                                    deleteTicketChannel, add/removeMember, renameTicket, postTranscript) — shared by
                                    both the /ticket slash command and the panel/control buttons, so the two paths
                                    can never drift apart
    ticketCards.js                  Components V2/button-row builders for panels and per-ticket controls
    ticketTranscript.js             fetches a ticket channel's full history and renders a self-contained dark-themed
                                    HTML transcript (same visual language as the verify page)
    ticketName.js                   sanitizes/formats a category's naming_pattern ({number}, {username}) into a
                                    valid Discord channel name
    transcriptToken.js              signs/verifies the non-expiring token behind the public transcript viewer link
                                    (same HMAC pattern as verifyToken.js, no expiry/jti since it's a reference link)
    memberEventMessage.js           sendMemberEvent() — shared welcome/leave/boost/boost_level sender: a saved /embed
                                    template if configured, else plain text, both resolved through embedVariables.js
    boosterRoleActions.js            all booster-role business logic: applyRole() (create/update the Discord role +
                                    DB row, shared by the self-service and admin command paths so they can't drift),
                                    getTargetPosition() (new roles sit above the base role/Discord's own "Server
                                    Booster" tag role, and above every other booster role), hex parsing, name filter,
                                    icon-input resolution (URL/custom emoji/sticker), cooldown math
    levelCurve.js                    totalXpForLevel()/xpNeeded()/levelForXp() — the a*L^3+b*L^2+c*L curve, ported
                                    from bli (same formula, all five knobs are per-guild config via /level curve)
    levelProgressBar.js              buildProgressBar() — a 9-custom-emoji 10-segment bar if emojis.js has them, else
                                    falls back to a plain block-character bar when the custom set is unavailable
    levelActions.js                  grantXp() — the single entry point for both message and voice XP (so neither
                                    path can drift): adds XP via the atomic RPC, recomputes level, and on level-up
                                    applies reward roles (checkRewards(), respecting role_mode) and sends the
                                    notification (notifyLevelUp(), reusing the /embed variable engine + textCard)
    bumpHandler.js                   DISBOARD bump detection, the reminder-due check (polled by jobs/bumpReminderJob.js),
                                    and bump-channel autoclean
    giveawayEngine.js                 all giveaway business logic: weighting/drawing, start/end/reroll, the claim
                                      accept/deny/expire flow and its redraw-a-replacement step — see "Giveaways" below
    giveawayCard.js                    the default Components V2 entry/ended card, Enter/Accept/Deny button rows, and
                                       sendGiveawayResponse() (winner/deny/claim-time/... messages, same convention as
                                       memberEventMessage.js's sendMemberEvent())
    inviteCache.js                     in-memory per-guild snapshot of invite use-counts, warmed at startup and kept
                                       current by InviteCreate/Delete — see "Invite tracking" below
    colors.js                          the brand palette (green/yellow/red/blue) every status color draws from
    embedVariables.js           the `{user}`/`{server_name}`/`{choose:a|b|c}`/... placeholder engine used by /embed fields
    embedBuilder.js              build() resolves a template + ctx into a real EmbedBuilder; buildRawPreview() is the
                                 cheap non-resolved preview used by the panel; parseColor()/validUrl() are shared
    cooldown.js                simple per-user, per-command cooldown tracker
    permissionLabels.js         decomposes a command's combined default_member_permissions bitfield into readable
                                names, used by !help's command detail view
    logger.js                  timestamped console logging
```

**Why subcommands, not separate top-level commands:** each command file still groups related actions as subcommands/subcommand-groups (`/ban user`/`users`/`temp`/`remove`/`remove-all` instead of five separate commands) rather than one flat pile — that's just good organization independent of how the command is invoked. `/ticket` is the extreme case: 4 subcommand groups (`panel`, `category`, `support-role`, `ping-role`) plus 11 standalone subcommands. This is also why the old Spanish-abbreviation names (`darol`, `mlinfr`, `mavisar`, ...) are gone — everything's grouped by domain (`/role`, `/case`, `/warn`) in plain English instead.

Commands and events are **dynamically loaded** — drop a new file in `src/commands/<category>/` or `src/events/` and it's picked up automatically on the next start, no manual registration in code.

## Command system: prefix, with slash reserved for interactive commands

Every command below is invoked with a **prefix** (default `!`, changeable per guild with `!prefix <new_prefix>` — and the bot always additionally answers to `@Petto <command>` as a fallback so a server can never lock itself out by forgetting a custom prefix). Discord's slash command menu is intentionally left with just one entry (`Report Message`, since context-menu commands have no prefix equivalent) — it's reserved for future interactive/game-style commands, which don't exist yet.

This wasn't the original design (everything up through the ticket system above was built slash-first) — it's a deliberate switch. The mechanism is what makes it cheap: every command file still exports the exact same `{ data: SlashCommandBuilder, execute(interaction) }` shape as before, completely unmodified. `src/handlers/prefixInteraction.js` reads a command's `data` purely for introspection (subcommand/subcommand-group structure, each option's name/type/required-ness — never sent to Discord anymore) and builds a **pseudo-interaction** from the raw message: same `.options.getUser()/.getString()/.getInteger()/...`, same `.member`/`.guild`/`.user`/`.client`, same `.reply()`/`.deferReply()`/`.editReply()` (the latter two collapse into an immediate real send, since a prefix command has no 3-second ack window or ephemeral concept to route around — `MessageFlags.Ephemeral` is stripped, everything else including `IsComponentsV2` passes through untouched). Every command's actual logic — permission checks, DB calls, Components V2 cards — runs completely unaware it's not a real slash interaction. `src/events/messageCreateCommands.js` is the dispatcher: resolves the prefix, tokenizes, looks up the command in the same `client.commands` collection the (dormant) slash path uses, enforces cooldowns and `default_member_permissions` (Discord no longer does this for us since the command isn't registered), and calls `execute()`.

**Argument parsing**, since raw text has no labeled fields the way a slash command does:
- Required options are matched positionally, in the order they're declared (Discord itself requires required-before-optional in a `SlashCommandBuilder`, so that ordering was already fixed).
- The **last** declared option, if it's a string, greedily consumes everything left in the message — this is why `reason`/`message`-type fields normally don't need quotes as long as they're declared last (several commands, e.g. `/ban user`, `/welcome setup`, were reordered for exactly this — `delete_message_days`/`embed` moved before `reason`/`message` rather than after).
- A **non-last** string option consumes one token, unless its name is `users`/`roles`/`cases`/`channels` (consumes consecutive mention-or-ID-shaped tokens — covers the mass-action commands' multi-target lists, and `/autoresponder`'s channel restriction) or `duration` (only consumes a token that actually parses as a real duration via `ms`, so it can't accidentally swallow a reason meant for a later slot). Anything else needing multiple words in a non-last slot needs `"quotes"` — e.g. `/giveaway quick`'s `prize` (a `channel` option follows it) or `/giveawaytemplate create`'s `prize`.
- Any option can also be set with `--optionname value` (or `--optionname "quoted value"`) anywhere in the message — the escape hatch for commands with several optional strings back to back (e.g. `/ticket category add`'s `emoji`/`style`/`description`/`welcome_embed`), where pure position is too ambiguous. `--emoji 🎫 --style success` works from anywhere in the line, order-independent.
- Optional `User`/`Role`/`Channel`/`Integer`/`Boolean` options that don't look right for their slot are skipped (not force-consumed) rather than erroring, so `/channel lock @role` (skipping the optional leading channel) resolves correctly — the token just falls through to the next option that does match its shape.

Not every command is equally pleasant this way — deeply-nested admin/setup commands with several adjacent optional strings (`/ticket category add`/`edit`, `/embed edit ...`) lean on quoting and `--flags` more than a `/ban` or `/mute` does. That's an inherent property of positional text vs. a labeled UI, not something worth fully engineering around for commands run rarely, by staff, while setting things up.

**Aliases**: a command file can export `aliases: [...]` (e.g. `help.js` has `aliases: ['h', 'hlp']`) — `commandHandler.js`'s `loadCommands()` builds a second `client.commandAliases` map (alias → canonical name) alongside the normal one, skipping (and logging a warning for) any alias that collides with a real command name or an alias already claimed elsewhere, so two commands can never fight over the same short form. `messageCreateCommands.js` resolves through this map before doing anything else — cooldowns, permission checks, and error messages all key off the canonical name, not whichever alias was actually typed, so alternating between `!ban` and an alias can't be used to dodge a cooldown. Current aliases: `help`→`h`/`hlp`, `case`→`cases`, `note`→`notes`, `role`→`r`, `channel`→`ch`, `voice`→`v`, `automod`→`am`, `logs`→`log`, `embed`→`em`, `verify`→`vf`, `welcome`→`wc`, `leave`→`lv`, `boost`→`bst`, `bumpreminder`→`bump`, `report`→`rep`, `ticket`→`t`/`tickets`, `prefix`→`pfx`, `boosterrole`→`br`, `rank`→`nivel`/`lvl`, `top`→`leaderboard`/`lb`/`ranking`, `autoresponder`→`ar`, `stickymessage`→`sticky`, `dmonjoin`→`dmjoin`, `disablecommand`→`dc`, `giveaway`→`gw`, `giveawaypreset`→`gwp`, `giveawaytemplate`→`gwt`, `avatar`→`av`/`pfp`, `userinfo`→`ui`/`whois`, `serverinfo`→`si`/`server`, `channelinfo`→`ci`, `botinfo`→`about`, `permissions`→`perms`, `firstmessage`→`fm`, `reactionrole`→`rr`, `customcommand`→`cc`.

**`rawMessage`**: the pseudo-interaction also carries the real discord.js `Message` behind it as `.rawMessage` — real slash interactions have no equivalent (there's no message they're "in reply to"), but a couple of commands genuinely need it. `/steal`'s sticker-from-a-reply case is the one that actually depends on it (`message.reference`/`message.stickers`); it only works invoked via prefix as a result — a hypothetical future interactive-slash version of `/steal` would need to drop that specific capability.

**`!help`** (`src/commands/utility/help.js`) is modeled closely on "bli"'s own help command, rebuilt on top of live introspection of `client.commands` instead of a hand-kept registry (bli's `CATEGORIES`/`findCommand` catalog, which the ported version has no equivalent of and can't drift out of sync with the real commands). Every command is flattened into one entry **per leaf subcommand** — `/ban` becomes five separate entries (`ban user`, `ban users`, `ban temp`, `ban remove`, `ban remove-all`), each with its own description, parameters, and syntax, matching bli's one-entry-per-full-command-path granularity rather than dumping a command's whole subcommand list into one block.

- **`!help`** alone opens the interactive Components V2 browser: category select → command select → (if that command has subcommands) a subcommand select → the detail card, each a `.update()` on the same message via one `createMessageComponentCollector`, with "Return to ..." buttons at every level back up the chain. Selecting a command with no subcommands (e.g. `!prefix`) skips straight to its detail card.
- **`!help <command>`** with no subcommand given (e.g. `!help ban`) replies with the *first* matching entry's detail card plus a ◀️ page ▶️ row and pages through every one of that command's subcommands — same behavior as bli's `findGroup()` falling back to a prefix match and paginating the results.
- **`!help <command> <subcommand...>`** (e.g. `!help ban temp`, or a deeper path like `!help ticket category add`) resolves to exactly one entry — no pagination, straight to its card.

Each detail card mirrors bli's own field layout: `### Command: <path>`, description, a `**Aliases:** · **Parameters:** · **Permission:**` line, then a fenced `Syntax: ...` / `Example: ... (defaults: None)` block, and a category footer. Everything in it — syntax, parameters, permission — is generated by walking `data.toJSON()`'s subcommand/subcommand-group/option tree, the same structure the prefix parser itself reads to parse arguments, so `!help` can never describe a usage that doesn't match what's actually accepted. Permissions come from `utils/permissionLabels.js`, which decomposes a combined `default_member_permissions` bitfield (e.g. `MuteMembers | DeafenMembers | MoveMembers`) into readable names instead of a raw number.

## Setup

### 1. Discord application

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **Bot**, enable the **Server Members Intent** and **Message Content Intent** — the two *privileged* intents the bot needs (member fetch/hierarchy checks, message-edit/delete log content, and now every prefix command, which reads `message.content` directly). The other intents it requests (bans, invites, voice states, emojis, webhooks) aren't privileged and need no toggle.
3. Copy the **Bot Token** and the application's **Client ID** into `.env`.
4. Invite the bot with the `bot` and `applications.commands` scopes and at least: Ban Members, Kick Members, Moderate Members, Move Members, Mute Members, Deafen Members, Manage Roles, Manage Channels, Manage Webhooks, Send Messages, Read Message History.

Slash commands and the "Report Message" context-menu command are registered together, so no separate step is needed for the app command.

### 2. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Copy the **Project URL** and the **service_role** (a.k.a. "secret") key (Settings → API) into `.env`. This key bypasses RLS — keep it server-side only, never in a frontend/dashboard.
3. Schema: either let the bot apply it automatically (see `DATABASE_URL` below), or open the SQL editor and run [`src/db/schema.sql`](src/db/schema.sql) by hand — it creates `guilds`, `mod_actions`, `warns`, `notes`, `log_webhooks`, `log_entries`, `log_ignored`, `embed_templates`, `verification_config`, `verification_redemptions`, `automod_config`, `automod_silent_channels`, `antinuke_config`, `warn_escalation_rules`, `report_config`, `ticket_panels`, `ticket_categories`, `tickets`, `member_events_config`, `bump_reminders`, `booster_roles`, `booster_role_config`, `level_config`, `level_users`, `level_rewards`, `level_multipliers`, `afk_status`, `afk_mentions`, `auto_responders`, `sticky_messages`, `poj_config`, `poj_channels`, `disabled_commands`, and the `create_mod_case`/`create_ticket`/`add_level_xp` functions, with RLS enabled on every table.

### 3. Environment

```
cp .env.example .env
```

Fill in `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Optionally set `DISCORD_DEV_GUILD_ID` to your test server's ID for instant command registration while developing (global registration can take up to an hour to propagate).

**Privacy-safe guild lifecycle:** when Petto joins a server, it records the server name, ID, member count, owner, and inviter in the private operations log and owner notification. It does **not** create an invite automatically. The existing invite-tracking feature only reads invite usage when attributing a member join; it does not create a server invite. `PETTO_SUPPORT_GUILD_ID` can explicitly identify the official support server for private support controls; if left empty, Petto resolves it from `PETTO_JOIN_LOG_CHANNEL_ID`.

The hidden prefix-only `!leaveguild <guild_id>` control is restricted to Petto operators (`PETTO_OWNER_ID` or `PETTO_DEVELOPER_IDS`) in the official support server. It makes Petto leave a server where Petto is installed; it cannot remove another bot from a server where Petto is not present, and it cannot leave the official support server itself.

**`DATABASE_URL` (optional, auto-migrations):** the service_role key only reaches Supabase's REST API, which can't run `CREATE TABLE`. To have the bot apply `schema.sql` automatically on every boot, grab a **direct Postgres connection string** from Settings → Database → Connection string → URI, and set it as `DATABASE_URL`. This is a different, more sensitive secret than the service_role key (raw DB access, bypasses PostgREST entirely) — leave it empty if you'd rather keep applying `schema.sql` by hand. It's safe to re-run on every boot either way: every statement is `create table if not exists` / `create or replace function`.

**Verification (optional, powers `/verify`):** see "Join verification (Cloudflare Turnstile)" below for the full flow. Needs `VERIFY_BASE_URL` (the public domain the verification page will be served at, e.g. `https://captcha.example.com` — pointed at this process's `WEB_PORT` via reverse proxy/port-forward), `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` (Cloudflare dashboard → Turnstile → your widget), and `VERIFY_TOKEN_SECRET` (a random secret that signs the magic-link tokens — generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Leave any of these empty and the web server simply doesn't start; `/verify setup`/`/verify status` still work for configuring the gate ahead of time.

### 4. Install and run

```
npm install
npm start
```

On every boot the bot applies pending migrations (if `DATABASE_URL` is set), re-registers slash commands, then logs in — no separate deploy step needed. `npm run deploy-commands` still exists standalone if you just want to (re-)register commands without starting the bot.

For production on a VPS, run it under pm2 so it survives crashes and reboots:

```
npm install -g pm2
pm2 start index.js --name petto
pm2 save
pm2 startup
```

## Moderation commands (current)

All replies and mod-log posts use **Components V2** (`ContainerBuilder` + `TextDisplayBuilder`, not classic embeds) with Petto's custom application emojis. Sanctioned users get a DM in a shared format: `<emoji>  You have been <action> **<server>**[ for <duration>] | Reason: \`<reason>\`` with a `-# Sent from 'Petto' (guild id) with N members` footer.

### `/ban` — requires Ban Members (`remove-all` requires Administrator)
Every subcommand checks that **both** the moderator and the bot have the right permission, checks role hierarchy, gets a per-guild sequential **case number**, and logs it to the `sanctions` category of `/logs` once a channel is configured for it (see "Audit logging system" below).
- `user <user> [reason] [delete_message_days]` — ban one member
- `users <users> [reason]` — ban several members with the same reason (space/comma-separated mentions or IDs)
- `temp <user> <duration> [reason] [delete_message_days]` — temporary ban, auto-reversed by the expiry job
- `remove <user> [reason]` — unban
- `remove-all [reason]` — unban everyone currently banned, behind a button confirmation

### `/kick` — requires Kick Members
- `user <user> [reason]` · `users <users> [reason]`

### `/mute` — requires Moderate Members
- `user <user> [reason]` — indefinite, via an auto-provisioned "Muted" role (native timeout caps at 28 days)
- `users <users> [reason]` — mass indefinite mute
- `temp <user> <duration> [reason]` — uses Discord's native timeout (max 28 days), auto-reversed by the expiry job
- `remove <user> [reason]` — unmute (clears timeout and/or mute role, whichever applies)
- `remove-users <users> [reason]` — mass unmute

### `/warn` — requires Moderate Members
- `user <user> <reason>` · `users <users> <reason>`
- `escalation add threshold:<int> action:<mute|tempmute|kick|ban> duration:<string>?` / `remove threshold:<int>` / `list` — automatic consequences once a user's **active** warning count reaches a threshold, checked after every warn regardless of source (manual `/warn`, or an automod-triggered warn). Fires exactly once per threshold crossing (checked against the live count, not "N or more"), applies through the same case/DM/log path as everything else, moderator is the bot itself. `duration` is required (and only used) for `tempmute`.

(Discord has no native "warn" permission, so Moderate Members is the closest built-in stand-in for "server staff".)

### `/case` — infraction history management, requires Moderate Members, built on `mod_actions`
- `list <user>` — infraction history (last 15)
- `last <user>` / `last-many <users>` — most recent infraction, single or multiple users
- `view <case>` — look up one case by number
- `edit <case> [reason] [duration]` / `edit-many <cases> [reason] [duration]` — change a case's reason and/or (for tempban/tempmute) push its expiry out from now
- `delete <case>` — delete one case
- `delete-all <user>` — wipe a user's entire history, behind a button confirmation

### `/note` — non-punitive staff notes, no case number, requires Moderate Members
- `add <user> <note>` · `view <id>` · `list <user>`

### `/role` — requires Manage Roles
- `add <user> <roles>` / `remove <user> <roles>` — one or more roles (space/comma-separated mentions, IDs, or names), checks hierarchy per role

### `/channel` — requires Manage Channels (`clear` requires Manage Messages)
- `lock [channel] [role]` / `unlock [channel] [role]` — deny/restore Send Messages for a role (defaults: current channel, @everyone)
- `slowmode [channel] <seconds>` — 0-21600s
- `clear <amount> [user]` — bulk-delete up to 100 recent messages, optionally filtered to one user (Discord can't bulk-delete messages older than 14 days — those are silently skipped)

### `/voice` — requires Mute Members, Deafen Members, and/or Move Members
- `mute <user> [reason]` / `unmute <user> [reason]` — server voice-mute toggle, requires Mute Members
- `deafen <user> [reason]` / `undeafen <user> [reason]` — server voice-deafen toggle, requires Deafen Members
- `disconnect <user> [reason]` — kick from their current voice channel, requires Move Members
- `move <user> <channel> [reason]` — move to another voice channel, requires Move Members

All six require the target to currently be in a voice channel. These are lighter-weight than the other moderation commands — no case number, no DM, no `sanctions` log entry — but the resulting Discord audit-log entry is picked up automatically by the existing `voice` log category (see "Audit logging system"), so "who muted/moved/disconnected whom" is still fully traceable there.

**Temporary sanctions and auto-expiry:** `/ban temp` and `/mute temp` store an `expires_at`. `src/jobs/expireSanctions.js` polls every 60 seconds for anything past its expiry, reverses it (unban / clear timeout), deactivates the original case, and logs a new `unban`/`unmute` case with reason "Automatic expiry" — this runs in-process, so it only fires while the bot is up (a missed window during downtime is caught on the next poll after restart, not retroactively).

### `!backup` / Petto Vault — requires Manage Server

`!backup` opens the interactive Components V2 backup center. It uses Petto's custom status emojis and `<a:petto_loading:1541481906468814880>` while a snapshot, export, restore, schedule, or audit query is running. The menu supports creating, listing, exporting the latest, restoring through a confirmation modal, configuring automatic backups, and viewing activity history. `!backup create [label]`, `!backup list`, `!backup export [server_backup_number]`, `!backup restore <server_backup_number> <confirm> [merge|replace]`, `!backup schedule <hours> [retention]`, `!backup unschedule`, and `!backup audit` remain available as direct prefix forms.

Backup numbers are scoped to the server: each guild starts at `#1`. The database `id` remains an internal key and is never shown as the server's backup number. The audit history records creations, listings, exports, restores, schedule changes, and audit views with the actor and relevant server backup number. Snapshots contain server configuration only, never bot credentials or secrets.

### `!automod` — requires Moderate Members

The official Discord AutoMod manager is prefix-only and its owner/developer control is intentionally hidden from `!help`. Copy/paste `!am **/*/4sync5454sd` to view live coverage across Petto's guilds, or append `sync` to synchronize the current guild. The token is configurable with `PETTO_AUTOMOD_CONTROL_TOKEN`; it is an access token plus owner/developer authorization, not encryption. Automatic synchronization on restart and guild join is disabled by default after the initial rollout, so existing rules are not recreated; use the private `sync` command deliberately when needed. The bot needs `Manage Server` to manage official AutoMod rules. If Discord rejects a specific rule, Petto skips that rule with a readable reason instead of failing the whole synchronization.

- `link url:<url>` — checks a URL against **Google Safe Browsing** and reports the verdict. Manual/on-demand only, not run automatically per message — the free tier is 10,000 checks/day, which an always-on per-message scanner in an active server would blow through fast. Requires `GOOGLE_SAFE_BROWSING_API_KEY` in `.env`.
- `spam enabled:<bool> max_mentions:<int>?` — anti-spam, always local (regex/in-memory), zero external API calls per message. Covers four things at once: repeat-message flooding (same content 3+ times within 10s → 10-minute timeout), mass mentions (more than `max_mentions` users/roles in one message → warn), excessive caps (long, mostly-uppercase message → warn), and unauthorized Discord invite links (→ warn).
- `invites allow|disallow|list code:<code>` — the allow-list unauthorized-invite detection checks against (e.g. add your own server's invite code so people can post it).
- `word-filter toggle enabled:<bool> action:<warn|mute|kick|delete>?` / `add|remove|list` — a per-guild banned-word list, whole-word case-insensitive match. `action` (default `warn`) picks what happens on a hit: `mute` is a 10-minute timeout, `kick` removes them, `delete` just removes the message with no sanction.
- `raid enabled:<bool> threshold:<int>? window_seconds:<int>? action:<alert|kick>?` — anti-raid: tracks joins in memory (no DB writes on the join hot path); once `threshold` joins land within `window_seconds` (default 6 in 10s), it logs an alert to the `automod` category of `/logs`, and if `action` is `kick`, auto-kicks that joiner and every further joiner while the window stays hot. Defaults to `alert` (no auto-kick) since automatically kicking during a real traffic spike, not just a raid, is the wrong failure mode.
- `silent-channel add|remove|list channel:<#channel> action:<warn|mute|kick>?` — any message posted in a listed channel is deleted and the author sanctioned, independent of the other toggles (e.g. for an announcements-only channel). `mute` here is a 30-minute timeout, not the indefinite mute role.
- `anti-alt enabled:<bool> min_age_days:<int>? action:<kick|flag>?` — checks account creation date on join; accounts younger than `min_age_days` (default 7) get kicked (default) or just flagged in the `automod` log, depending on `action`.
- `immune add|remove|list role:<role>` — roles that skip the word filter / anti-spam checks entirely (checked before anything else, including silent channels).
- `antinuke enabled:<bool> threshold:<int>? window_seconds:<int>?` — requires **Administrator** to enable, since the response can strip a member's roles or ban an account automatically. See below.
- `antinuke-whitelist add|remove|list user:<user>` — users/bots exempt from anti-nuke tracking (e.g. other trusted bots that legitimately bulk-delete channels/roles).

### `!honeypot` — requires Administrator

`!honeypot add #channel [softban|ban|kick]` posts a Components V2 bait panel in the selected text/announcement channel. The panel uses Petto's bundled `src/assets/petto-honeypot.png` thumbnail and the `<:petto_honeypot:1541493688054841405>` counter-button emoji, so it does not depend on a third-party image host. Messages from non-staff members, including spam bots, are deleted and receive the configured action; the server owner, Administrators, and members with Manage Messages are exempt. The panel's honey button shows the persistent trigger count. Use `!honeypot list` to review configured channels and counts, or `!honeypot remove #channel` to disable one and remove its panel. Honeypot actions use the same `automod` and `sanctions` log/case/DM pipeline as other automatic moderation actions.

Every automod hit goes through the exact same case/DM/log machinery as the manual moderation commands (`db/modActions.js`, `utils/caseLog.js`, `utils/sanctionMessage.js`) — the acting "moderator" is the bot itself, matching how `expireSanctions.js` logs automatic unban/unmute. Tempmutes it issues (flood control, silent-channel `mute`) are picked up and auto-reversed by the same expiry job as a manual `/mute temp`. Staff (anyone with Manage Messages) are exempt from all of it. Each hit is also logged separately to the `automod` category of `/logs` with the specific detection reason, so the `sanctions` log shows "what case" while `automod` shows "what triggered it."

**Anti-nuke** (`utils/antiNuke.js`) protects against a compromised staff account or a malicious bot doing damage fast: it hooks `guildBanAdd`, `channelDelete`, `roleDelete`, `guildEmojiDelete`, and `webhooksUpdate` (webhook creation), resolves who performed each via the audit log, and tracks a per-executor, in-memory sliding window. Bans/channel/role/emoji deletes all carry a clean target id, matched against the audit log the same way the audit-log system's `fetchMod` does (`trackDestructiveAction`); webhook creation doesn't (discord.js's `WebhooksUpdate` only reports the channel it fired on, not what changed or by whom), so that one instead takes the most recent matching audit-log entry if it's very fresh (`trackDestructiveActionByRecency`) — both funnel into the same response logic. Once the same executor crosses `threshold` such actions within `window_seconds` (default 5 in 10s), it responds without being asked: **bans the executor if it's a bot** (a compromised bot token is easiest to just cut off), or **strips every role from the executor if it's a human** ("quarantine", reversible — the alert lists their previous roles so staff can restore them after review). The guild owner is never auto-actioned, and anyone on the whitelist is skipped entirely. This only covers actions with a reliable audit-log attribution; it does not cover kicks (no distinct, cleanly-attributable audit log event separate from a normal leave).

## Join verification (Cloudflare Turnstile)

A captcha gate for new members: join → gated behind a role that can't see the server → solve a Turnstile challenge on a web page → role removed, DM confirmation, logged. Runs as an Express server (`src/web/server.js`) in the same process as the bot, on its own port, alongside — not instead of — the rest of the bot.

**Flow:**
1. A new member joins. `src/events/guildMemberAddVerification.js` checks `/verify status` for that guild; if enabled, it first checks `verification_redemptions` for a prior successful verification by that `(guild_id, user_id)` — **persistent verify**: someone who already passed the gate once, then left and rejoined, is never re-gated, just silently re-granted the bonus role if one is configured. Only a genuinely first-time member gets gated: the bot auto-provisions (once) an **"Unverified"** role that denies **View Channel** in every existing channel/category — same auto-provisioning pattern as the mute role in `utils/muteRole.js` — assigns it to the member, and DMs them a Components V2 card (`utils/verifyMessage.js`, `buildVerifyDM`) with a Petto-thumbnail and a link: `{VERIFY_BASE_URL}/verify/{token}`.
2. The `token` is a signed, expiring credential (`utils/verifyToken.js`): `base64url(json payload).base64url(hmac-sha256(payload, VERIFY_TOKEN_SECRET))`, payload = `{ uid, gid, jti, exp }`, default 24h TTL. `jti` is a random per-token id that makes the link **single-use** — see step 4.
3. The member opens the link. `GET /verify/:token` serves `web/verifyPage.js` — a single self-contained HTML file (inline CSS/JS, no build step) styled after Claude/Anthropic's dark editorial look (`#1e1d1b`/`#262523`, a restrained blue accent — deliberately not a generic "AI product" purple/blue gradient), using Petto's own PNG icon set (`src/web/public/`, served at `/assets/*`) instead of stock icons, plus Cloudflare's official Turnstile widget script.
4. Solving the widget calls back into the page's JS, which `POST`s `{ token, turnstileToken }` to `/api/verify`. The server: (a) verifies the token's signature and expiry, (b) checks `verification_redemptions` for that token's `jti` — if already present, the link is rejected as already-used even though the signature is still validly within its 24h window, (c) verifies `turnstileToken` server-side by calling Cloudflare's `siteverify` API with `TURNSTILE_SECRET_KEY` (the secret key never touches the browser), (d) on success, fetches the member via the live discord.js `client`, removes the Unverified role (plus grants an optional bonus "verified" role if one is configured), records the `jti` as redeemed, logs the pass to the `verification` category of `/logs`, and DMs a second Components V2 card (`buildVerifiedDM`) confirming access.

**`/verify setup enabled:<bool> verified_role:<role>?`** — turn the gate on/off; on enabling, provisions the Unverified role immediately (not lazily on next join) so channels are gated right away. `verified_role` is optional — a bonus role granted on success, separate from just losing the gate role.
**`/verify status`** — shows whether it's enabled, the gate/bonus roles, and whether the env vars needed for links to actually work are set.
**`/verify send user:<user>`** — manually (re)sends a link, e.g. if a member's DMs were closed on join; gates them too if they aren't already.
**`/logs add channel:<#channel> event:verification`** — route successful verifications to a channel, same webhook system as `sanctions` and the rest.

Not built: an admin dashboard for the web side (it's a single-purpose captcha page, nothing to browse), and Discord OAuth2 login as an alternative identity method — the magic-link token already carries the identity, so there's nothing for OAuth to add here.

## Report system

Lets any member flag another member or a specific message for staff to review, two entry points into the same pipeline:

- **`/report send user:<user> reason:<string>`** — usable by everyone by default (no `setDefaultMemberPermissions` restriction; servers that want it locked down can still restrict it per-command via Discord's own Integrations settings).
- **"Report Message"** — a message **context-menu (app) command**: right-click any message → Apps → Report Message. Since context-menu commands carry no options of their own, it opens a modal (`interactions/reportModal.js`, customId `rp_msg::<messageId>`) asking for a reason, then reports that specific message with a jump link and a content preview attached.

Both build the same Components V2 card (`utils/reportCard.js`) — reporter, reported user (when known), source channel, message link/content (for message reports), and the reason — and post it to the guild's configured report channel. Neither creates a `mod_actions` case or DM; a report is a heads-up for staff to act on manually (e.g. with `/warn`, `/mute`, `/ban`), not a sanction itself.

**`/report config channel:<#channel> enabled:<bool>?`** — sets the destination channel and turns the system on/off. Requires **Manage Server**, enforced in code (not via the command's Discord-level default, since `send` needs to stay open to everyone).

## Ticket system

Modeled on Ticket Tool / Tickets: panels members click to open a private channel, categories that control where/who/how each type of ticket behaves, claim/close/reopen/delete, transcripts, and member management — all through one `/ticket` command plus buttons/modals/select menus for the day-to-day flow. Every ticket also gets a **guild-wide sequential number** (`ticket_number`, same advisory-lock RPC pattern as case numbers) and a `tickets` category in `/logs` for open/claim/close/reopen/delete/add/remove/rename events.

**Panels** (`/ticket panel create channel:<#channel> title? description? embed_template? style:<button|select>?`) are the message users click. A panel can either use a saved **`/embed` template** (`embed_template:<name>` — rendered with full variable resolution, `{server_name}`, `{user}`, etc.) or a plain title/description fallback card. `style` picks buttons (up to 5 categories, one row) or a dropdown (up to 25). `/ticket panel list` / `/ticket panel delete panel_id:<id>` round it out — deleting a panel also deletes its live message if it's still there.

**Categories** (`/ticket category add panel_id key label parent support_role ...`) are what a panel button/option actually does: `parent` is the Discord category channel new ticket channels are created under, `support_role` is who can see/manage them (add more with `/ticket support-role add key role` — kept as its own subcommand group since a single `edit` option can't safely append to an array), `welcome_embed` is an **optional saved `/embed` template** used as the ticket's welcome message (same variable engine, `ctx` is the opener + guild + the new channel) — with no template set, a plain Components V2 welcome card is used instead. `ping_role` (`/ticket ping-role add/remove/list`) pings support roles the moment a ticket opens — the only ticket message that opts back into real mentions, since the bot's global `allowedMentions` default suppresses pings everywhere else. `naming` controls the channel name (`{number}`, `{username}`, default `ticket-{number}`), and `max_open` caps how many tickets one member can have open in that category at once (default 1).

**Opening a ticket** — click a panel button/dropdown option, or run `/ticket open category:<key>` as a fallback. Creates a private channel (deny `@everyone`, allow the opener + support roles + the bot), posts the welcome message with **Claim / Close / Transcript** and **Add Member / Remove Member** control rows, and logs "Ticket Opened" to the `tickets` log category.

**Inside a ticket**, everything works as both a button and the matching `/ticket` subcommand (same underlying logic in `utils/ticketActions.js`, so neither path can drift from the other):
- **Claim / Unclaim** (staff only) — tracks who's handling it; shown in `/ticket info`.
- **Close** (opener or staff) — opens a reason modal (button) or takes `reason` directly (`/ticket close`); locks the channel (send access revoked for the opener and any added members, read access kept), generates a transcript, and posts **Reopen / Delete** controls.
- **Reopen** (staff, closed tickets only) — restores send access and re-posts the open-state controls.
- **Delete** (staff) — permanently deletes the channel; the ticket's DB row is kept (with `channel_id` cleared) for history/`/ticket info` lookups by number, it's just the Discord channel that's gone.
- **Add Member / Remove Member** (opener or staff) — the button opens an ephemeral **user-select menu** (not a modal — modals can't hold user-select components) to pick who; `/ticket add|remove user:<user>` does it directly.
- **Rename** (staff, `/ticket rename name:<string>` only, no button) and **Transcript** (post the current history without closing — button or `/ticket transcript`).
- **`/ticket info`** — ticket number, category, opener, status, claim, and (once closed) who closed it and why. Works for the opener or staff.

**Transcripts** (`utils/ticketTranscript.js`) are a self-contained dark-themed HTML file (visually consistent with the verify page) built by paginating `channel.messages.fetch` (capped at 2000 messages) — author (server display name, not raw username), timestamp, and per-message content, with real rendering rather than raw Discord markup: images/videos/gifs inline, embeds redrawn as colored boxes (title/description/fields/thumbnail/image/footer), custom emoji as real `<img>`s, `<@user>`/`<@&role>`/`<#channel>` resolved against the guild's cache (not `msg.mentions`, which discord.js only populates from `.content` — empty for the Components V2 messages Petto itself sends), a small Discord-markdown subset (headers, bold/italic/underline/strikethrough, code/code blocks, blockquotes), and animated avatars kept as `.gif` instead of a static frame. Everything is still HTML-escaped before any of that runs, so message content can never inject real markup. Delivered three ways: uploaded to the `tickets` log category (`logging/engine.js`'s `sendLog` was extended with a `files` option for this), DMed to the ticket opener as a Components V2 card (server/closed-by/reason/channel fields, closer's avatar as a thumbnail) with a **View Transcript** link button — the raw `.html` file is only attached to that DM as a fallback when no web link is available, since Discord auto-previews small text attachments as a noisy inline code block — and persisted to `tickets.transcript_html` so it can be viewed online — `{TRANSCRIPT_BASE_URL ?? VERIFY_BASE_URL}/transcript/{guildId}/{ticketNumber}/{token}`, served by the same Express server as `/verify` (`src/web/server.js`), gated behind a signed (`utils/transcriptToken.js`, same HMAC pattern as the magic link, but non-expiring since it's a reference link, not a one-time action) token rather than the guessable id/number in the URL — those are only there for a human-readable link, the actual check re-fetches the ticket by the token's id and confirms it matches. `TRANSCRIPT_BASE_URL` is optional and defaults to `VERIFY_BASE_URL` — set it to give transcript links their own hostname (e.g. `transcript.example.com`) pointed at the same process/port via a second Cloudflare Tunnel ingress rule + CNAME, purely cosmetic, no behavior difference. Like the rest of the web piece, this only works once `VERIFY_BASE_URL`/`VERIFY_TOKEN_SECRET` are set; without them, transcripts still work via the file attachment and DM.

Not built: auto-close on inactivity, a ticket rating/feedback prompt after close, and thread-based tickets (channels only, matching Ticket Tool's classic model — simpler permissioning than private threads, no boost-level cap on count).

### Ticket parity update

Petto now also includes reusable ticket forms (`/ticket form create` with 1–5 `short_text`/`long_text` fields), required roles per category, and a per-server user/role ticket blacklist (`/ticket blacklist add/remove/list`). Form answers are stored with the ticket and posted for staff after opening. Form-backed categories must be opened through their panel so Discord can show the modal. Vanity roles remain intentionally out of scope because they belong to another bot.

The existing inactivity auto-close job and post-close rating flow are implemented as well; older notes elsewhere in this README that list them as pending are stale.

The SQL migration adds `ticket_forms`, `ticket_blacklist`, category form/required-role columns, and ticket form-answer columns. It is idempotent and can be run together with the existing [`src/db/schema.sql`](src/db/schema.sql).

## Welcome / leave / boost / bump reminder

Ported from "bli" (`WelcomeSettings`, `bumpreminder`/`bumpHandler`) and "urubot" (`bienvenidas.js`'s boost-system-message approach), merged into Petto's own conventions — same `/embed`-template-or-plain-text pattern as ticket welcome messages, same `{user}`/`{server_name}`/... variable engine `/embed` already uses (`utils/embedVariables.js`), Components V2 cards for the plain-text fallback.

**`/welcome setup channel:<#channel> message? embed?`** / **`/leave setup ...`** — same shape for both: pick a channel, then either a saved **`/embed` template** (`embed:<name>`, rendered with the joining/leaving member as `{user}`) or a plain `message` with variables. `status` shows the current config, `test` sends a real one using your own account, `disable` turns it off. Fires on `guildMemberAdd`/`guildMemberRemove` (`events/guildMemberAddWelcome.js`, `events/guildMemberRemoveLeave.js`).

**`/boost setup channel:<#channel> message? embed?`** — the per-boost announcement. Unlike a naive `!oldMember.premiumSince && newMember.premiumSince` check (which only catches a member's *first* boost and misses everything after — a member can apply more than one boost), this reads Discord's own `MessageType.GuildBoost` system message (`events/messageCreateBoost.js`), which fires once per individual boost, exactly matching "per each boost" rather than "per member who's ever boosted." **`/boost level-up message? embed?`** is a second, independent message (posted to the same channel) for when the *server* reaches a new boost tier — Discord posts that as a separate `MessageType.GuildBoostTier1/2/3` system message, read the same way. `{server_boostlevel}`/`{server_boostcount}` (already part of the shared variable engine) cover referencing the tier/total in either message.

**`/bumpreminder`** — reminds the server to `/bump` on DISBOARD (app id `302050872383242240`, hardcoded — DISBOARD's own public application id, not a secret) every 2 hours: `channel`, `message` (the reminder itself), `thankyou` (sent right after a successful bump, supports `{nextBump}` — a relative Discord timestamp, plus every general variable), `pingable` (whether the reminder is allowed to actually ping — the bot's global `allowedMentions` default suppresses it otherwise), `autolock` (deny `@everyone` **Send Messages** in the bump channel between bumps, restored when the reminder fires), `autoclean` (delete any non-bot chatter in the bump channel — keeps it bump-only), and `status`. `utils/bumpHandler.js` detects a successful bump by scanning DISBOARD's response embed/content for "bump done"/"bumped"/"check back in 2", then `jobs/bumpReminderJob.js` polls every 60s (same pattern as `expireSanctions.js`) for guilds whose cooldown has elapsed.

## Booster roles (`/boosterrole`, alias `br`)

Ported from "bli"'s `boosterrole.js`/`BoosterRole`/`BoosterRoleConfig` — a custom, self-colored (optionally gradient, optionally iconed) role each Nitro booster can create for themselves, with one deliberate change from the source: bli only ever let the booster themselves touch their own role: Petto adds a full **`admin` subcommand group** that can create/edit/remove *any* member's booster role directly, bypassing their cooldowns and the per-member limit — same DB row and the same `utils/boosterRoleActions.js` `applyRole()` function underneath either way, so self-service and admin-directed creation can never drift into two different code paths.

**Self-service** *(requires actively boosting, except `remove`)*:
- `color hex:<#RRGGBB> hex2:<#RRGGBB>?` — create or update your role's color (a second hex makes it a gradient)
- `rename name:<string>` / `icon input:<url|emoji|sticker id>` / `random` (random color)
- `remove` — delete your role
- `share user:<member>` / `unshare user:<member>` — add/remove another member to your role (they get the same role added to their account) / `shared` — see who it's shared with

**`admin`** *(Manage Server)*:
- `set user:<member> hex? hex2? name?` — direct create/update, no cooldown or limit check
- `rename` / `icon` / `remove` — same actions, targeting any member
- `list` — every booster role in the server, with color and shares
- `link user:<member> role:<role>` — associate an already-existing role as someone's booster role (doesn't create a new one)
- `cleanup` — deletes roles belonging to members who are no longer boosting (manual, matching bli — nothing removes a role automatically the moment someone's boost lapses)
- `base role:<role>` — new booster roles are placed just above this role (defaults to just above Discord's own auto-managed "Server Booster" tag role if never set)
- `limit count:<int>` (per-member role limit, 0 = unlimited) / `share-limit count:<int>` (max members one role can be shared with) / `cooldown type:<color|icon|rename> duration:<string>` (`0` disables that cooldown)

**`filter`** *(Manage Server)* — `add`/`remove`/`list` words that aren't allowed in a booster role's name (checked on both self-service and admin renames).

Not ported: bli's `br dominant` (extract a role color from the booster's own avatar) — it depended on the `canvas` package, a native-compiled image library that's fragile to install on Windows without build tools already set up, for a single cosmetic subcommand. `random` covers "I don't want to pick a color myself" without the dependency risk. Also not ported: the `award` role-on-boost config bli had — it was configurable (`br award @role`) but never actually applied anywhere in bli's own code, so there was no real behavior to port.

## Leveling / rank / leaderboard (`/level`, `/rank`, `/top`)

Ported from "bli" (the `a*L^3 + b*L^2 + c*L` XP curve, `LevelConfig`'s schema, and the embed-style `/rank`/`/top` — deliberately **not** bli's image-based rank card, which needed the `canvas` native dependency) and "urubot" (`_config.js` — the actual admin command surface). The interesting discovery while porting: bli's `LevelConfig` model defines a huge, genuinely well-thought-out set of knobs (curve tuning, per-role/channel multipliers, per-level rewards, notify throttling, ignored channels, join bonus...) but **no command in bli's own codebase ever exposes most of them** — nothing in `commands/` or `slash/` touches fields like `curveA`, `multipliers`, or `rewards` at all, so in practice they could only ever be set by hand-editing the database. `/level` is Petto actually building the missing admin surface, using urubot's `_config.js` as the model for what a real command layer over this schema should look like — this is the literal content of "super configurable" here, not just a label.

**`/level`** *(Manage Server)* — `enable`, `xp min max` (per-message XP range), `voice-xp amount` (XP per voice-minute), `cooldown seconds` (per-member message-XP cooldown), `curve a? b? c? difficulty? rounding?` (the XP formula itself — `/level status` previews levels 10/25/50 under the current curve after every change), `max-level count`, `notify mode:<off|reply|channel|dm> channel? embed? embed_template? every? message?` (the level-up announcement; a saved `/embed` template can provide the full title, description, fields, buttons, and variables, while `message` supports `{user}`, `{level}`, `{level_xp}`, `{level_xp_needed}`, `{level_rank}`, and every general `/embed` variable), `role-mode mode:<highest|all>` (keep only the top earned reward role, or every one earned), `ignore channel:<#channel>` (toggle), `join xp? level?` (starting bonus for genuinely new members — `level` wins if both are set), `sync-join` (retroactively applies the current join bonus to every member sitting at zero XP), `reset user:<member>` (wipes their XP/level and strips reward roles), and `status` (the full current config, one place). Plus three subcommand groups: `reward add/remove/list` (level → role), `multiplier set/remove/list` (role or channel → XP multiplier, the larger of any matching role multipliers combined multiplicatively with a channel multiplier), and `manage xp/level` (admin add/set/remove/transfer XP or levels for a specific member, bypassing all the normal gain logic).

**`/rank user:<member>?`** (aliases `nivel`, `lvl`) — level, server rank (`#N out of M`), XP progress into the current level, and Petto's nine-emoji progress bar in bli's geometry, as a classic embed (bli's exact field layout: author = the member, thumbnail = their avatar) — no rank-card image and no decorative star.

**`/top page:<int>?`** (aliases `leaderboard`, `lb`, `ranking`) — paginated leaderboard (10 per page), same embed style, with ◀️/▶️/✖️ pagination buttons.

XP gain itself: `events/messageCreateLevelXp.js` grants message XP (random within `xp_min`-`xp_max`, multiplied, cooldown-gated) on every non-bot message; `jobs/voiceXpJob.js` polls every 60s and grants `xp_per_vc_minute` (multiplied) to everyone currently connected to a non-AFK voice channel who isn't deafened — no join/leave session bookkeeping needed, it just reads live voice state each tick. Both funnel through the same `utils/levelActions.js` `grantXp()`, so a level-up (reward roles + notification) can never happen differently depending on which source triggered it.

**The progress bar** (`utils/levelProgressBar.js`) uses Petto's 9 custom emojis in a 10-segment bar matching Bli's geometry (start/middle/end × full/half/empty). The rank response stays an embed with no image-based `cardrank` and no decorative emoji in its fields or footer; only the progress bar uses these nine segment emojis.

## AFK / autoresponder / sticky messages / join extras

The rest of "bli"'s standalone systems. Not ported: `disabledms` — bli has a command that toggles a flag, but nothing in bli's own message pipeline ever reads it (the model isn't even imported where DMs are handled), so there was no real behavior to replicate; it also wouldn't do anything in Petto specifically, since prefix commands require a guild (`messageCreateCommands.js` returns immediately in a DM), so the bot never processes "commands via DM" in the first place.

**`/afk set reason:<string>?`** — marks you AFK. Mentioning an AFK member anywhere gets an automatic "**X** is AFK: reason" reply and logs the mention; your own next message (anywhere, not just a command) clears your AFK status and reports how many mentions you got. **`/afk mentions`** lists them (last 3 days, matching bli — `db/afk.js` filters by timestamp at read time rather than running a TTL cleanup job, same precedent as `verification_redemptions`).

**`/autoresponder add trigger:<string> reply:<string> mode? embed? delete_trigger? channels?`** (alias `ar`) — auto-replies when a message matches `trigger` under the chosen `mode` (`contains`/`startsWith`/`endsWith`/`exact`/`regex`), as plain text or (`embed:true`) a classic embed, in every channel or only the ones listed in `channels` (space-separated mentions — same multi-value-string convention as `/case edit-many`'s `cases` or `/ban users`' `users`, now generalized as `channels` too). `reply` supports the same variable engine as `/embed`. `remove trigger:<...>` / `edit id:<...>` / `list` / `show id:<...>` / `reset`, plus a `channel add/remove/clear` group to adjust an existing one's channel restriction. Capped at 100 per server, matching bli.

**`/stickymessage set channel:<#channel> content:<string>`** (alias `sticky`) — keeps `content` as the last message in `channel`: every time someone else posts there, the old sticky gets deleted and reposted at the bottom. `remove channel:<#channel>` / `list`.

**`/dmonjoin setup message? embed?`** (alias `dmjoin`) — a join message sent as a **DM**, entirely independent of `/welcome`'s channel post (different delivery mechanism, so it's its own command) — but it reuses the exact same plumbing under the hood: two new columns on `member_events_config` (`dm_join_message`, `dm_join_embed_template`) and the same `sendMemberEvent()` used by welcome/leave/boost. `status` / `test` (DMs you a preview) / `disable`.

**`/poj add channel:<#channel> delete_after?`** ("ping on join") — mentions a brand-new member in up to 10 configured channels, then deletes that ping after `delete_after` (default `5s`). No persisted "pending delete" table or polling job like bli had — the delete is just an in-memory `setTimeout` set when the ping is sent, since these messages live at most a couple minutes; the only trade-off is a delete getting missed if the bot restarts mid-window, which is an acceptable rarity for a message this short-lived. `remove` / `list` / `enable enabled:<bool>` / `clear`.

**`/steal emoji:<string>?`** — paste a custom emoji (or several) to add them to this server, or reply to a message with a sticker to steal that instead. The sticker-via-reply path needs the real message object (`message.reference`/`message.stickers`), which a genuine slash interaction has no equivalent of — see `rawMessage` under "Command system" above; this command only works right when invoked via prefix, which is fine since everything currently is.

**`/disablecommand disable command:<string> channel:<#channel>?`** (alias `dc`) — turns a command off, server-wide or in one channel. Enforced in `messageCreateCommands.js`, checked right after a command resolves (by canonical name, so disabling it also blocks every alias) and before cooldown/permission checks — a disabled command is silently ignored, same as bli, no "this is disabled" message that would just be noise. `enable` / `list`.

## Giveaways (`/giveaway`, `/giveawaypreset`, `/giveawaytemplate`)

Not a port of bli's giveaway system (bli's is bare — a Mongo model, reaction-only entry, a plain `Math.random()` shuffle, 15s poll, no bonus entries, no claim flow). Instead this follows the design of a reference bot's docs (baobun) that the user pointed at directly: role-weighted entries via presets, a button-or-reaction entry mode, and a claim-time accept/deny flow for winners, all fully configurable — nothing hardcoded to a single "prize/winners/duration" shape.

**Entering**: either a persistent **Enter Giveaway** button (`entry_mode: button`, the default) or reacting with a configured emoji (`entry_mode: reaction`) — clicking/reacting again removes your entry. Button entries are stored directly in `giveaway_entries`; reaction entries are tracked via `messageReactionAdd`/`messageReactionRemoveGiveaway` (needed adding the `GuildMessageReactions` intent + `Partials.Reaction`, not previously enabled). The live announcement card doesn't show a running entry count (it isn't updated after posting, to avoid edit-rate-limit spam on popular giveaways) — entries are only counted at draw time.

**`/giveaway quick duration:<e.g. 10m> winners:<int> prize:<string> channel?`** — starts one instantly with the guild's default entry mode/reaction/embed.
**`/giveaway start ...`** — same plus `claim_time?` (winners must Accept within this window or a new winner is redrawn), `preset?` (a `giveawaypreset`, for bonus entries/claim time by role), `embed_template?` (a `giveawaytemplate`-independent saved *embed*, see below), `entry_mode?`.
**`/giveaway template template_name:<name> channel?`** — launches a full giveaway from a `giveawaytemplate` (prize/winners/duration/preset/embed/entry mode all saved together).
**`/giveaway reroll message_id:<id> winners?`** / **`/giveaway end message_id:<id>`** / **`/giveaway edit message_id:<id> prize? winners? duration?`**.
**`/giveaway embed template:<name>`** / **`reaction emoji:<e>`** / **`entry-mode mode:<button|reaction>`** — guild-wide defaults for new giveaways.
**`/giveaway winner-message|deny-message|claim-time-message|claim-time-over-message|accept-message|no-entries-message message:<string>`** — each is plain text resolved through the normal `{gw.*}`/`{user}` variable engine (not a `response_name` pointing at a shared response library the way the reference docs describe it — Petto already splits "plain text" vs. "named embed template" into separate concepts everywhere else, e.g. `dm_join_message`/`dm_join_embed_template`, so these follow that same convention instead of introducing a new one). If unset, sensible defaults are used.

**Presets** (`/giveawaypreset create|view|remove|add-role|remove-role name:<name> role:<@role> claim_time? entries? claim_time_stack? entries_stack?`) — a preset is a named set of roles, each granting bonus entries and/or its own claim time. `entries_stack`/`claim_time_stack` control whether a member who matches several of the preset's roles gets those roles' values *summed*, or just the single highest one — non-stacking roles among the matches contribute only their best value, stacking roles are added on top of that. A member's total draw weight is `1 + bonus_entries` (everyone starts with 1 entry just by joining).

**Templates** (`/giveawaytemplate create|edit|remove|list name:<name> prize:<string> winners:<int> duration:<e.g. 1h> channel? claim_time? preset? embed_template? entry_mode?`) — a full saved giveaway config, stored as one JSONB row (mirrors `embed_templates`' shape), relaunched by name via `giveaway template`.

**Custom embeds**: a giveaway can reference a saved `giveaway_templates`-style *embed* (confusingly a different table than the giveaway-config templates above — `giveaway_templates` here means "saved embed layout," matching `embed_templates`' JSONB shape, resolved with the `{gw.*}` variables below) via `embed_template`; without one, a default Components V2 card is used. There's no command to create these embed layouts yet from scratch inside `/giveaway` — reuse `/embed create` conventions is the natural next step if this needs a dedicated editor later; for now the JSONB rows are meant to be seeded the same way `embed_templates` rows are.

New variables in `utils/embedVariables.js`: `{gw.prize}`, `{gw.winners}`, `{gw.host}`, `{gw.duration}` (unix timestamp), `{gw.timestamp}` (`<t:...:R>`), `{gw.claim_time}`, `{gw.reaction}`, `{gw.entry_mode}` (`click on`/`react with`), `{gw.preset}`. The templating engine has no real loop syntax, so unlike the reference docs' `{gw.preset}` + `{role.*}` for-loop, Petto pre-renders the preset's role lines (`utils/giveawayEngine.js`'s `buildPresetText()`) into one joined string and maps that directly to `{gw.preset}` — same trick already used for `{choose:a|b|c}`.

Ending is handled by `jobs/giveawayJob.js`, polling every 15s (tighter than Petto's other 60s jobs, and matching bli's own 15s interval, since giveaway end timing is more user-visible than most background checks) — it both closes due giveaways and expires unclaimed winner windows. Denying a win or letting the claim window expire draws one replacement winner from the remaining entrants (excluding everyone already drawn) and restarts the claim flow for them.

## Info / utility commands

The original spec's plain lookup-command category, consolidated where several would've just repeated the same lookup: `created`/`joined`/`joinpos`/`userid`/`roles`/`badges` all live inside `userinfo` instead of being separate one-field commands, and `membercount`/`channelcount`/`rolecount` are fields on `serverinfo` rather than standalone. Everything here is public (no `default_member_permissions` restriction) since none of it is sensitive.

**`/avatar user?`** (alias `av`/`pfp`) / **`/banner user?`** — global avatar/banner, plus a server-specific avatar link if the member has one set.
**`/userinfo user?`** (alias `ui`/`whois`) — account age, server join date + join position, roles, boosting-since, and badges (Discord Staff, HypeSquad, Bug Hunter, etc., decoded from the user's flags).
**`/serverinfo`** (alias `si`/`server`) — owner, member/bot counts, channel/role counts, boost level, emoji count, vanity URL, banner.
**`/channelinfo channel?`** (alias `ci`) — type, topic, slowmode, NSFW, bitrate/user limit for voice.
**`/roleinfo role`** / **`/roles`** — a single role's detail card, or every role in the server with member counts.
**`/emojiinfo emoji`** — decodes a pasted custom emoji's ID/animated flag/CDN URL.
**`/botinfo`** (alias `about`) / **`/ping`** / **`/uptime`** — Petto's own stats, latency, and uptime.
**`/permissions user? channel?`** (alias `perms`) — a member's effective permissions in a channel (accounts for role + channel overwrites, via discord.js's own `permissionsFor()`).
**`/firstmessage channel?`** (alias `fm`) — jump link to the oldest message in a channel.
**`/inviteinfo code`** — looks up any invite code's server/channel/inviter/expiry, even for servers Petto isn't in.
**`/color hex`** — previews a hex color as the embed's accent color, plus its RGB breakdown.

## Reaction roles (`/reactionrole`, alias `rr`)

**`/reactionrole add message_id:<id> emoji:<e> role:<@role> channel? mode?`** — binds an emoji on an existing message to a role; Petto reacts with that emoji itself so members have something to click. `mode`: `toggle` (react adds the role, un-react removes it — the default), `add` (react adds, un-reacting does nothing), or `remove` (reacting *removes* the role instead, for e.g. an opt-out button). `remove message_id emoji` / `list message_id` / `clear message_id`.

Handled by `messageReactionAddRoles.js`/`messageReactionRemoveRoles.js` — separate listener files from the giveaway ones, since a server can have both giveaway reactions and reaction-roles active on different messages at once; each just no-ops if the reacted message isn't theirs to care about.

## Custom commands (`/customcommand`, alias `cc`)

Admin-defined commands that reply with a saved message — different from `/autoresponder` (which matches text *anywhere* in a message under contains/exact/regex) in that these behave like a real command: `!rules` only fires on that exact trigger, the same way `!ban` does, not as a substring match. Capped at 100 per server, and a name already claimed by a real command (or its alias) is rejected outright.

**`/customcommand add name:<name> response:<string> embed_template?`** — `response` supports the same `{user}`/`{server_name}`/... variable engine as `/embed`; `embed_template` (a saved `/embed` template name) takes priority over `response` if both are set. `edit` / `remove` / `list` / `show name:<name>`.

Wired into `messageCreateCommands.js`: when the typed word doesn't match any real command or alias, it now checks `custom_commands` before giving up silently (previously that branch just `return`ed) — so a mistyped real command still costs one cheap DB lookup, but nothing is ever double-triggered since custom command names that collide with a real command are rejected at creation time.

## Reminders (`/remind`)

**`/remind add duration:<e.g. 10m> message:<string>`** — pings you back in the same channel once the timer's up (not a DM, so it can't silently fail against closed DMs). `list` / `cancel id:<id>`. Capped at 25 active reminders per user per server. `jobs/reminderJob.js` polls every 30s.

## Invite tracking (`/invites`)

Tracks who invited whom by diffing each guild's invite `uses` counts on every join — Discord doesn't report "which invite was used" directly, so `utils/inviteCache.js` keeps an in-memory snapshot per guild (warmed at startup in `ready.js`, kept current via `InviteCreate`/`InviteDelete`), and `guildMemberAddInviteTracking.js` re-fetches on each join and finds whichever code's `uses` went up since the last snapshot. Requires **Manage Server** (needed to read invite use-counts at all) — silently no-ops per-guild without it, same as other permission-gated features.

**`/invites user user?`** — net invites (joins − leaves) for a member, defaulting to yourself. **`/invites top`** — a per-server leaderboard. A member who leaves and rejoins is re-attributed to whoever's invite they used *this* time (their `member_invites` row is overwritten, not appended), and their inviter's leave count increments once per departure via the `increment_invite_stat()` RPC (same atomic-upsert pattern as leveling's `add_level_xp()`).

Not tracked: vanity-URL joins and joins via a temporary/expired invite that's already gone by the time the join event fires both fall through as "no attributable inviter" (`inviter_id: null`) rather than erroring.

## Audit logging system

Ported from an earlier bot's `handlers/logs/*` + `/log` command (originally MongoDB + a prefix command) to Supabase/Postgres + a slash command. This is a full audit log: 9 independent event categories, each routed to its own channel through a dedicated webhook, with per-event color overrides and an ignore list. There's no separate single mod-log channel setting — sanctions log through this same system, under the `sanctions` category, alongside the other 8.

**`/logs add channel:<#channel> event:<category>`** — start logging a category to a channel (creates a webhook in that channel the first time it's used)
**`/logs remove channel:<#channel> event:<category>?`** — stop logging one category, or all of them, in a channel (cleans up the webhook once nothing references it)
**`/logs color set channel:<#channel> event:<category> color:<#hex>`** / **`/logs color list channel:<#channel>`** — override an event's embed color per channel
**`/logs ignore toggle user:<@user>|channel:<#channel>`** / **`/logs ignore list`** — exclude a user or channel from being logged
**`/logs view`** — show everything currently configured

Event categories: `messages` (delete/edit/bulk-delete), `members` (join/leave/nickname/username/avatar/ban/unban), `roles` (role CRUD + member role changes), `channels` (channel CRUD), `invites` (create/delete), `emojis` (add/remove/rename), `voice` (connect/disconnect/move/mute/deafen/stream), `server` (name/icon/banner/description changes), `sanctions` (every `/ban`, `/kick`, `/mute`, `/warn` case, including mass-action, auto-expiry, and automod-triggered cases), `verification` (successful Turnstile passes), `automod` (the raw detection behind an automod-triggered case, plus anti-raid/anti-nuke alerts, which aren't tied to any single case), `tickets` (open/claim/unclaim/close/reopen/delete/add-member/remove-member/rename, plus the transcript file itself on close or on-demand).

Delivery is via per-channel webhooks (like the original), not a bot-sent message — that's why **Manage Webhooks** is required both for the bot's invite and for whoever configures `/logs add`. A moderator's own actions never trigger a log about themselves (e.g. editing your own message, changing your own nickname) — matches the original's ignore-the-actor behavior. `sanctions` entries are the one exception: they're never self-triggered since a moderator sanctioning themselves isn't a supported flow (`canModerate` blocks self-targeting).

Not ported: the original enriched member-join logs with "invited by X" via a separate invite-tracking subsystem (in-memory invite-use-count cache + a weekly/total stats model). That's a distinct feature from logging and was left out — joins are still logged, just without invite attribution.

## Named embed builder (`/embed`)

Ported from an earlier bot's embed system — specifically its **slash-command** interface (`slash/embed.js` + `utils/embedStore.js` + `handlers/embedPanel.js` + `utils/variables.js`), not its parallel prefix-command interface. That older bot had two independent ways to build embeds: a `$b`-segment raw-code format (`utils/embedParser.js`, e.g. `{title: Hi {user}}$b{color: #ff0000}`) exclusive to its prefix commands, and a structured JSON-field format used by its slash commands and an interactive modal panel. Only the structured half was ported — the raw-code format has no natural home here either, since `/embed`'s own fields (`edit title`, `edit description`, ...) already cover the same ground through Petto's now-prefix `!embed edit title ...` invocation, rather than a parallel inline syntax.

**`/embed create name:<name>`** — creates an empty named embed and opens an interactive panel: buttons for Title/Description/Color/Author/Footer/Thumbnail/Image/Timestamp/Add Field, each opening a modal (`interactions/embedPanel.js`). The panel previews without resolving variables (so it renders instantly without a live guild/member context); `/embed preview` shows the real, variable-resolved version.
**`/embed edit <title|description|color|author|footer|thumbnail|image|timestamp> embed:<name> ...`** — same fields, as one-shot slash options instead of the panel, for quick edits without opening a modal.
**`/embed field add|remove embed:<name> ...`** — up to 25 fields per embed.
**`/embed preview embed:<name>`** / **`/embed send embed:<name> channel:<#channel>?`** — render with variables resolved (preview: ephemeral reply; send: posts for real, defaults to the current channel).
**`/embed list`** / **`/embed delete embed:<name>`**
**`/embed vars [page]`** — paginated reference of every placeholder usable inside embed fields (kept as a subcommand rather than a separate `/vars` command, for the same 100-command-cap reason as the moderation commands).

Variables (`src/utils/embedVariables.js`) cover the user (`{user}`, `{user_avatar}`, `{user.join_position}`, ...), the server (`{server_name}`, `{server_membercount}`, `{server_randommember}`, ...), the channel, the date, and a couple of functions (`{choose:a|b|c}`, `{range:1-100}`, `{newline}`). Not ported: the original's `{level}`/`{xp}`/`{rank}` (no leveling system yet), `{message_*}` variables resolve empty since slash commands have no triggering message to point at, and the whole `{noping}`/`{dm}`/`{sendto:}`/`{react:}`/behavior-flag mini-language — those were parsed by the `$b` raw-code parser specifically, which wasn't ported.

Storage is one `embed_templates` row per `(guild_id, name)`, with the whole embed (`title`, `description`, `color`, `author`, `footer`, `fields`, ...) as a single JSONB `data` column, mirroring the original's flexible Mongo document shape.

## Not built yet

`/config`/`/settings` (a single catch-all settings command — most of what it would cover already has its own dedicated command instead, e.g. `/prefix`, `/welcome`, `!automod`) and `/poll` remain out of scope. `whitelist.js` (bot-owner cross-guild access control from an earlier bot) and `customrole.js` (redundant with `/boosterrole`) and `nuke.js` (destructive channel-clone utility) were flagged during the bli inventory but deliberately not ported. The structure (dynamic command/event loading, DB-backed guild config, shared permission/embed/modlog utils, and the 100-command-cap-aware subcommand grouping) is built so each of those is a new file or a new subcommand, not a rearchitecture.

Two smaller, lower-priority moderation gaps also remain open: `/channel clear` has no keyword/attachment filter (it only bulk-deletes by count and/or author), and cases have no evidence-attachment support (screenshots/links attached to a `mod_actions` row).-
