# Changelog

All notable changes to Petto are documented here.

## [Unreleased]

### Changed

- The text under the picture of `/summary` is short and friendly: at most four lines, each with a Petto emoji (the busiest hour and day, the favorite channels, who chatted the most, and whether the server grew), instead of long lists that repeated what the picture already shows.

### Fixed

- The new activity counters failed with `Unsupported PostgreSQL RPC: increment_activity_member`: the database layer only allows the functions it lists, and the new ones (`increment_activity_hourly`, `increment_activity_member`, `increment_member_flow`) were not listed, so the most active hour, the active members and the joins and leaves per day were never counted. The same list also left out the new arguments of `increment_invite_stat` (fake and bonus invites) and `create_mod_case` (who applied the case), so those were dropped silently. A check now fails when a function the bot calls is missing from the list or its arguments differ.

## [0.7.4] — 2026-10-10 · Brownie

### Added

- The Partners page of the website can be edited from the dashboard (by the owner and the team), with types (hosting, servers, apps, bots, communities and other), a link, an optional logo link, a description in English, Spanish and Portuguese, a primary mark, hide and order. Run `schema.sql` (new table `site_partners`). While it is empty the page shows its original list.
- `/summary` shows one thing at a time: `!summary messages`, `voice`, `joins`, `leaves` or `invites` (and `!summary` for everything), for 1 to 31 days. It has a new picture in Petto's colors (the numbers of the period, the bars day by day and the hours of the day with the busiest one lit) and a text with the **most active hour** (UTC), the best day, the top channels and members, the growth in members and the top inviters. Joins, leaves, the members who were active, and messages and voice time by hour are counted from now on; run `schema.sql` to add their tables (`member_flow`, `activity_hourly`, `activity_members`).
- The invite tracker is more complete, like the invite bots: `!invites` shows joined, left, **fake** and **bonus** invites (a fake join is an account under 3 days old or somebody who came back; it is not counted and its leaving does not count either), `!invites who` says who invited a member and how (an invite, the server link or unknown), `!invites list` shows the last members someone brought, `!invites codes` the links they made and their uses, `!invites bonus @user 5` adds or takes away bonus invites (Manage Server) and `!invites reset @user` puts them back to zero (Administrator). The leaderboard is ordered by joined - left + bonus. A single-use invite and the server's vanity link are now recognized when a member joins. Run `schema.sql` (new columns `fake`, `bonus`, `source`, and the counter function is replaced).
- The invite tracker has what the big invite bots have: **rewards** (`!invites reward add 10 @Role` gives a role at 10 invites and takes it away if the person falls below; `reward remove`, `reward list`), **variables for the welcome message** (`{inviter}`, `{inviter.name}`, `{inviter.id}`, `{inviter.invites}`, `{invite.code}`, in the welcome message and the DM on join), **`!invites config fake_days <days>`** to choose when an account counts as fake (3 by default, 0 turns the age check off) and **`!invites top week`** or **`month`** for the leaderboard of the period (GMT-5). Run `schema.sql` (new tables `invite_config` and `invite_rewards`).
- New default look for sanctions, in Components V2, with the new Petto emojis: one person icon per kind of sanction (ban, tempban, kick, mute, warn, unban and more), a colored side bar (red, yellow or green), the member's picture, and lines for User, Moderator, Ends or Duration, Reason and History (how many earlier sanctions the user has). The same design is used for the reply of the command, the sanctions log (sent through the log webhook as a V2 message) and the DM to the member (which shows the server picture and what happened, without ids). A server that saved its own message for a sanction keeps using it.
- `!sender` can now give their own name and picture to the level-up messages (`levelup`) and to the Vanity and Server Tag thank-yous (`vanity`), besides quests, welcome, leave, boost and sanctions. Run `schema.sql` to allow the two new kinds.
- The saved embeds of the old Vanity bot come over as Components V2 cards instead of flat embeds: the title and text with the thumbnail next to them, the image as a picture, the fields as bold labels, the footer as small text and the link buttons. The messages the old bot made by itself (`vanity_notify`, `guildtag_notify`, `notify_*`) become Petto's own designs, with the member's picture and Petto's emoji. `node scripts/upgrade-vanity-embeds.js` turns the ones an earlier import brought over as classic embeds into V2 working only on Petto's database (the old Vanity database is not needed, so it works after it is gone). It only touches those that came from the import and are still classic, and it can be run again.
- Vanity and Server Tag roles are now part of Petto (they used to be a separate bot). `!vanity` and `!guildtag` (prefix only, no slash commands) create rules that add or remove a role from members by their Custom Status, username, global name, server nickname or display name, or by the Server Tag they wear: `add`, `edit`, `remove`, `list`, `test` (see what a member matches without changing anything), `sync` (apply to everyone, with live progress), `notify` and `notify-off` (the thank-you message, with a saved embed from Embeds if you like). Roles the bot did not add are never taken away, a remove rule wins over an add rule, and you can only use roles below your own highest role.
- `!identity` shows the status of all of it, applies every rule at once (`sync`) and keeps a log of the roles the rules add or remove (`logs`, `log-event`, `log-embed`, `logs-off`), with a Petto card or a saved embed for each kind of entry.
- New variables for the thank-you and log messages: `{vanity.word}`, `{vanity.value}`, `{vanity.rule}`, `{vanity.source}`, `{vanity.role}`, `{tag}`, `{tag.guild_id}`, `{tag.enabled}`, `{tag.badge}`, `{tag.rule}`, `{tag.condition}`, `{tag.rule_value}`, `{tag.role}` and `{rule.name}`, `{rule.role}`, `{rule.reason}`, `{rule.action_text}` and more.
- The dashboard has routes for the rules, thank-you messages and log (`/api/dashboard/guild/:id/identity`).
- `scripts/import-vanity.js` copies the data of the old Vanity bot (rules, who got which role, thank-you messages, log settings and saved embeds, which become saved embeds of Petto) into Petto's database. It can be run again without making copies.
- Role buttons can have a color, a row and only an emoji. `!reactionrole add` takes `--style` (blurple, gray, green or red; before it was green for add only, red for remove only and blurple for toggle) and `--row` (1 to 5); the buttons of a row keep their order, and a message holds up to 5 rows of 5. The dashboard builder uses the same: a button can have no text (only the emoji) or no emoji. Run `schema.sql` to add the three columns (`button_style`, `button_row`, `button_position`).
- `!reactionrole add new <emoji> <role> --embed <saved embed>` posts a saved embed (a classic one, not a V2 design) as a message and puts the role button on it, so a role menu with an embed is made in one step. `--channel` says where to post it, and the answer has the link and how to add more buttons to that message. If something fails after the message was posted, the message is taken down. The dashboard has the same: in Reaction roles, pick a saved embed instead of typing a message ID.
- `.Message.CommandUserID`: who used the command that sent the message. A reaction knows it (Petto remembers it with the message), a button or menu locked to a member knows it, and in a typed command it is the author. With it, "only who asked" works for reactions too.
- `execCC`: a command in code runs another command in code of the server, once it is done or after a delay of up to 5 minutes: `{{ execCC "pay" }}`, `{{ execCC "pay" 30 }}` or `{{ execCC "pay" 0 (sdict "item" "rose" "price" 50) }}`. The other command runs as the same member in the same channel, with `.Trigger` `"exec"`, the data in `.ExecData` (at most 2000 characters as JSON) and the name of the command that ran it in `.ExecBy`; what it prints is sent as a normal message, not a reply, and `deleteResponse` works there too. A command can use it twice per use and a chain is at most 3 commands long (a command, the one it runs and the one that one runs). It works from typed commands, buttons, menus, forms and reactions. A delay is kept in memory, so a restart forgets it. A test (`!customcommand codetest` or the dashboard) never runs the other command: it says which one it would run, after how long and with what data, and `!customcommand info` says when a command runs other commands.
- `!customcommand logs [name]` shows the last 15 problems of the commands in code of the server, or of one command: mistakes in the code, crashes, actions that were not done and `execCC` calls that were refused (a command that does not exist or is not in code, or a chain that is too long). Each one says the command, what started it (command, button, select, modal, reaction or exec), who, when and what happened. Petto keeps the last 50 of each server until it restarts.
- `!customcommand rename <name> <new name>` changes the name of a command and keeps its code, its trigger (its own prefix too, so `.req1` becomes `.req`) and its stored data. A name that is a real command of Petto or another custom command is refused. The messages the command sent before, with buttons or reactions, keep the old name and stop answering.
- Petto Code has about 70 new functions, many with the names YAGPDB uses so code written for it is easier to bring over. Text: `joinStr`, `trimPrefix`, `trimSuffix`, `trimSpace`, `inFold`, `capitalize`, `repeat`, `truncate`, `padLeft`, `padRight`, `count`, `indexOf`, `reverse`, `urlescape`, `urlunescape`, `escapeMarkdown`, `formatNumber`, `toString`, `toLower`, `toUpper`. Numbers: `fdiv`, `sqrt`, `cbrt`, `log`, `roundCeil`, `roundFloor`, `roundEven`, `clamp`, `toInt64`. Time: `currentTime`, `toDuration` (`"1h30m"` in seconds), `humanizeTimeSince`, `snowflakeToTime`, `newDate`, `formatTime` (a layout and a time zone) and `weekday`. Lists and maps: `sort`, `sortBy`, `uniq`, `first`, `last`, `sum`, `randItem`, `concat`, `hasKey`, `setKey`, `delKey`, `merge`, `values`, `kindOf`, `json` and `parseJson`. IDs: `userID`, `roleID` and `channelID` take the ID out of a mention.
- Petto Code can read members, roles and channels of the server: `getMember`, `getRole`, `getChannel` and `targetHasRole`, at most 10 per use. They only read, and only from the server where the command runs.
- Stored data: `dbRank` (the place of a member in a ranking), `dbBottom` (the lowest numbers) and `dbCount` (how many keys).
- Actions: `deleteTrigger` and the new `deleteResponse` take a delay of up to 5 minutes, `addReactions` adds several reactions, and `complexMessage` takes `"reply" true` (answer the message of the command) and `"silent" true` (no notification).
- New data: `.Mentions` (the users mentioned, with their name and avatar), `.MentionedRoles`, `.MentionedChannels`, `.ServerPrefix`, `.Now`, `.User.CreatedAt`, more of `.Member` (`Avatar`, `Color`, `HighestRoleID`, `BoostingSince`, `IsOwner`), `.Guild` (`OwnerID`, `CreatedAt`, `BoostCount`, `BoostTier`, `Banner`, `Description`, `RoleCount`, `ChannelCount`, `EmojiCount`), `.Channel` (`Topic`, `NSFW`, `ParentID`, `Type`, `IsThread`) and `.Message` (`CreatedAt`, `Attachments`, `ReplyToID`).
- Three templates: `whois` (a card of the member you mention), `roleinfo` and `rank` (your place in the coins ranking).
- The Petto Code Generator (a website to build commands with forms and try them like in Discord) uses this same engine.
- `!customcommand info <name>` says what a command is: text or code, how it starts, its size (of the 10000 characters of code), the functions it uses and whether it uses stored data, buttons, menus, reactions, forms, roles, direct messages or members of the server.
- A function that does not exist says the one you most likely meant: `There is no function called "dbget". Did you mean dbGet?`.
- `!customcommand codetest` and the check and test of the dashboard give hints: functions that do not exist and names that are not in the data (`.User.Usrname`), even in a part of the code that did not run. Reading a name that is not there still gives nothing.
- `!customcommand codetest` takes arguments after the code block: a code block and then `red "big cat"` tries the code as if `red "big cat"` were typed after the command. Code without a block is all code, as before.
- The test of the dashboard also gives `effects` (the messages, embeds, buttons and reactions themselves, for a preview like Discord's) and `hints`, and its check gives `hints`.
- `!summary sanctions` shows the sanctions of the period: how many bans, mutes, warns, kicks and jails, who applied them (moderators, automod, the honeypot, warn escalation, automatic expiry or anti-nuke), the day with the most, the most active moderators and the most sanctioned members, with its own picture. `!summary` also gives the total of sanctions. Every case now remembers who or what applied it (`mod_actions.source`); cases from before are counted as moderators', or as automatic when the bot itself made them. Run `schema.sql` (the new column and a new version of the function that creates cases).
- `!myprefix` gives you a prefix of your own, used in every server next to the server's prefix (`!myprefix set p!`, `!myprefix show`, `!myprefix reset`). It needs a symbol and up to 5 characters. It is for people who boost the support server, have Petto Premium, are partners (a partner role) or are on the team (owner, developers and the site team), or have one of the roles set in `PETTO_USER_PREFIX_ROLE_IDS` in the support server. Partner roles go in `PETTO_PARTNER_ROLE_IDS`. A prefix stops working while the person no longer meets a requirement, and comes back when they do. Run `schema.sql` (new table `user_prefixes`).

### Changed

- The thank-you message without a saved embed is the same V2 design, and `!vanity sync`, `!guildtag sync` and `!identity sync` show a V2 card with Petto's progress bar, the count, the speed and the time left, and at the end what was added, removed or could not be changed.
- Sticky roles do not give back the roles of Vanity and Server Tag rules when someone rejoins: the rules give them again if the member still matches.
- The automatic reactions of a channel (`!reaction messages <channel> <emojis>`) take up to **five** emojis instead of three (`emoji_1` to `emoji_5`).
- `!customcommand trigger` is clearer. Without a type it shows how the command starts and the commands to change it; `prefix` without a text says how to write it; it says when the command already starts like that or when the prefix is the one of the server; and when it changes a prefix it says what it was before.
- `!customcommand codetest` shows each message like Discord would: its text, its embed (title, the start of the description, fields, footer), its buttons and menus, and its reactions, under the line that says what it does.
- `!customcommand list` shows a page at a time, sorted by name, with what each command is (code or text), how it is typed and how big it is.
- `!customcommand codeshow` shows the code in a block that colors the `{{ }}` actions.
- `codeshow`, `export` and `info` say the closest command when the name has a typo (`!cc codeshow gret` says "Did you mean greet?").
- Saving a command in code warns when its first comment says it is used with a prefix of its own (for example `{{/* req: .req <what you ask> */}}`) and the command does not have that prefix: it says the command that gives it (`!customcommand trigger req prefix .`) and, if the comment uses another name, how to rename it.
- **Petto works in GMT-5, the time of Colombia, and says so.** The days, weeks and months it counts (activity, the daily bonus and the weekly and monthly rankings of levels, the partner ranking, the global statistics), the hours of `/summary`, the times you write (`tomorrow 8pm`, `2026-10-12 18:00`; add `utc` to write it in UTC) and the dates in ticket transcripts, quests and `{date}` now use it. `!time` without a zone shows the time of Colombia. Activity counted before this stays on the UTC days it was counted in.

### Fixed

- The bot could get stuck restarting with "rate limit exceeded": at every start it registered all its slash commands again (Discord limits that), and when that failed Petto stopped and the host started it again at once. Now the commands are registered only when they changed since the last start (Petto remembers a fingerprint of them), a failure to register them no longer stops the start (the commands registered before keep working), and a start that fails waits 30 seconds before stopping, so a restart loop does not keep asking Discord. `node deploy-commands.js` still registers them always and fails loudly.
- `!hardban` is now a real hardban: the user is banned (by ID too, even if they are not in the server) and only the server owner and the antinuke admins can unban them. `!unban` and `!ban remove-all` refuse for anyone else, and if somebody lifts it another way (Discord settings, another bot) Petto puts the ban back. `!hardban` has its own saved messages like the other sanctions.
- Kicking or banning a bot (or any member) with the Administrator permission works again when Petto is above them. Petto was judging every action with the time-out rule, which Discord refuses for administrators; now kick and ban are judged by whether the member can be kicked or banned, and only time-outs keep the Administrator warning. When Discord refuses an action, the answer now says what Discord replied.
- `!vanity sync`, `!guildtag sync` and `!identity sync` no longer fail when Discord limits how often the members of a server can be requested (`Request with opcode 8 was rate limited`). They use the members Petto already has when it has nearly all of them, wait and try again when the wait is short, use the ones it knows (and say so in the result) when it is long, and tell when to try again instead of crashing.
- `!vanity sync`, `!vanity test`, `!guildtag sync`, `!guildtag test` and `!identity sync` work with a typed command: they failed with `getMember is not a function` because a typed command gives the user, not the member.
- The saved copy of each server marks the roles the bot has, so the dashboard knows which roles it can hand out (the Vanity page showed a role the bot could give as one it could not).
- Vanity rules no longer take a role away from a member who goes offline or invisible: Discord hides their Custom Status then, which is not the same as having none, so the rule leaves their role as it is until they are online again.
- The log of a role taken away says which rule made it go: the Server Tag that was taken off, instead of a Vanity rule that did not change.
- The log of the Vanity and Server Tag rules is the same green or red embed the Vanity bot sent (with Petto's approve and deny emoji, the role, the member and the word or reason). A saved embed is only used when you pick one with `!identity log-embed`; the old bot never used the ones it had saved for the log, so the import no longer brings them (`--reset-log-embeds` takes them off where an earlier import did).
- The default thank-you message is a Components V2 card with the member's picture, what they now have and the word of the rule, and `!vanity list`, `!vanity test`, `!guildtag list`, `!guildtag test` and `!identity status` answer with V2 cards too.
- Short names: `!vy` for `!vanity`, and `!tag` or `!gt` (and `!servertag`) for `!guildtag`, with every subcommand: `!vy add rep cinnamochi @Rep`, `!tag list`.
- The automatic reactions of a channel did not work in announcement channels: the posts there usually come from channels it follows or from webhooks, which count as bots, and bots were skipped. The emojis of the channel go on those posts now (and on messages of Petto itself); the trigger phrases still react only to what a person writes, and system messages get nothing.
- `updateMessage` with an empty list of components (`"components" (cslice)`) did not take the buttons away: the message changed but the buttons stayed, so a request card kept its buttons after it was delivered. It removes them now. Without the list the buttons are left as they were.
- A command can ping a role that is not mentionable when Petto may mention every role in that channel (it has Mention Everyone or Administrator) and the id of the role is written in the code of the command, so the member who uses it cannot choose which role gets pinged by typing it. Before, only roles with "Allow anyone to @mention this role" were pinged, even for a bot with Administrator. When a role is not pinged, the command now says so and what to do, instead of failing silently.
- The message after creating a custom command (`!customcommand add` and `code`) always said to try it with `!`, even in a server with another prefix (`p!`), so people typed `!req1` and nothing happened. It says the prefix of the server now.

## [0.7.3] — 2026-10-08 · Flan

A release for tickets that are easier to set up, a config card for every command, the votes from top.gg, and Petto online with the phone icon.

### Added

- A `!<module>config` card for each module with settings: what the server has set now (channels and roles as mentions, On/Off, times) and every command of the module, the ones that configure it first (shortened when there are too many to fit in one message), written with the prefix of the server. There are 42: `!brconfig` (booster roles), `!welcomeconfig`, `!leaveconfig`, `!boostconfig`, `!dmonjoinconfig`, `!joinroleconfig`, `!pojconfig`, `!automodconfig` (AutoMod, anti-raid, anti-alt and anti-nuke), `!logsconfig`, `!levelconfig`, `!starboardconfig`, `!giveawayconfig`, `!ticketconfig`, `!verifyconfig`, `!bumpconfig`, `!vmconfig` (VoiceMaster), `!stickyrolesconfig`, `!honeypotconfig`, `!counterconfig`, `!jailconfig`, `!autothreadconfig`, `!autoresponderconfig`, `!reactionroleconfig`, `!stickymessageconfig`, `!customcommandconfig`, `!disablecommandconfig`, `!reactionconfig`, `!timerconfig`, `!aliasconfig`, `!senderconfig`, `!sanctionmessageconfig`, `!giveawaypresetconfig`, `!giveawaytemplateconfig`, `!prefixconfig`, `!reportconfig`, `!permissionconfig`, `!backupconfig`, `!panelconfig`, `!responderconfig`, `!warnconfig`, `!embedconfig` and `!webhookconfig`. Every other command gets its own `!<command>config` card made when Petto starts (`!banconfig`, `!purgeconfig`, `!avatarconfig`...), with what the command does and every way of using it, so a new command has its card the day it is added without listing it anywhere. A command that answers to a short name has its card under it too (`!ar` is `!autoresponder`, so `!arconfig` is `!autoresponderconfig`). These generated cards are not listed in `!help`, and the roleplay and team commands do not get one. They need Manage Server, and a few have a second name (for example `!boosterroleconfig`). The commands come from the definition of each command, so they cannot go out of date.
- `!cmdconfig` shows the recommended Petto configuration as a card, with commands ready to copy: anti-raid, new accounts, anti-nuke and anti-spam, how to whitelist a user from anti-nuke or make a role immune to AutoMod, the logs and the guided ticket setup, and a button to the documentation. The prefix in the commands is the one of the server.
- Votes for the bot on top.gg. Petto receives the v1 webhook of top.gg at `/webhooks/topgg`: the signature (`x-topgg-signature`, HMAC SHA-256 of the timestamp and the raw body with the webhook secret) and its timestamp are checked, every vote is stored once (a vote that top.gg sends again after a timeout is not counted twice, and a weekend vote counts double), and the voter is thanked in a channel. `!votes` shows the votes of Petto and of a member, and `!votes top` the members who voted the most. Set `TOPGG_WEBHOOK_SECRET` (the `whs_...` value top.gg shows when the webhook URL is saved) and `VOTE_CHANNEL_ID`; run `schema.sql` to add the `bot_votes` table.
- Voters get a role. With `VOTE_ROLE_ID` set, a member who votes for Petto on top.gg receives that role (in the server of the vote channel) and keeps it. The thanks in the vote channel is a V2 card that mentions the voter: "name voted!", how many times they voted, the link to vote again every 12 hours, their avatar, the total of votes of Petto, ID and the time.
- The dashboard can change a giveaway that is running: the prize, the number of winners and a new end (counted from now, as `!giveaway edit` does). What is left empty stays as it is, a wrong value changes nothing, and the giveaway message is drawn again. It is the `edit` action of the dashboard giveaway route.
- `!ticket setup` is a guided setup for tickets. A panel with menus and buttons lets you pick the channel for the ticket panel, the support roles and a log channel, write the title and text, add the ticket types (name, emoji and short description), choose the button color and whether members see buttons or a dropdown, and publish everything with one press. If the panel cannot be posted, nothing is kept. Each type can then be fine-tuned from the dashboard or with `!ticket category edit`.
- Ticket types have their own welcome text, without needing a saved embed: `welcome:` in `!ticket category add` and `edit` (or in the setup panel), with `{user}`, `{username}`, `{category}`, `{server}` and `{number}`. The channel name of a ticket also accepts `{userid}` and `{category}`.
- Staff tools inside a ticket: `!ticket priority` (low, normal, high, urgent, shown in `!ticket info`), `!ticket transfer` to hand the ticket to another staff member of the category, `!ticket note` for private notes (write one, or run it without text to read them) and `!ticket request-close`, which asks the member with Yes/No buttons whether the ticket can be closed. Run `schema.sql` to add the new column and the notes table.

### Changed

- Petto is **online with the phone icon** by default, like the Vanity bot: it connects as the Android app and its status is online. Discord only draws the phone icon in place of the dot while a status is online (with idle or do not disturb it shows the usual moon or red dot, even on a phone), so the status can be changed by the team with `!botstatus online`, `idle`, `dnd` or `invisible` (without a value it shows the current one). The choice is saved and survives a restart; without one, `PETTO_PRESENCE_STATUS` decides (online by default). Run `schema.sql` to add the small `bot_settings` table. The bot connects naming the phone app and the system too (`Android`, `Discord Android`), as the real app does, and about 20 seconds after it starts it writes in the log how Discord sees it (for example `{"mobile":"idle"}`); `PETTO_MOBILE_CLIENT=ios` uses the iPhone app instead, and `PETTO_MOBILE_STATUS=false` goes back to the plain desktop look.
- Ticket forms are built with buttons. `!ticket form create name:<name>` (and `!ticket form edit name:<name>`) opens a panel where you add short-answer or paragraph questions with a button, set a hint and whether each one is required, remove the last one, change the title and save. The old `fields:` text still works for anyone who prefers it.
- Changing several permissions of a channel is told in one log message. Discord sends an update for each permission, a few moments apart, and the `channels` log had a message for each one. The updates of the same channel are held for about 2.5 seconds (at most 12 while it keeps changing) and told as one: what changed from the first to the last, with who did it. Different channels are never mixed.

### Fixed

- `!giveaway edit` did not work when the prize had several words and no quotes (for example `!giveaway edit <id> $10 NITRO / 1x DECO 1 30d`): the first word was taken as the prize and everything else as the duration. Now the prize is everything between the message id and the numbers at the end: the last words that look like a duration (`30d`, `3d 4h`) are the new end, and a number before it is the number of winners. Quotes and `--prize`, `--winners` and `--duration` still work.
- The log of pinned messages failed with "Cannot read properties of undefined (reading 'username')" and wrote an error in the error channel each time someone pinned or unpinned a message. Discord sends the channel and the time of the last pin, and the event took the time as if it were the bot. Pins and unpins are logged again.
- The partner replies ("thanks for the partnership...") showed the manager as a name with an @ but did not really ping them, because every mention was turned off. The manager of the partnership is pinged now; the names in the top lists and anyone else stay plain text.

## [0.7.2] — 2026-10-07 · Churro

A release for the logs, for embed codes in more places, and for the quest alerts: a thread under each alert and a message that tells how to complete the quest.

### Changed

- In the channel log, the @everyone role is written as `@everyone` (it showed as `@@everyone`), and a change of permissions says who made it (Discord keeps those changes under their own audit log actions).
- In `!userinfo` the HypeSquad Events and Early Verified Bot Developer badges have their icons, a badge with an icon is shown as the icon only, with no label next to it, and Nitro is no longer shown for apps (an app can have an animated avatar or a banner without Nitro).
- `!userinfo` shows the badges with their icons: Staff, Partner, Bug Hunter (both levels), Early Supporter, Moderator Programs Alumni, Active Developer, Supports Commands, HypeSquad Bravery, Brilliance and Balance, Verified App, Nitro (when the account has an animated avatar or a banner, which only Nitro gives) and the server booster badge.
- `!steal` also works when you reply to a message: it takes the custom emojis in its text, its embeds and its reactions (up to 20 at a time), besides a sticker. Emojis typed after the command still come first.
- The help menu has its own icons for the Fun (a dice) and Roleplay (a heart) categories.
- The answers for a command typed wrong are small cards now, three lines at most. An unknown subcommand (`,br list`) says what was typed and what was probably meant (`boosterrole admin list`), or the first options when nothing is close. A missing option names it, shows how to write the command (`<needed>` and `[optional]`) and what that option holds. A specific message from the parser (a role that was not found) is still told as it is. It works for every command.
- When Discord does not let `!channel create` make a media channel, the answer says that the server needs Community and monetization turned on.
- Two more log categories: `integrations` (a bot added to or removed from the server, with who added it and a warning when it can have Administrator, and apps or integrations added, changed or removed) and `commands` (which command of Petto was used, by whom and where; only the name of the command is logged, never what was typed after it, and nothing is done unless a channel is set for the category).
- Also in the logs: `messages` tells when a message is pinned or unpinned (with who, its text and a link), `voice` tells the stages started, ended and with a new topic, `emojis` also covers the soundboard sounds (added, changed, removed), and `server` also tells the vanity URL, widget, boost level, verification level, explicit media filter, default notifications, 2FA, the system, rules, community updates and AFK channels, the AFK timeout and the language, with who changed it.

### Added

- Quest alerts can open a thread under each alert, to talk about that quest: `!quests thread on`. The thread is named with the quest (`!quests thread name Quest: {quest.name}`), can ping the alert role inside it so its members are added (`!quests thread ping`), and hides itself after the time you choose (`!quests thread archive 1440`). Petto needs Create Public Threads in the alert channel.
- The quest method: a message that tells how to complete the quests of the week, written once by the server and sent in the thread of each new quest or in a channel, with a ping or without it. Write it as a plain text (`!quests method text ...`, with the `{quest.*}` variables) or choose a saved embed (`!quests method template <name>`), which can have several texts, pictures and buttons. `!quests method on|off` sends it with every new alert, `!quests method thread` or `channel #how-to` chooses where, `ping` and `noping` choose the ping, and `!quests method send [quest id]` sends it now. The dashboard has the same settings and a button to send it now.
- The feedback board of the website (petto.sbs/feedback) has its own tables in the database: `feedback_posts`, `feedback_votes` and `feedback_comments`, with the counters of likes, dislikes and comments kept by triggers. A second bot (the `feed` project) publishes each post in the Petto server, and its like and dislike reactions count as votes.
- Messages with their own name and picture. `!sender set <quests|welcome|leave|boost|sanctions> <name> [picture link]` makes Petto send that kind of message through a webhook that it makes in the channel by itself (it needs Manage Webhooks), so the quest alerts, the welcome, leave and boost messages and the sanction messages can look like they come from someone else. `!sender reset <kind>` goes back to Petto, and `!sender list` shows what is set. If the webhook cannot be made, the message is sent the normal way.
- A button responder can act on the message it is on: `!responder add close --delete_message true` deletes it after the button is used, `--react 👍` adds a reaction to it, and `--send_to #channel` sends the answer in that channel instead of privately (`--clear react` and `--clear send_to` take them away).
- A different saved embed (normal or Components V2) for each kind of reward of a quest: `!quests type <orbs|decoration|code|ingame|nitro> <alert|method> <saved embed>` (empty removes it), so Orbs, avatar decorations, Nitro, codes and in-game items can each look and read their own way. A quest with several rewards uses the first one that has an embed, and when that embed is missing or broken the general design (and then the card) is sent. It works for the alert and for the method, and the dashboard has a picker for each kind.
- Quest variables for each kind of reward and for the first three rewards: `{quest.orbs.amount}`, `{quest.decoration.name}`, `{quest.decoration.image}`, `{quest.nitro.name}`, `{quest.code.name}`, `{quest.ingame.name}` (each with `.name`, `.type`, `.image`, `.amount`, `.nitro_amount` and `.expires`), `{quest.reward1.name}` to `{quest.reward3.*}`, and `{quest.reward_types}`. A design for decorations can show the decoration even when the Orbs come first.
- More `{quest.*}` variables. Every Discord timestyle for the start and the end of a quest: `{quest.starts.relative}`, `.short_time`, `.long_time`, `.short_date`, `.long_date`, `.full`, `.full_long`, `.short_datetime`, `.medium_datetime` and `.unix` (the same with `{quest.expires.*}`), which show in the reader's own time zone. The same moments in plain words for the places where Discord does not draw a timestamp, such as titles, footers and author names: `{quest.starts_ago}` (2 days ago, in 3 hours, now), `{quest.expires_in}`, `{quest.starts_date}`, `{quest.expires_date}`, `{quest.starts_datetime}`, `{quest.expires_datetime}` (in UTC), `{quest.duration}`, `{quest.time_left}`, `{quest.days_left}` and `{quest.hours_left}`. And more details: `{quest.reward_name}`, `{quest.rewards_count}`, `{quest.reward_nitro_amount}`, `{quest.reward_expires}`, `{quest.task_type}`, `{quest.task_seconds}`, `{quest.task_time}`, `{quest.countries}` and `{quest.excluded_countries}`. They work in the quest alert, in the method and in the thread name.
- More in the server logs. Two new log categories, `webhooks` (a webhook was created, changed or deleted, with who did it and in which channel; the webhooks Petto makes for its own logs are left out) and `threads` (a thread was created, changed or deleted; threads that archive themselves and the ones Petto starts are not told). Pick them with `!logs add <channel> webhooks`.
- The existing categories tell more: `emojis` also logs stickers (added, renamed, removed); `server` logs scheduled events (created, changed, canceled, deleted); `automod` logs the AutoMod rules of Discord (created, changed, deleted); `channels` shows the age-restriction, slowmode, bitrate, user limit and each permission change (added, allowed, denied, removed, for a role or a member); `roles` says which permissions were granted or removed and the role icon; `members` logs timeouts (with the reason and who), timeouts removed, started and stopped boosting, server avatar changes, and tells a kick from a member who left.
- `!editembed <message link> {embed}$v{description: ...}` changes a message that Petto already sent, with a new embed code: text, several embeds and link buttons. You can also reply to the message and write only the code, or use its ID. It needs Manage Messages in that channel and only works on messages Petto sent. What the new code does not set is cleared.
- An autoresponder reply can be written as an embed code: `!autoresponder add test, {embed}$v{message: {user.mention}}$v{description: Hi}$v{thumbnail: {guild.icon}} --reply --not_strict`. The comma ends the trigger (it can have spaces, or be in "quotes"), and the flags go at the end: `--reply` (answer to the message), `--ping`, `--delete`, `--strict` (the whole message must match), `--not_strict` (the trigger can be anywhere, the default), `--mode <mode>` and `--embed_template <name>`. The code is checked when it is saved, and `!autoresponder edit <id> <code>` takes it too.
- `!channel create <name> [type] [category] [topic] [nsfw]` creates a channel: text, announcement, voice, stage, forum, **media** or category. For now only the owner and the developers of Petto can use it. Forum and media channels need Community to be enabled in the server, and the answer says so when it is not.
- `!quests resend` sends the quests that are active now, pass your filters and were never posted in the server (the ones whose alert failed because of the long link, and the ones that were already running when the alerts were turned on), up to 10 at a time, oldest first, with a pause between messages. Run it again if it says more are left.

### Fixed

- Creating an embed in the dashboard with a name that already exists sent a "Petto error" to the error log channel (one per attempt), when the dashboard already tells the person that the name is taken. That answer is only logged as information now; any other database failure is still reported.
- An embed code with a block that lost its closing brace, such as `{message: {user.mention}$v{description: ...}`, now ends that block where the next one starts, and says so, instead of swallowing the rest of the code as text.
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
