# Changelog

All notable changes to Petto are documented here.

## [Unreleased]

### Changed

- When Discord does not let `!channel create` make a media channel, the answer says that the server needs Community and monetization turned on.

### Added

- `!channel create <name> [type] [category] [topic] [nsfw]` creates a channel: text, announcement, voice, stage, forum, **media** or category. For now only the owner and the developers of Petto can use it. Forum and media channels need Community to be enabled in the server, and the answer says so when it is not.
- `!quests resend` sends the quests that are active now, pass your filters and were never posted in the server (the ones whose alert failed because of the long link, and the ones that were already running when the alerts were turned on), up to 10 at a time, oldest first, with a pause between messages. Run it again if it says more are left.

### Fixed

- The total of members in the status messages dropped by a whole server when Discord gave no member count for it for a moment. Each server keeps its last good count now.
- `!channels` showed every text channel as a giant heading, because its line started with `# `. Text channels start with 💬 now.
- Quest alerts failed with "url: Must be 512 or fewer in length" when the game page of a quest had a very long address: that button (or a picture with an address over 2048 characters) is now left out instead of Discord refusing the whole message. A message that Discord refuses is no longer sent again in every pass, which filled the rate limit of the channel.

## [0.7.1-2] — 2026-10-05 · Boba

A small release, shown as **0.7.1~2**, for the dashboard.

### Added

- The newest Discord timestamp styles (short date with short time, and with seconds) work in `{timestamp:...|short_datetime}` and `{timestamp:...|medium_datetime}`, and have their own variables `{timestamp.short_datetime}` and `{timestamp.medium_datetime}`.
- The dashboard can start a giveaway, end it now and draw new winners, with the same engine as `/giveaway` (so the result is the same). The person must manage the server, and the duration is written in words (`1h`, `3d 4h`).

### Fixed

- The page buttons of lists (`!roles`, `!emojis`...) failed with "Component custom id cannot be duplicated" on some pages, because two buttons went to the same page. Every button has an id of its own now.

## [0.7.1-1] — 2026-10-05 · Mochi

An improvement release, shown as **0.7.1~1**. From now on every version has a name.

### Added

- Long lists come a page at a time with buttons: `!roles` (with a menu to sort it by members, newest, oldest or name, or to show only roles with a color or without members), and the new `!emojis`, `!channels`, `!boosters` and `!inrole <role>` (also `!members`). Only whoever asked can turn the pages, and the buttons keep working after a restart.
- `!disablecommand disable` takes several commands at once (`roles emojis channels`), `enable all` clears every rule, and `list` has pages. `disablecommand` and `help` cannot be disabled. A disabled command is also blocked as a slash command.
- Times are written in words wherever a command asks for a length: `3d 4h`, `1 hour 30 minutes`, `1h30m`, `2 horas y 15 min`. `!remind` also takes a moment (`tomorrow 8pm`, `mañana 20:00`, `2026-10-12 18:00`, a Discord timestamp).
- New variables for dates: `{timestamp}`, `{timestamp.unix}`, `{timestamp.short_time}`, `{timestamp.long_time}`, `{timestamp.short_date}`, `{timestamp.long_date}`, `{timestamp.full}`, `{timestamp.full_long}`, `{timestamp.relative}` and `{timestamp:in 2h|R}` for any moment written in words (after `|` the style).
- The `site_team` table holds the people of the public team page, so the owner can edit it from the dashboard.
- `!version` shows the name of each release.
- The online line of the log shows the version of the bot.
- Polls are now Components V2 messages: a card with the question, a bar for each option and the votes below. In the poll panel, **Design** picks one of your saved V2 embeds instead, with the new variables `{poll.question}`, `{poll.options}`, `{poll.results}`, `{poll.votes}`, `{poll.votes_text}`, `{poll.type}`, `{poll.status}`, `{poll.ends}`, `{poll.image}`, `{poll.host}` and `{poll.winner}`; the vote buttons stay under it. The dashboard asks the bot to draw polls too.
- Partners: the cooldown is written as a time (`!partnerconfig requirements cooldown:"3d 4h"`), a server can refuse NSFW servers (`block_nsfw`) and servers with some words in their name or description (`keywords`), and a new Partner Manager is welcomed in a channel of your choice (`!partnerconfig welcomechannel`), also when they are given the role. There are two new replies (`nsfw_blocked`, `keyword_blocked`) and new variables: `{partner.rank_week}`, `{partner.rank_total}`, `{partner.top_week}`, `{partner.top_week_count}`, `{partner.top_total}`, `{partner.top_total_count}`, `{partner.server_day}`, `{partner.server_week}`, `{partner.server_total}` and `{partner.cooldown}`.
- Saved embeds can carry reactions: a `reactions` list (up to 5 emojis, the same as writing `{reactreply:emoji}` for each one) that Petto puts on the message when it sends it, with `!embed send`, sticky messages, partner replies, the uploads welcome, panels and honeypot messages, besides autoresponders and custom commands.
- Honeypot: `!honeypot panel <channel> <default|custom|none>` chooses what is posted in the bait channel: Petto's warning panel, your own text and/or a saved embed (with `{honeypot.action}`, `{honeypot.count}` and `{honeypot.channel}`), or nothing at all. `!honeypot list` shows which one each channel uses.
- The bot keeps a saved copy of each server for the dashboard (name, icon, banner, members, emojis, boosts, how the bot looks in it, channels and roles) in the new `discord_guild_snapshots` table. Changes are saved a few seconds after they happen and a full pass runs every 10 minutes, so the web can read them from the database instead of asking Discord on every page.

### Changed

- The public stats page ranks the top 5 servers (it was 3).

## [0.7.1] — 2026-10-03

Partners, uploads, requests, reviews and profiles, buttons and panels with no code, saved embeds for sticky messages, and quest alerts that no longer depend on one source.

### Added

- Reviews and profiles: `!review give @member 4 "comment"` rates a member from 1 to 5 stars (one review per pair, sending it again changes it), `!review show` and `!review remove`; `!profile` shows when they joined, their rating and the numbers of the modules the server uses (uploads, requests and partnerships). `!profileconfig` turns reviews off or sets a channel where each new review is shown.
- Requests: `!request make <text>` posts a card with Claim, Done, Unclaim and Cancel buttons for the staff, and `!request list` shows the open ones. `!requestconfig` sets the channel, the staff role (or who can manage messages), a role to ping, how many open requests a member can have, the answer to who asks (text or a saved embed with `{request.*}` variables), and, with Premium, the hours a claimed request has to be finished before it goes back to open by itself.
- Uploads: the messages with files posted in the channels a server chose are counted per member. `!uploadconfig` sets the channels (Free 20, Premium 100), the uploader role and the welcome of a first upload (text or a saved embed); `!uploads stats` and `!uploads leaderboard` show today, this week and all time.
- Button responders and panels, with no code: `!responder add` makes a button (or a choice of a menu) that answers with a private message (text or a saved embed) and gives, takes or toggles roles, with an optional required role; `!panel` makes the message that shows some of them as buttons or as one dropdown menu (an exclusive menu takes the other choices' roles back), posts it, and updates it in place. Free servers can have 20 responders and 10 panels, Premium 250 and 50.
- Sticky messages can be one of your saved embeds (a classic embed or a Components V2 design) instead of plain text, with the text as a fallback when the embed is missing: `!stickymessage set #channel - template-name`, or from the dashboard, where a sticky can now also be edited in place.
- Partners: a partnership is counted when a Partner Manager posts the invite of another server in a partner channel and it passes the requirements of the server (minimum members, minimum age of the server, a cooldown with the same server, a blacklist, and not its own invite). `!partnerconfig` sets the channels, the Partner Manager role, the requirements, the blacklist and every reply (with text or one of your saved embeds, using the new `{partner.*}` variables); `!partner stats` and `!partner leaderboard` show today, this week and all time. Free servers can have 6 partner channels, Premium 25.
- Quest sources: the bot now reads four public copies of the quest list and any of them can announce a quest. The first is the short list of recent quests of the discord-api-tracker repository, which its own job refreshes within minutes of a quest starting (the Where Winds Meet 700 Orbs quest was there about 10 minutes after it began, hours before the other files); then the community API, discord-api-diff and the tracker's big file. `!quests status` lists all four.
- The region and age limits are read from the community API and, when it is down, from the tracker's own list, and are applied to every source.
- The community API (behind Cloudflare, with a daily limit of its own) is asked at most every 30 minutes, and each rate limit in a row doubles the pause up to 1 hour, so it comes back soon after its daily limit resets.

### Fixed

- Quest alerts missed quests that were published before they started. The sources (a file on GitHub and a community API) often list a quest hours before it begins, and when the file had not changed since the last check the whole pass was skipped, so the quest that had just started was not looked at until the file changed again (sometimes many hours later). The pass now always runs on the list it already has, so a quest is announced within 5 minutes of starting, and the ending-soon alerts no longer wait for the file to change either. A quest that started and was missed is announced at the first check after the update.

## [0.7.0] — 2026-10-03

A big release: **Petto Code** (custom commands written in code, open to every server) with buttons, forms and reactions, an editor in the dashboard, Quest alerts, Components V2 embeds and global stats.

### Added

- Custom commands in code are **open to every server**, with no flag to turn on: anyone with the Manage Server permission can write them in Discord and in the dashboard editor. The number of custom commands (in code or not) follows the plan: **Free 50, Premium 100** (it was 25 and 100 in the dashboard and 100 for everyone in Discord, and now both say the same). A full Free server is told that Premium raises it to 100, and the list shows `used/limit`. `CODE_COMMANDS_PUBLIC` and `CODE_COMMAND_TESTER_IDS` are gone; `CODE_COMMANDS_DISABLED=true` turns writing them off again if it is ever needed.

- `cembed` takes `"authorIcon"` (a link, such as `.User.Avatar`), `"authorUrl"` and `"footerIcon"`, so the avatar can go next to the author. `.Message.Embeds` also gives `AuthorIcon` and `FooterIcon`. Four new templates: `profile` (a member card with their avatar), `rolebutton` (a button that gives or takes a role), `reactrole` (react to get a role) and `report` (a button that opens a form). `request` and `claim` now show the avatar and keep it when the card changes.

- `.Message.Embeds` also gives each embed's `Author`, `Thumbnail`, `Image` and `Color` (a number), so a button, a modal or a reaction can change the footer or the text of an embed and keep the rest of it.

- Commands in code can **react to reactions**. A message sent with `complexMessage` and `"reactions" (cslice "🦋" "🎀")` gets those reactions (up to 5), and for a week, when someone reacts to it with one of them, the same command runs again with `.Trigger` set to `"reaction"`, `.Reaction.Emoji` (the emoji as the code wrote it) and the person who reacted as `.User` and `.Member`. There, `updateMessage` changes the message that was reacted to (an embed, the text, the buttons), `respond` sends a message in its channel, `removeReaction` takes that person's reaction away (so a reaction works like a button that can be used again), and `addRole`, `removeRole`, `sendMessage`, `addReaction`, `dbSet` and the rest work as always, with the same checks. The messages are remembered apart from the stored data (they do not count towards its limit, and the keys that start with `rx:` are reserved). Added the `claim` template (a request card claimed with 🦋 and confirmed by who asked with 🎀).

- Commands in code can open **modals**, the forms that pop up in Discord. `ctext` makes a field (id, label, short or paragraph, placeholder, a value to start with, required, least and most characters), `cmodal` puts up to 5 of them in a form with a title, and `showModal` opens it when someone uses a button or a menu. When the form is sent the same command runs again with `.Trigger` set to `"modal"`, `.Modal.ID` and `.Modal.Data`, and `.Fields` with what was written in each field (`.Fields.reason`); `respond` answers it in private or for everyone, and `updateMessage` changes the message the button was on. A modal cannot open another modal (Discord does not allow it). Two new templates use them: `request` (a card with buttons to claim and to confirm the delivery) and `suggest` (a button that opens a form and posts the suggestion).

- The dashboard can now write commands in code: new routes give its editor the functions and the ready-made templates, check the code while it is written (with the line and the column), test it with memory-only storage (it says what it would print and do, and sends and saves nothing), and save it and set its trigger. Saving, testing and triggers follow the same rules as `!customcommand` (same permission, same names, same checks, same testing-period gate), because the checks now live in one place that both use. Added `scripts/check-code-routes.js` to `npm run check`.
- Custom commands can start on **their own prefix or words**, not only on the prefix of Petto. `!customcommand trigger <name> <type> [text]` sets it: `prefix` (its own prefix of up to 5 characters, so `?hello`), `startswith` (a message that starts with some words, `hey bot, ...`), `exact` (a whole message, `good morning`) and `contains` (words inside a message, such as `pizza`), and `command` goes back to the prefix of Petto. The case does not matter, a word is never cut in the middle, the rest of the message is given as the arguments, and a command with a trigger of its own is not also set off by the prefix of Petto. A server can have up to 25 commands with a trigger, the ones of each server are kept for a minute so a message never costs a read of the database, and `!customcommand list` shows them. Added `scripts/check-code-triggers.js` to `npm run check`.

- Commands in code can have **buttons and menus** that run code. `cbutton` (label, emoji, style, id, data, a link, disabled, who may use it), `cselect` (a menu of up to 25 options) and `crow` build them, and `complexMessage` sends them with `"components"`. When someone uses one, the same command runs again with `.Trigger` set to `"button"` or `"select"`, `.Button.ID` and `.Button.Data`, and `.Values` for a menu, so one command holds the whole system. `respond` answers the click (in private if asked), `updateMessage` changes the message the button is on, and `.Message.Embeds` gives the embeds that message has. What a click does is held to the same checks as a command (roles, channels, pings), the answer goes first because Discord only waits three seconds, and a click that does nothing is just acknowledged. Three new templates use them: `vote` (a yes or no vote that counts), `clicker` and `favorite` (a menu).
- Commands in code can **remember things**. `dbSet`, `dbSetExpire`, `dbGet`, `dbDel`, `dbIncr`, `dbTop` and `dbKeys` store text, numbers, lists and maps under a key, for the whole server or for one member (a counter, a score, a ranking, a cooldown, a list), up to 500 values per server and 4,000 characters each, and a value can expire. The data can live in its own PostgreSQL database with `PETTO_CODE_DATABASE_URL` (the main database is used when it is not set), expired values are removed every hour, and `codetest` uses a memory-only store, so trying code never changes what the server stored. The language now runs asynchronously: waiting for the data does not count as running the code (250 ms of running and 3 seconds in total), and a run can make at most 25 reads and writes. Added `scripts/check-command-data.js` (it runs the stored data against a real database when `PETTO_TEST_DATABASE_URL` is set) to `npm run check`.
- Custom commands can now be written in **Petto Code** (open to every server that can manage commands; `CODE_COMMANDS_DISABLED=true` turns it off). `!customcommand code <name>` saves the code (inside a code block if it has several lines, which are kept), `codetest` runs some code showing what it would print and do without sending or changing anything, `codeshow` shows it, `template` lists ready-made commands (hello, roll, 8ball, choose, userinfo, serverinfo, avatar, say, countdown) and installs one, and `export` / `import` share a command as a `pc1.` code. A command reads who used it, the server, the channel and the arguments, and can send messages and embeds, send a direct message, give or take a role, react and delete the message that used it. What it does is checked first: it cannot send where the member or Petto cannot, it never pings `@everyone` or `@here` and only pings what it mentions on purpose, it cannot give roles that are above Petto, managed or with moderation or server permissions, and each use has a short cooldown. Mistakes in the code are told in the channel, with the line. Added `scripts/check-code-commands.js` to `npm run check`.
- Added the engine of **Petto Code**, the language for the coming custom commands written in code, made of text with `{ }` actions, variables, `if`/`else if`/`else`, `range`, `with`, pipes and about 60 functions (math, text, lists and maps, mentions, time, `cembed` and `complexMessage` for embeds). Running code only gives back the text and a list of actions (`sendMessage`, `sendDM`, `addRole`, `removeRole`, `addReaction`, `deleteTrigger`); it never touches Discord, and it has limits on steps, time, loops, output and actions. Nothing uses it yet. Added `scripts/check-petto-code.js` to `npm run check`.
- Added the data for the public **global stats** page: every minute the bot saves the messages, reactions and voice time of all servers (all time, today and the last 7 days) and a ranking of the top 3 servers and of the top 10 members. Every server and member can appear by default; a server hides itself in the dashboard (General) and a member with `!globalranking off` (`on` brings them back), and the totals never name anyone. The member ranking is read every 10 minutes. It uses the activity the bot already counted, so the numbers start from when each server began to be counted. Added `scripts/check-global-stats.js` to `npm run check`.
- Added **Components V2 templates**: a saved embed made in the dashboard's V2 editor (containers, text, pictures, sections, dividers and rows of link buttons) can now be sent. Its texts and links use the usual variables, and anything Discord would refuse is cleaned or left out (an empty text, a picture whose link is empty, a button without a label, more than 40 components or 4000 characters of text). It works in the quest alerts (the role ping goes first and the credit last, inside the message), in the places that choose a saved embed for sanctions, the starboard, verification and bump messages, and in `!embed send` and `!embed preview`. Other senders do not know V2 yet and keep sending their usual message. Added `scripts/check-embed-v2.js` to `npm run check`.
- The quest alert card now follows the layout of Discord's own quest bots: the quest name as a linked title with its picture, the dates, platforms and tasks (with the time as a clock), the rewards (Orbs with the Nitro amount, or the collectible and when it expires) and the limitations (the countries with their flags, and 18+), then the buttons to accept the quest and to open the game page. The rewards block shows a picture: the Orbs icon for Orbs, and the avatar decoration for a decoration (read from Discord's own product data, and left out if it cannot be read). `quests list` now shows each quest as text (reward, task, end and its limits), 10 to a page with page buttons, plus a menu with an icon for each kind of reward to see one in full, only for who picked it. Quest messages have no color by default; `quests color` still sets one. A source that answers "too many requests" is left alone for a while and the other one keeps the alerts going.
- Added **quest alerts** (`!quests`), in testing: a message in a channel when a new Discord Quest appears, with a role ping, filters by reward (`orbs`, `decoration`, `code`, `ingame`, `nitro`) and task (`video`, `play`, `stream`, `activity`), and an alert some hours before a quest ends. The default message is a Components V2 card with the quest's picture, reward, tasks, platforms, dates and limits, a button to accept the quest, and a color and sections the server can change (`quests card hide image`, `quests color #ff91c2`). A saved embed can replace it (`quests style template <name>`) with the new `{quest.*}` variables. The first check only remembers the quests that exist, so nothing old is posted.
- The data comes from the community API `api.discordquest.com`, which allowed Petto's team to try it, and from the GitHub repository `aamiaa/discord-api-diff`, which archives Discord's own quest data and is the first to have a new quest, so one being late or down does not stop the alerts. The alerts are open to every server, and anyone can use `!quests list` to see the active quests, while the settings and the test need the Manage Server permission; set `QUESTS_PUBLIC=false` to limit `!quests` to the owner, the developers and the people in `QUESTS_TESTER_IDS`. Every alert credits both sources. They are asked every 5 minutes with an ETag, and only when a server uses the alerts. A quest that is listed before it starts is announced when it starts.
- Added `scripts/check-quests.js` to `npm run check`.

### Fixed

- Reactions on commands in code failed now and then. A message was written down only after all its reactions were on, so a quick reaction found nothing and that message was skipped for five minutes; it is now written down first, a message that is new is never skipped, and a skipped one is looked at again after one minute. An emoji is compared by its id (custom ones) or without the invisible variation mark (`❤` and `❤️` are the same), the code gets the emoji as it wrote it in the list, a message the bot could not read is looked up instead of ignored, the lookup and the member are tried twice, a reaction that adds does not fail on a busy moment (each reaction is tried twice), a message answers for a month instead of a week, and when the code of a reaction stops or the member cannot be read the reason is logged.

- The database of stored data (`PETTO_CODE_DATABASE_URL`) no longer asks for SSL unless `PETTO_CODE_DATABASE_SSL=true` (it follows `DISCLOUD_DATABASE_SSL` when not set), so a database that does not support it, like Discloud's, works instead of failing with `The server does not support SSL connections`.
- The dashboard could not add or open custom commands: its database API did not understand a negated filter such as `code=not.is.null`, and answered `Invalid PostgreSQL filter.` It now reads `not.<operator>.<value>` for any operator.
- The Cloudflare tunnel's output no longer puts its token in the logs: `cloudflared` printed the environment variables it could see, so the tunnel now starts without the token variables and every line is cleaned before it is logged. If an old log with the token was shared, create a new token in Cloudflare.

## [0.6.1] — 2026-10-02

### Added

- Added the Premium **name style** of the bot per server, set in the dashboard's Customize page (gradient, neon or glow, like the name styles of Nitro). It is stored with the server's settings and cleared, in Discord too, when Premium ends.
- Added **custom embeds for every message of the bot**: a saved embed (with an image card if it has one) can now replace the usual message of sanctions, the starboard, giveaways, verification and bump reminders. Sanctions have three slots per type (`ban`, `kick`, `mute`, `warn`, `jail`...), the DM to the member, the reply where the command was used and the sanctions log entry, set with `!sanctionmessage set|clear|list`, with `default` covering every type that has no message of its own. The starboard uses `!starboard message`, giveaways `!giveaway message-template` (winner, deny, claim time, claim time over, accept, no entries), verification `!verify template` (the link DM and the verified DM) and bump `!bumpreminder template`. A template that is missing or broken never stops the action, the usual message is sent instead.
- Added variables for them: `{case.id}`, `{case.type}`, `{case.action}`, `{case.reason}`, `{case.duration}`, `{case.expires}`, `{case.moderator}` and `{case.user}` families for sanctions, `{star.count}`, `{star.link}`, `{star.content}`, `{star.image}` and more for the starboard, `{verify.link}` for verification and `{nextBump}` for bump messages.
- Added `scripts/check-sanction-templates.js` to `npm run check`.
- **Leveling v2.** `!rank` now answers with a rank **card** (a picture with the avatar, name, level, rank and a progress bar), the improved **embed**, or both: `!level rank-style`. The embed keeps its progress bar and now shows the rank out of the ranked members, the XP to the next level, messages or time in voice, the streak and the position this week. Rank cards are made in the dashboard (Image cards) with two basic layouts and a new progress bar layer; a server without a card uses a default one, with its own color for voice.
- Anti-abuse rules (`!level rules setting value`, for example `!level rules min_chars 5`): messages shorter than a set length, links and mentions left out, and the same text again within a minute earn no XP; voice XP needs a minimum number of people in the channel and can skip muted members. New servers get 3 characters, repeat protection and 2 people in voice by default.
- **XP events** (`!level event add|remove|list`): a multiplier for a number of hours or days, for all XP, messages only or voice only, started now or later.
- **Daily bonus and streaks**: extra XP for the first activity of the day plus an extra amount for each earlier day in a row (`!level rules daily_bonus streak_bonus streak_max_days`). The streak shows in `!rank`.
- **Weekly and monthly rankings**: `!top 1 messages week` and `!top 1 messages month`, for messages and voice. They start empty by themselves each week and month.
- The level-up message can carry an image card (`!level notify card:` and `!level voice-notify card:`).
- New variables for messages and cards: `{level_next}`, `{level_progress}`, `{level_xp_current}`, `{level_xp_to_next}`, `{level_rank_total}`, `{level_streak}`, `{level_messages}`, `{level_voice_minutes}` and `{level_type}`.
- Image cards have a **progress bar** layer and a `kind` (welcome or rank). Added `scripts/check-level-command.js`, `scripts/check-leveling.js` (also checks the SQL on a database when `PETTO_TEST_DATABASE_URL` is set), `check-rank.js` and `check-xp-grant.js` to `npm run check`.
- Added **image cards**: a picture drawn for a message, with the member's name and avatar, the server's member count and any other variable. A template can point at a card and it is sent with the welcome, leave and boost messages, tickets, giveaways, level-up messages, autoresponders and `!embed send`. The basic editor (four layouts, colors, a background image, free fonts) is free; the advanced layer editor and the extra fonts need Premium, and a card that used them keeps working with its basic settings if Premium ends. Pictures can come from an https link or be uploaded in the dashboard. Links are only fetched from the public internet.
- Added `scripts/check-cards.js` and `check-card-routes.js` to `npm run check`.
- Added `!embed create name code:`: the whole embed can be written as one code, such as `{embed}&v{title: Welcome {user}&v{description: Read the rules}&v{color: #ff91c2}`, and is saved and shown at once, without the editor panel. The format follows the embed scripting other bots use: blocks joined by `&v` (`$v` is read too), `&&` between the values of a block, and text before `{embed}` or `{message: ...}` for the message text. Blocks: `title`, `url`, `description`, `color`, `thumbnail`, `image`, `author`, `footer`, `field`, `timestamp`, `button` (link buttons) and `message`. Anything unsupported is reported and left out, nothing is saved if Discord would refuse the embed, and variables such as `{user}` work inside values. Discord does not allow real line breaks in a command option, so a line break is written `{newline}`, and the blocks can be glued together or spread over lines. `!embed create` without a code opens the editor panel as before. A code with message text or buttons is saved in the dashboard's format and is edited there.
- Added a page about the embed code to `!embed vars`.
- Added `scripts/check-embed-script.js` to `npm run check`.
- Added **jail** (`!jail`, `!unjail`): a jailed member loses their roles and can only see the jail channel, where they can talk to staff. `jail setup` creates the Jailed role and the #jail channel and hides every other channel from the role; `jail user <user> [duration] [reason]`, `jail remove`, and `jail list` do the rest. The roles are saved before anything changes and given back on release, a timed jail ends by itself, a jailed member who leaves and rejoins is jailed again, new channels are hidden automatically, and a role handed to a jailed member by another bot is taken off again and kept for release. `warn escalation` can now use `jail` as its action.
- Added `!purge <amount> [user] [filter] [text]`: scans the last 1 to 500 messages and deletes those that match a member, a kind (`bots`, `humans`, `links`, `invites`, `attachments`, `images`, `embeds`, `mentions`) and some text. Pinned messages are kept.
- Added `!history [user]`: status (banned, in jail, timed out, muted), totals by kind, active warnings, staff notes, reports about the member and the latest cases, in one card.
- Added reports management: every report is numbered and stored, the report card has **Claim**, **Resolve**, **Dismiss**, **Release** and **Reopen** buttons, and `!report list`, `view`, `stats`, `block`, `unblock` and `blocklist` for staff. Reporters choose a category; servers can set a cooldown, a daily limit, a required reason, a role pinged on every report, a discussion thread per report and a DM to the reporter when a report is closed. Anonymous reports stay anonymous in every view.
- Added the **Report User** user context menu next to **Report Message**.
- Added **Report User** to the message Apps list too, so the person who wrote a message can be reported next to **Report Message**. Context menus are now keyed by name and type, so a user menu and a message menu can share a name.
- `report config` is now a settings panel with selects and switches, a limits form and a **Send test report** button that also checks Petto can post in the channel.
- Added `!roll` (`2d6+3`, `d20`, `4d6kh3`), `!choose`, and the fun commands `!8ball`, `!ship` and `!rps` in a new **Fun** help category.
- Added `scripts/check-reports.js`, `check-jail.js`, `check-purge.js`, `check-dice.js` and `check-fun.js` to `npm run check`.

### Changed

- `!embed create` (and the embed panel and the code page of `embed vars`) now name their commands with the prefix that was typed, such as `!embed edit`, when they are run from a message, instead of always showing `!embed edit`.
- An embed code can now hold several embeds (`{embed}&v{...}&v{embed}&v{...}`, up to 10). When two codes are pasted one after the other and the first lost its closing brace, the first block is closed where the next `{embed}` starts instead of swallowing it as text, and a spare closing brace is reported and skipped instead of stopping the reading.
- `!8ball`, `!rps` and `!ship` now answer with a plain message instead of an embed. `!ship` attaches a picture with both avatars over a pink roses background, a heart with the score and a bar, drawn the same way for the same pair; if the picture cannot be drawn the result is still sent as text.
- **Resolve**, **Dismiss** and **Reopen** on a report now ask for a required reason, and sending the form is the confirmation. A closing reason is shown on the report card, written in the report thread and sent to the reporter in the DM; a reopening reason is shown on the card ("reopened by …") and written in the thread.
- The report thread now follows the report: it is locked and archived when the report is resolved or dismissed, and opened again when the report is reopened.
- Added **Invite reporter** to the report card, which adds the reporter to the discussion thread (not offered for anonymous reports), and a **Notify on claim** setting that DMs the reporter when staff claim their report.
- `!setup` now opens a status panel that answers immediately: what is configured, which permissions Petto is missing, and a **Quick setup** form that is pre-filled from the current settings, so running it again never resets anything. Submitting the form runs its steps together and reports each one separately, so one failing step no longer stops the rest. Audit log routes are saved in one statement instead of eleven.
- Roleplay responses (**Respond** / **Reject**) are now a reply to the message that holds the buttons instead of an edit of it, so the original message keeps its text and only loses its buttons. The reply never mentions anyone.
- `!report send` takes a multi-word reason without quotes; the category, ping and anonymous options go after it as `--category`, `--ping` and `--anonymous`.
- Redesigned the info commands as Components V2 cards with one shared layout (heading with picture, optional banner, sections, ID footer and link buttons): `serverinfo`, `userinfo`, `botinfo`, `channelinfo`, `roleinfo`, `emojiinfo`, `inviteinfo`, `avatar`, `banner`, `color`, `roles`, `permissions` and `invites`. Mentions inside the cards no longer ping.
- `serverinfo` now shows the server description and banner, stickers, forums and language, and only shows the human, bot and booster counts when every member is cached, so they are never wrong on large servers. `userinfo` shows the join position under the same rule, lists roles without cutting a mention in half, and shows an active timeout. `roleinfo` now lists the key permissions of the role, and `permissions` groups them by Server, Text and Voice.
- Added `scripts/check-info-cards.js` to `npm run check`. It runs every info command against fake data and checks Discord's component, text and button limits.
- `!remind` now accepts the shorthand `!remind 2h text` for `!remind add 2h text`. `list` and `cancel` work as before.
- Redesigned the `!version` release center with a cleaner Components V2 layout: a header with the version, status and date, clearer section spacing, and no filler text.
- Redesigned `!case list` as a Components V2 card: a header with the server or user picture and the case count, one block per case with its type, people, time and status (active or ended for timed sanctions), and page controls with the current page.

### Fixed

- The hints that name `embed create`, `embed edit`, `embed preview` and `embed list` (in the embed command, giveaways, `welcome` and `dmonjoin`) used a fixed `!`. They now show a slash when the command was run as a slash command and the typed prefix when it was run from a message.
- A message that is a command for the bot (`!embed create ... hi ...`, an alias, or an @mention of the bot followed by a command) no longer sets off autoresponders, so a word inside the command text does not make the bot answer on top of the command. Added `scripts/check-command-messages.js` to `npm run check`.
- Fixed live counters (`!counter`) that stopped updating. Text and announcement channels cannot keep capitals or spaces, so the stored name never matched and the same channel was renamed on every pass, past Discord's limit of about two renames every ten minutes. The renames waited in line and held up every other counter. A channel is now renamed only when its name really changes, with at least five minutes between renames, and a rename that waits too long no longer blocks the rest.
- Fixed the counters for users, bots, pending members and boosters, which counted only the members the bot had seen. They now load the full member list, at most every ten minutes, and fall back to the cached members on very large servers or when the load fails.
- A counter that cannot be renamed, for example without Manage Channels, is now logged instead of failing silently.
- Added `scripts/check-counters.js` to `npm run check`. It runs the counter job against a fake server.
- Fixed the release name in `!version`: `v5.0.1-46` is now shown as `v0.5.1-46`.
- Fixed `v0.5.0` still being marked as the latest release in `!version`.
- Fixed `!case list` showing an empty page when cases were deleted while the list was open.

## [0.6.0] — 2026-09-30

### Added

- Added a registry of the embed variables (`src/utils/embedVariableRegistry.js`) and a check in `npm run check` that fails when it and the variable engine disagree.
- Added `GET /api/dashboard/variables`, which returns that registry to the dashboard.
- Added the 0.6.0 release notes to `/version`.

### Fixed

- Fixed embed commands crashing when no embed name is given.

### Changed

- The dashboard, released alongside, is translated to Spanish and Brazilian Portuguese, previews messages like the Embed Builder with the bot's own name and avatar, connects to the Embed Builder, loads faster, and now manages the separate Petto Vanity bot. These changes live in the `petto-web` repository.
- The package version is now `0.6.0`. The previous `5.0.1-46` was a typo for `0.5.1-46`.

## [5.0.1-46] — 2026-09-24

### Fixed

- Fixed webhook counters and mention handling when sending webhook notifications.
- Fixed VoiceMaster interaction handling.
- Improved resilience against transient PostgreSQL gateway timeouts with safe retries for transient reads and stale-cache fallbacks.
- Reduced database pressure from sticky messages and autoresponders while preventing unsafe XP write retries.
- Fixed excessive permission overwrites and improved onboarding channel creation for large guilds.

### Added

- Added persistent malicious-URL detection for links discovered through `!am`.
- Known malicious URLs are reused from storage instead of being checked with Safe Browsing on every message, removed automatically, and reported to the development team when newly detected.
- Added the `guildsend` team command and automated guild diagnostics and compliance monitoring, including shop/store detection, team review alerts, manual scans, leave confirmations, and clearer guild notices.
- Added independent per-guild moderation case numbers with persistent counters and one sequence shared by sanctions and automated actions.
- Added a migration for existing case history; `case list` now works without a user and supports optional user filtering and pagination.
- Added argument variables for custom commands: `{args}`, `{arg1}` through `{arg10}`, `{args_from:N}`, `{arg_count}`, `{command_name}`, and `{prefix}`.

### Changed

- Custom command arguments preserve quoted text as one argument and support the new variables inside saved embed templates.
- User-provided custom command arguments cannot create mass mentions.
- Custom commands can use embed-only templates, editing preserves unchanged fields, and the editor now includes a variables reference.

## [0.5.0] — 2026-08-31

### Added

- Added the linked-roles connection flow so members can connect Petto to Discord and receive the Petto Verified role in participating servers.
- Added the `!summary`, `!weekly`, and `!digest` activity chart with daily green/orange series, dark Overview styling, and a text-only fallback when Canvas is unavailable.
- Added Respond/Reject controls to targeted roleplay commands. The mentioned member can respond once with the same action or reject with a slap.
- Added persistent per-server, per-user, per-action roleplay counters and new commands: `!hi`, `!bye`, `!yes`, `!no`, `!laugh`, `!sad`, and `!angry`.

### Changed

- Prefixes saved by the web dashboard now notify the bot through the internal API, refreshing its cache immediately instead of waiting for the five-minute interval.
- Resetting the prefix now synchronizes the default `!` prefix again.
- Server nicknames remain available without Premium; Premium continues to cover the other server profile customization fields.
- Updated setup and removal messages to make server configuration clearer.
- Changed booster eligibility copy to use Discord's `server booster` terminology.

### Fixed

- Fixed the statistics job's `.catch()` handling.
- Added rate limiting to the internal prefix API to prevent abusive requests and satisfy the security checks.

## [0.4.1] — 2026-08-26

### Added

- Added the prefix-only `!version` release center with a Components V2 version selector, navigation buttons, public changelog links, and the published `v0.4.1` entry.
- Added `/report config` improvements for the new report destination, urgent moderator role, anonymous reporting, and report-panel settings.

### Changed

- Improved report cards so message links, content, and image attachments remain available to moderators.
- Improved `!ui` and `!userinfo` with fresh profile data, banners, avatars, roles, badges, timestamps, and profile links.
- Improved audit-log caching, retries, stale fallbacks, partial-message handling, media-change detection, and central event error handling.

### Fixed

- Fixed the Premium issue that could block changing the active server or hide an existing Premium assignment.

## [0.4.0] — 2026-08-24

### Added

- Added the English prefix-only Honeypot system with a Components V2 warning panel, bundled Petto Honeypot artwork, persistent trigger counts, moderation cases, sanctions logs, and automod detection logs.
- Added the Petto Vault backup center with a Components V2 action menu, loading state, audited create/export/restore/schedule flows, and safety backups before restores.
- Added server-scoped backup numbers so each guild starts at `#1`; the internal database ID is no longer exposed to staff or the dashboard.

### Changed

- Custom prefixes now match case-insensitively and accept optional whitespace between a prefix and command.
- Prefix moderation target resolution accepts mentions, Discord IDs, exact usernames, and exact display names, while rejecting ambiguous names safely.
- Honeypot panels use the bundled `petto-honeypot.png` attachment and `<:petto_honeypot:1541493688054841405>` button emoji instead of a third-party image URL.

### Validation

- `npm run check` passes across the complete JavaScript source tree.

## [0.3.0-1] — 2026-08-13

### Added

- Added the Vanity system and documented its first public release entry.
- Full notes are available in the [Petto changelog](https://petto.sbs/changelog/).
- CI now runs JavaScript syntax checks, TypeScript checks, generated-source
  consistency checks, and a production dependency audit.

### Security and deployment

- GitHub Actions now use immutable commit-pinned releases for checkout,
  CodeQL, and Node.js setup.
- Updated the vulnerable `undici` transitive dependency to `6.28.0`, removing
  the three moderate Dependabot findings reported for the previous lockfile.
- Discloud builds the checked-in TypeScript module before starting the bot,
  keeping GitHub-based deployments aligned with the repository source.

## [0.3.0-2] — 2026-08-22

### Added

- Added Discord REST rate-limit telemetry. Petto now reports the HTTP method, sanitized route, scope, retry delay, and bucket limit when Discord applies a rate limit.
- Added one-minute deduplication so repeated limits remain visible without flooding the operational log.

### Changed

- Bumped the bot version from `0.1.0` to `0.3.0-2`.

### Validation

- `npm run check` passes across the complete JavaScript source tree.
