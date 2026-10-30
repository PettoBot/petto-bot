// The release notes of `!version` in English: label, summary and sections of each release (src/utils/releases.js holds the rest).
module.exports = {
  'v0.7.10': {
    label: 'v0.7.10 · Churro: several prefixes for each server',
    summary: 'A server can have several command prefixes (`!` and `petto` to start), managed with `!prefix` or from the dashboard, and a message that only looks like a command stays silent.',
    sections: [
      {
        title: 'Prefixes',
        items: [
          'Up to 10 prefixes for each server, the first one is the main one. Servers on the default `!` now also answer to the word `petto` (`petto help`); a server with a prefix of its own keeps only that one. A symbol is typed attached (`,help`), a word needs a space (`petto help`), and the longest prefix goes first.',
          '`!prefix` shows the list, `!prefix add <prefix>`, `!prefix remove <prefix>` and `!prefix reset` change it, and `!prefix <prefix>` still makes it the only one. The dashboard has a **Manage prefixes** window on the General page.',
          'Your own prefix (`!myprefix`) and the custom commands work with every prefix of the server.',
        ],
      },
      {
        title: 'Quieter',
        items: [
          '`, es el mejor`, `! hola` and `petto es el mejor` are chat: a symbol prefix needs the command right after it, and a word prefix only counts before a real command.',
          'Only the main prefix answers "I don\'t know that command"; the other prefixes stay silent.',
        ],
      },
    ],
  },
  'v0.7.9-1': {
    label: 'v0.7.9~1 · Donut: pictures that match, !send and RSS fixed',
    summary: 'A patch of Donut: feeds of pictures that match every word and ask what a word means, `!send` that finds its channel, and RSS feeds that say when a link is not a feed.',
    sections: [
      {
        title: 'Timers',
        items: [
          'Timers: every day or week at a time in a time zone, numbered 1, 2, 3 in each server, and `!timer run`, `edit`, `message`, `channel`, `pause` and `resume`.',
        ],
      },
      {
        title: 'Feeds of pictures',
        items: [
          'Every word counts: `flor rosa anime` only gives drawings of pink flowers, never a mountain or a photo.',
          'A word with several meanings (`rosa`: the flower, the color or the mountain) is asked about with a button for each before the feed is saved.',
          'The feed and each picture say what is searched, and the pictures are checked first, so none shows broken.',
        ],
      },
      {
        title: 'Fixes',
        items: [
          '`!send` finds the channel at the start or at the end, by mention, ID, link or name, and says when it does not exist.',
          'An RSS feed that points to a web page is not saved as an empty feed: Petto looks for the real feed or says there is none.',
          'The join DM keeps only its link buttons, and a Petto Code form with too many choices selected is told as a mistake.',
          'A timer with a V2 saved embed posts again (its text no longer breaks the message), and a failed send is shown in `!timer view` and the dashboard.',
        ],
      },
    ],
  },
  'v0.7.9': {
    label: 'v0.7.9 · Donut: feeds for everyone, !send, action buttons and new lookups',
    summary: 'Feeds open to every server, `!send`, buttons that do things, forms with every part of Discord, new lookups, `!stats`, a new level-up card and a lighter database.',
    sections: [
      {
        title: 'Feeds',
        items: [
          'Feeds are open to every server. `!feed add` follows YouTube, Twitch, Kick, Bluesky, Reddit, Steam, GitHub, npm, PyPI, AniList, Pinterest, Spotify, Deezer, Apple Music, Mastodon, Tumblr, Letterboxd, Epic\'s free games and any blog, searching while you type. Premium follows 25 accounts of each platform (Free, 5).',
          'Auto feeds with their own pace, from every 15 minutes to once a day: one **Animals** feed, pictures by tags (`15m anime roses`), a random song from the charts of Deezer, Apple Music and Spotify, Pokémon, Wikipedia and Chess.com.',
          'YouTube is told when a channel publishes, so a video goes out within seconds, and a Short is posted as the player. Kick live notices go out within a minute, and a stream that ended keeps its green with a replay button.',
          'Music feeds follow playlists, charts and the new albums of a country, and Modrinth lists follow the newest mods, shaders or plugins in one feed. Notices have a button that opens them (on by default), and the users and roles in their words are really notified.',
        ],
      },
      {
        title: 'Embed codes and Petto Code',
        items: [
          '`!send` sends a message as Petto, and `!welcome`, `!leave`, `!boost` and `!dmonjoin` can use an embed code as their message.',
          'Buttons that do things, in embed codes, Components V2 designs and the dashboard editor: they give, take or toggle a role, or show a saved embed (privately, in the channel or in the DMs).',
          'Petto Code forms (`cmodal`) can hold every part Discord has: menus, pickers of members, roles and channels, file uploads, radio buttons and checkboxes.',
          '`!steal` and `!jumbo` find the emojis of a Components V2 card.',
          '`!jumbo` says when the server already has the emoji or sticker.',
        ],
      },
      {
        title: 'Lookups, stats and cards',
        items: [
          'Lookups on other services: `!minecraft`, `!github`, `!roblox`, `!steam`, `!twitch`, `!youtube`, `!lastfm` and more, with short ways to write them (`!mu Notch`).',
          '`!stats` analyzes a server with numbers only (never what was written), with a privacy panel.',
          'A level-up card in the Petto style, `!userinfo` and `!serverinfo` redesigned, `!usercosmetics`, and cards without color except to say yes or no.',
          'More lookups with a picture for songs, albums and artists, and cards with dividers, flat icons and no big titles.',
        ],
      },
      {
        title: 'Servers and settings',
        items: [
          'Voice XP no longer needs a second person by default, and there are two new XP limits in `/level rules`.',
          'What Petto stored for a server it left is deleted 3 days later, and the heavy data can live in a second database.',
          'The copies of avatars of the profile history weigh half, the public threat lists forget what they stopped listing, and counters are no longer turned off for a channel that still exists.',
          'The setup of a new server is never put in a public channel. The music stays turned off for now.',
        ],
      },
      {
        title: 'Fixes',
        items: [
          'The verification page opens in the language of the server, `!massunban` stops when the server is gone, AFK mentions are deleted, and the URLhaus list of malicious links is read again.',
          'A title with square brackets shows as a link, Pinterest boards with names in other alphabets can be followed, and a YouTube channel whose feed answers 404 or 500 keeps working.',
        ],
      },
    ],
  },
  'v0.7.8': {
    label: 'v0.7.8 · Mochi: AI for tickets, media channels, boards and new tools',
    summary: 'An AI assistant for tickets (beta), live tickets and better transcripts, media channels, a clownboard and boards with several emojis, repeating timers with an embed, new commands (pages, quotes, image effects), more control over appeals and a dashboard whose cards show what the bot sends.',
    sections: [
      {
        title: 'New commands and tools',
        items: [
          '`!pagination` makes one message with up to 25 pages and buttons to turn them. `!quote` turns a message into a black and white quote picture, `!image <effect>` changes a picture (invert, blur, pixelate, deep fry…) and `!hex` finds the main color of a picture.',
          '`!imgonly` and `!urlonly` make media channels: only pictures and videos, or only links from the sites you choose. What does not fit is deleted, with a notice that deletes itself.',
          'Easier command blocking: `!dc suggest #cmds` works, with several commands and channels at once, a whole category, and `!dc list`. Petto can also post its stats on Omniplex.',
        ],
      },
      {
        title: 'Tickets and the AI assistant',
        items: [
          'An AI assistant for tickets (beta): it answers the person who opened a ticket from the instructions and knowledge the owner wrote, can read messages of the server such as its rules, knows the channels, and answers with cards that have a **Talk to a person** button.',
          'Live tickets in the dashboard: the open tickets, their messages and replies from the staff.',
          'Transcripts look like Discord and show Petto as it looks in your server, a deleted ticket channel closes its ticket, ratings can be given once, and the default ticket messages are warmer cards with their own emojis.',
        ],
      },
      {
        title: 'Appeals',
        items: [
          'Softbans can be appealed (turn it on in Appeals → Settings or with `!appeals types ban, mute, softban`).',
          'Choose whether sanction DMs carry the appeal link, write your own line about appeals, and ask members to wait up to 720 hours before appealing, all with `!appeals`.',
        ],
      },
      {
        title: 'Boards, timers and messages',
        items: [
          'A clownboard (`!clownboard`) joins the starboard and the monkeyboard, and every board can count up to five emojis (`!starboard emoji ⭐ 🍌`).',
          'Repeating timers can send a saved embed, delete the message of the time before (`!timer previous`) and repeat every so many seconds, minutes, hours, days, weeks, months or years. Autoresponders can delete their previous reply too.',
        ],
      },
      {
        title: 'Dashboard',
        items: [
          'New Boards and Media channels pages, with a card for each board or channel and a sample of how it looks.',
          'Autoresponders, custom commands, timers and sticky messages are cards with a small chat that shows what the bot sends: formatting, emojis, saved embeds and GIFs.',
          'A new look for the verification panel, and setting up verification no longer times out on big servers.',
        ],
      },
      {
        title: 'Fixes',
        items: [
          '`!dc suggest #cmds` did nothing, `/channel clear` failed, the verification panel could be posted twice, and the profile history now keeps old avatars for good.',
        ],
      },
    ],
  },
  'v0.7.7': {
    label: 'v0.7.7 · Tiramisu: forms, live counters, Spanish & Portuguese and slash commands',
    summary: 'Forms with their own web page, live counters rebuilt, Petto in Spanish and Portuguese, a stronger anti-nuke, everyday slash commands, generous Free limits and a faster dashboard.',
    sections: [
      {
        title: 'Forms',
        items: [
          'Forms and applications with `!form`: up to 25 questions, rules (roles, account age, cooldowns, limits, a closing date), panels, and a review card with **Accept**, **Deny** and **Open thread** that gives the roles and DMs the result.',
          'Each form has its own web page (`petto.sbs/form/<id>`) with a link nobody can guess: members sign in with Discord and answer there. The page wears the color, banner and background of the form, and its link shows a preview you can customize.',
          'Questions can have a description and a picture, deciding an answer closes its thread, and the dashboard has a Forms page with the submissions and the panels.',
        ],
      },
      {
        title: 'Counters and community',
        items: [
          'Live counters, rebuilt: many more types (online, a role, boosts, a member goal, a clock, messages today…), names with `{count}`, packs with `!counter setup`, counters in a category name or a channel topic, and milestone announcements with `!counter announce`.',
          'Renames respect the limit of Discord (two every 10 minutes) and are spread out, and the dashboard has a Counters page with previews, drag to reorder and renames in place.',
        ],
      },
      {
        title: 'Moderation',
        items: [
          '70 new moderation commands, subcommands and shortcuts: forced nicknames, `!stripstaff`, image and reaction mutes, `!raid clean`, temporary roles, `!restrictcommand`, more `!purge` filters and more.',
          'Anti-nuke: five new protections (role and channel changes, mass mentions, webhook spam, prune), panic mode, trusted admins, owner only and a DM to the owner when a protection acts.',
          'Bulk moderation leaves alone the members you cannot moderate, `!lock` locks the channel you are in, and the Honeypot can be set up from the dashboard.',
        ],
      },
      {
        title: 'Languages and slash commands',
        items: [
          'Petto speaks English, Spanish and Brazilian Portuguese: replies, cards, panels, DMs and logs follow the language of the server. Change it with `!language`.',
          '21 everyday commands also work as slash commands (`/help`, `/ping`, `/userinfo`, `/warn`, `/ban`, `/purge`, `/ticket`…) and `/help` shows both forms. `/embed` joins them, and slash commands no longer show twice.',
          'More events are logged in the categories you already have, a role can be ignored in the logs, and `!serverinfo` takes the ID of another server.',
        ],
      },
      {
        title: 'Dashboard and Premium',
        items: [
          'Free is generous and Premium is about twice as much: 125 custom commands (250 with Premium), 75 autoresponders (150), 25 counters (50) and more. Level rewards and logs have no limit, and 15 card fonts are free.',
          'Dashboard access by role, faster Counters and Forms pages, a Sync button, a Honeypot page, and the Permissions and Command coverage pages rebuilt.',
          'Restoring a backup asks first, shows its progress, can be stopped and can bring back only some parts (backups are still under maintenance).',
        ],
      },
      {
        title: 'Fixes',
        items: [
          'VoiceMaster buttons no longer fail when the bot is slow, Vanity rule names with spaces work, the Forms page of the dashboard loads again, and the logs use the name and picture the server gave Petto.',
        ],
      },
    ],
  },
  'v0.7.6': {
    label: 'v0.7.6 · Macaron: appeals, stronger moderation & more community tools',
    summary: 'A full appeals system with its own page, stronger moderation (anti scam, lockdown, anti-nuke per protection), better tickets, suggestions, counting and confessions, and a new look for the dashboard.',
    sections: [
      {
        title: 'Appeals',
        items: [
          'A page for each server (`petto.sbs/appeal/<id or your name>`): members sign in with Discord, see their punishments, fill the forms you build and follow their appeal. In English, Spanish and Portuguese.',
          'The staff gets each appeal with **Accept**, **Reject** and **Reply**. Accepting lifts the ban, the timeout and the active sanctions and can make a single-use invite (and says which one). Rejecting can block a new appeal for a day, a week, a month or for good.',
          'Your own link name (`petto.sbs/appeal/amor`) with reserved and offensive names blocked, a request to the team when a name is taken (1 to 72 hours), 30 days of reservation when you change it, and names nobody uses are freed. Pictures can be uploaded from the device.',
          '`!appeals` shows the link, and the sanction DM points to it. Everything starts off.',
        ],
      },
      {
        title: 'Moderation',
        items: [
          'Anti scam (the MrBeast scam by behavior, words and new accounts), `!lockdown` for raids, anti-nuke with limits, whitelists and restore for each protection, and AutoMod templates (Discord rules and Petto filters) with strikes and exceptions.',
          'Lift sanctions from the dashboard, search cases, add proof and see stats. VoiceMaster can copy the category permissions, with access roles, privacy and owner permissions (all off by default).',
        ],
      },
      {
        title: 'Community',
        items: [
          'Suggestions (`!suggest`, votes, threads and staff answers), Counting (saves, records, roles and a leaderboard) and Confessions (anonymous, reviewed by the staff, with replies).',
          'Tickets: panels with color, picture and footer, a limit per member, staff hours, reminders, quick replies, transcripts as a link, a file or both, and `!ticket panel edit`.',
          'Verification can be set up from the dashboard in one press. Image cards go anywhere with `{imgcard:name}` (40 fonts).',
        ],
      },
      {
        title: 'Look and dashboard',
        items: [
          'Starboard and monkeyboard reposts look like the original message with an **Original Message** button, `!ping` and `!userinfo` have new cards, and new messages are warm Components V2 cards.',
          'The dashboard has new fonts, softer colors, one color picker that is easier to drag, a smaller save bar and a real status page. The website has a Brand page (`/brand`).',
        ],
      },
      {
        title: 'Fixes',
        items: [
          'Replies work without Read Message History, a missing permission is told in plain words, `!prefix set ?` works, and rollouts show only what changed.',
        ],
      },
    ],
  },
  'v0.7.5': {
    label: 'v0.7.5 · Waffle: birthdays, verification in a channel & a faster dashboard',
    summary: 'Birthdays, profile history, a letters check for the verification (also inside Discord and in a channel), the monkeyboard, a public leaderboard, levels with giveaways, rollout alerts and a much faster dashboard.',
    sections: [
      {
        title: 'New',
        items: [
          'Birthdays: `!birthday set`, `view`, `upcoming`, `remove` and `config`. Petto celebrates with a message at the hour you choose and, if you want, a role for the day.',
          'Profile history: `!avatars` shows every avatar in one picture, `!names` and `!nicknames` list the rest, `!clear` deletes your own and a History page in the dashboard has a search by ID.',
          'Verification: members can type the letters of a picture (on the page or inside Discord, with no link) and the server can post a verification panel in a channel (`!verify channel`, or from the dashboard).',
          'Monkeyboard 🐒: the starboard\'s opposite, with its own settings and `{monkey.*}` variables.',
          'Public leaderboard: `petto.sbs/lb/<name>`, in three languages, off until the server turns it on.',
        ],
      },
      {
        title: 'Levels and giveaways',
        items: [
          'Level-up answers the message, deletes itself when you want, voice has its own reward roles, multipliers work by category and you choose who earns XP.',
          'Giveaways can ask for a level and give extra entries by level. A new default rank card, and `!level manage sync`.',
        ],
      },
      {
        title: 'Rollouts and quests',
        items: [
          'Rollout alerts: Discord experiments announced in a channel with `!rollouts`, with a queue, saved designs and a dashboard page.',
          'The compact quests list is the main source, and the default quest cards no longer have the credit line.',
        ],
      },
      {
        title: 'Speed and dashboard',
        items: [
          'The dashboard loads 3 to 16 times faster, settings change instantly and Petto makes far fewer requests to Discord.',
          'More messages can have their own name and picture (`!sender`), and the Levels dashboard has one Save.',
        ],
      },
    ],
  },
  'v0.7.4': {
    label: 'v0.7.4 · Brownie: Vanity in Petto, statistics & hardban',
    summary: 'Vanity and Server Tag roles inside Petto, a new look for sanctions, a real hardban, `/summary` with sanctions, joins, leaves and invites, a fuller invite tracker, a prefix of your own and Petto working in GMT-5 (Colombia).',
    sections: [
      {
        title: 'Vanity and Server Tag',
        items: [
          '`!vanity`, `!guildtag` and `!identity` (short names `!vy` and `!tag`) give or take a role by the Custom Status, the name or the Server Tag of a member, with a thank-you message, a log and persistent roles. The data of the old Vanity bot can be imported.',
          'Reaction roles: buttons with a color, a row and only an emoji, and `!reactionrole add new` posts a saved embed with its role button.',
        ],
      },
      {
        title: 'Moderation',
        items: [
          'A new default look for sanctions (reply, log and member DM) in Components V2 with new icons, and more kinds of message for `!sender`.',
          '`!hardban` is real: only the server owner and the antinuke admins can unban, and Petto puts the ban back if somebody else lifts it. A hackban is a ban by ID.',
          'Kicking or banning an administrator bot works when Petto is above it.',
        ],
      },
      {
        title: 'Statistics',
        items: [
          '`!summary` by `messages`, `voice`, `joins`, `leaves`, `invites` or `sanctions`, with the most active hour, a new picture and the Statistics page in the dashboard.',
          'The invite tracker counts fake and bonus invites, gives roles for reaching a number of invites, has `{inviter}` variables for the welcome message and a leaderboard by week or month.',
        ],
      },
      {
        title: 'Your own prefix and time',
        items: [
          '`!myprefix` gives boosters of the support server, Premium users, partners and the team a prefix of their own in every server.',
          'Petto works in GMT-5 (Colombia) and says so: days, weeks, hours and the times you write.',
        ],
      },
    ],
  },
  'v0.7.3': {
    label: 'v0.7.3 · Flan: easier tickets, config cards & votes',
    summary: 'A guided setup for tickets, a `!<command>config` card for every command, votes from top.gg with a voter role, and Petto online with the phone icon.',
    sections: [
      {
        title: 'Tickets',
        items: [
          '`!ticket setup` is a guided setup: pick the channel, the support roles and a log channel, write the title and text, add the ticket types and publish everything with one press.',
          'Ticket forms are built with buttons (`!ticket form create name:<name>`), no need to type the field syntax.',
          'Each ticket type has its own welcome text, and the channel name accepts `{userid}` and `{category}`.',
          'Staff tools inside a ticket: `!ticket priority`, `!ticket transfer`, `!ticket note` and `!ticket request-close`.',
        ],
      },
      {
        title: 'Config cards',
        items: [
          'Every module has a `!<module>config` card with what the server has set now and every command of the module: `!brconfig`, `!welcomeconfig`, `!levelconfig`, `!ticketconfig`, `!automodconfig`, `!logsconfig` and 36 more.',
          'Every other command gets its own card when Petto starts (`!banconfig`, `!purgeconfig`...), and a command with a short name has its card under it too (`!arconfig`).',
          '`!cmdconfig` shows the recommended Petto configuration with commands ready to copy.',
        ],
      },
      {
        title: 'Votes',
        items: [
          'Petto receives the votes from top.gg: each one is counted once, thanked in a channel with a card, and gives the voter a role that stays.',
          '`!votes` shows the votes of Petto and of a member, and `!votes top` the members who voted the most.',
        ],
      },
      {
        title: 'Giveaways & status',
        items: [
          'A giveaway that is running can be changed from the dashboard (prize, winners and end), and `!giveaway edit` reads a prize with several words and no quotes.',
          'Petto is online with the phone icon by default, and the team can change the dot with `!botstatus`.',
          'Changing several permissions of a channel is told in one log message.',
        ],
      },
      {
        title: 'Fixes',
        items: [
          'The partner replies really ping the manager of the partnership.',
          'Pinned and unpinned messages are logged again (the log failed with an error each time).',
        ],
      },
    ],
  },
  'v0.7.2': {
    label: 'v0.7.2 · Churro: logs, embed codes & quest threads',
    summary: 'A thread and a "how to complete it" message for the quest alerts, embed codes in autoresponders and `!editembed`, and many more events in the server logs.',
    sections: [
      {
        title: 'Quest alerts',
        items: [
          'Messages with their own name and picture (`!sender`): quest alerts, welcome, leave, boost and sanction messages can go out through a webhook that looks like someone else.',
          'A button responder can delete the message it is on, react to it, or send its answer in another channel.',
          'A different saved embed (normal or V2) for each kind of reward: Orbs, decorations, Nitro, codes and in-game items, for the alert and for the method (`!quests type`).',
          'Many more `{quest.*}` variables: every timestamp style for the start and the end (`{quest.starts.relative}`, `{quest.expires.full}`...) and the same moments in plain words for titles and footers (`{quest.starts_ago}`, `{quest.expires_in}`, `{quest.time_left}`).',
          '`!quests thread on` opens a thread under each alert, with its own name, an optional ping of the alert role inside it, and the time it hides itself.',
          'The quest method: a message that tells how to complete quests, written once (a text with the `{quest.*}` variables or a saved embed with several texts and pictures) and sent in the thread or in a channel, with a ping or without it. `!quests method send` sends it now, and the dashboard has the same settings.',
        ],
      },
      {
        title: 'Embed codes',
        items: [
          'An autoresponder reply can be an embed code, with flags such as `--reply`, `--ping`, `--delete`, `--strict` and `--mode`.',
          '`!editembed <message link> <code>` changes a message that Petto already sent.',
        ],
      },
      {
        title: 'Server logs',
        items: [
          'New categories: `webhooks`, `threads`, `integrations` and `commands`. Stickers, soundboard sounds, scheduled events, AutoMod rules, pins, stages, timeouts, boosts, kicks and many server settings are logged too, with who did it.',
          'In the channel log the @everyone role is written right and a change of permissions says who made it.',
        ],
      },
      {
        title: 'Fixes',
        items: [
          'A name that is already taken in the dashboard is no longer reported as a Petto error.',
          'An embed code with a block that lost its closing brace ends that block where the next one starts.',
          'The total of members in the status messages no longer drops by a whole server for a moment.',
        ],
      },
    ],
  },
  'v0.7.1-2': {
    label: 'v0.7.1~2 · Boba: giveaways from the dashboard',
    summary: 'A small release for the dashboard: start, end and draw giveaways from the web, and a fix for the page buttons of the lists.',
    sections: [
      {
        title: 'Dashboard',
        items: [
          'Giveaways can be started from the dashboard, ended now, and drawn again, with the same engine as `/giveaway`.',
        ],
      },
      {
        title: 'Fixes',
        items: [
          'The page buttons of `!roles`, `!emojis` and the other lists no longer fail on some pages.',
        ],
      },
    ],
  },
  'v0.7.1-1': {
    label: 'v0.7.1~1 · Mochi: lists, times & team',
    summary: 'An improvement release: long lists with buttons, new info commands, better command blocking, times written in words, and a team you can edit from the dashboard.',
    sections: [
      {
        title: 'Lists with buttons',
        items: [
          '`!roles` shows a page at a time with buttons and a menu to sort it (most members, newest, name) or filter it (with a color, empty).',
          'New: `!emojis`, `!channels`, `!boosters` and `!inrole <role>` (also `!members`), all with pages, and a menu to filter them. Only whoever asked can turn the pages.',
        ],
      },
      {
        title: 'Blocking commands',
        items: [
          '`!disablecommand disable roles emojis channels` blocks several commands at once, `enable all` clears every rule and `list` has pages. `disablecommand` and `help` cannot be blocked, so nobody is left locked out.',
          'A blocked command is blocked as a slash command too, not only with the prefix.',
        ],
      },
      {
        title: 'Times',
        items: [
          'Every command that takes a length of time understands `3d 4h`, `1 hour 30 minutes`, `1h30m` and Spanish (`2 horas`). `!remind` also takes a moment: `tomorrow 8pm`, `2026-10-12 18:00`.',
          'New variables: `{timestamp}`, `{timestamp.relative}`, `{timestamp.full_long}`, and `{timestamp:tomorrow 8pm|R}` for any moment written in words.',
        ],
      },
      {
        title: 'Others',
        items: [
          'The public stats page ranks the top 5 servers.',
          'The team page can be edited by the owner from the dashboard (up to 100 people per position).',
          'Every version has a name. This one is Mochi.',
        ],
      },
    ],
  },
  'v0.7.1': {
    label: 'v0.7.1 · Partners, panels & more',
    summary: 'Tools for communities: partnerships with a ranking, uploads, requests, reviews and profiles, buttons and panels with no code, saved embeds for sticky messages, and quest alerts with four sources.',
    sections: [
      {
        title: 'Partners',
        items: [
          'A Partner Manager posts the invite of another server in a partner channel and, if it passes the requirements (minimum members, minimum age, a cooldown with the same server, a blacklist), it is counted and answered.',
          '`!partnerconfig` sets the channels (Free 6, Premium 25), the manager role, the requirements and 8 replies, each with text or a saved embed. `!partner stats` and `!partner leaderboard` show today, this week and all time.',
        ],
      },
      {
        title: 'Buttons and panels, with no code',
        items: [
          '`!responder add` makes a button (or a choice of a menu) that answers in private and gives, takes or toggles roles, with an optional required role.',
          '`!panel` shows them as buttons or as one menu, posts the message and updates it in place. Free servers can have 20 responders and 10 panels, Premium 250 and 50.',
          'Sticky messages can be one of your saved embeds (a V2 design too) and can be edited in the dashboard.',
        ],
      },
      {
        title: 'Uploads, requests & reviews',
        items: [
          'Uploads: files posted in the channels you choose are counted per member, with a role and a welcome at the first one (`!uploadconfig`, `!uploads`). Free 20 channels, Premium 100.',
          'Requests: `!request make` posts a card with Claim, Done, Unclaim and Cancel buttons for the staff. With Premium, a claimed request goes back to open if it is not finished in time.',
          'Reviews and profiles: `!review give @member 4` rates a member from 1 to 5 stars and `!profile` shows the rating with the uploads, requests and partnerships.',
        ],
      },
      {
        title: 'Dashboard & improvements',
        items: [
          'New dashboard pages: Partners, Buttons and panels, Uploads, Requests, and Reviews and profiles.',
          'Quest alerts read four sources (the short list of the discord-api-tracker repository first), so a new Quest is seen minutes after it starts even when the community API is down.',
          'Omniplex joins the Partners page of the website.',
        ],
      },
      {
        title: 'Fixes',
        items: [
          'A Quest that was published before it started is announced when it starts, not hours later.',
        ],
      },
    ],
  },
  'v0.7.0': {
    label: 'v0.7.0 · Petto Code, Quests & Embeds V2',
    summary: 'A big release: custom commands written in code, open to every server (Free 50 commands, Premium 100), with buttons, forms and reactions, an editor in the dashboard, Quest alerts, Components V2 embeds and global stats.',
    sections: [
      {
        title: 'Petto Code',
        items: [
          'Custom commands can now be written in **Petto Code**, a small language of text and `{{ }}` actions: variables, `if`, `range`, about 70 functions, embeds, mentions and time. `!customcommand code`, `codeshow`, `codetest` (runs it without sending anything), `template`, `export` and `import`.',
          'Buttons and menus that run code (`cbutton`, `cselect`), forms that pop up (`cmodal`, `ctext`, `showModal`) and reactions that run code (`"reactions"` in `complexMessage`, `.Trigger "reaction"`, `removeReaction`). One command holds the whole system.',
          'Commands can remember things: counters, points, rankings, cooldowns and lists, per server or per member (`dbSet`, `dbIncr`, `dbTop`...), even in their own database.',
          'Commands can start on their own prefix or words (`!customcommand trigger`): `?hello`, `hey bot`, `good morning`.',
          'Embeds take the avatar next to the author (`authorIcon`), and there are ready-made templates: vote, request, claim, suggest, report, profile, role button and role by reaction.',
          'Open to every server that can manage commands: Free servers can have up to 50 custom commands and Premium servers up to 100.',
          'Everything runs with limits, and what the code asks for is checked with the permissions of the person who wrote it. Docs: https://code.petto.sbs',
        ],
      },
      {
        title: 'Quest alerts',
        items: [
          '`!quests`: Petto posts in a channel when Discord has a new Quest, with the picture, the reward (Orbs or the avatar decoration), the tasks, the platforms, the dates and country or 18+ limits.',
          'Add a role to ping, filter by reward (`orbs`, `decoration`, `code`, `ingame`, `nitro`) or task, and get a warning hours before it ends. `!quests list` is for everyone.',
        ],
      },
      {
        title: 'Embeds V2',
        items: [
          'A new **V2 editor** in Embeds: containers, text, pictures, sections, dividers and link buttons. Use the designs in Quest alerts, sanctions, the starboard, verification and bump messages, and with `!embed send` and `!embed preview`.',
          'V2 designs are shared with the Embed Builder with a `p2.` code, and use the usual variables (and `{quest.*}`).',
        ],
      },
      {
        title: 'Global stats',
        items: [
          'A public **Stats** page (`petto.sbs/stats`): messages, voice hours and reactions of all servers, moving counters, a top 3 of servers and a top 10 of members.',
          'Every server can hide itself in the dashboard (General) and every member with `!globalranking off`.',
        ],
      },
      {
        title: 'Dashboard & improvements',
        items: [
          'New dashboard pages: **Commands in code** (a real editor that checks your code while you write, with templates, functions and a test button) and **Quests**.',
          'The menu has every section in its own group (Moderation, Security, Leveling, Automation, Community...) and on a phone it is a drawer at the side.',
          'The custom commands page shows the prefix of your server, and the web says Petto works with a prefix, not slash commands.',
          '`!help` points to the dashboard, the support server and the Petto Code docs.',
        ],
      },
      {
        title: 'Fixes',
        items: [
          'The Cloudflare tunnel no longer writes its token in the logs.',
          'Fixed dashboard errors that asked for data that does not exist, and the Premium texts that sounded unavailable.',
          'The server count of the home page and the status page now match.',
        ],
      },
    ],
  },
  'v0.6.1': {
    label: 'v0.6.1 · Leveling, cards & custom messages',
    summary: 'A big release: a new leveling system with rank cards, image cards for every message, saved embeds for sanctions, starboard, giveaways and more, plus jail, purge, history, reports management and new fun commands.',
    sections: [
      {
        title: 'Leveling',
        items: [
          '`!rank` answers with a rank card, the improved embed, or both (`!level rank-style`). The embed shows the position, XP to the next level, messages, voice time, the streak and the week.',
          'Anti-abuse rules (`!level rules`): minimum length, links and mentions, repeated text and voice minimums.',
          'XP events with a multiplier (`!level event`), daily bonus and streaks, and `!top 1 messages week` or `!top 1 messages month`.',
        ],
      },
      {
        title: 'Image cards & embeds',
        items: [
          'Image cards: pictures drawn for welcome, leave, boost, tickets, giveaways, level-up and more. The basic editor is free, the layer editor is Premium.',
          '`!embed create name code:` builds a whole embed (up to 10) from one code and saves it at once.',
          'Saved embeds can now replace the usual message of sanctions (DM, reply and log, per type, with `!sanctionmessage`), the starboard, giveaway messages, verification DMs and bump messages. New variables: `{case.*}`, `{star.*}`, `{verify.link}`, `{nextBump}`.',
        ],
      },
      {
        title: 'Moderation & reports',
        items: [
          'Jail (`!jail`, `!unjail`): the member loses their roles and only sees the jail channel. Timed jails end by themselves and roles come back on release. Also usable in `warn escalation`.',
          '`!purge` deletes recent messages by member, kind or text, and `!history` shows a member\'s whole moderation history in one card.',
          'Reports are numbered with Claim, Resolve, Dismiss and Reopen buttons, categories, cooldown, daily limit, blocking, a reason on closing, a thread that follows the report and a settings panel.',
          'Report User menus on users and messages.',
        ],
      },
      {
        title: 'Utility & fun',
        items: [
          '`!roll` (`2d6+3`, `4d6kh3`), `!choose`, and the Fun category: `!8ball`, `!ship` (with a picture) and `!rps`.',
          'Customize (Premium): give Petto a name style in your server, a gradient, neon or glow, from the dashboard.',
        ],
      },
      {
        title: 'Improvements',
        items: [
          '`!setup` opens a status panel at once, with a pre-filled quick setup.',
          'Info commands (`serverinfo`, `userinfo`, `botinfo`, `roleinfo`...) and `!case list` redesigned as cards. Roleplay answers reply to the original message. `!remind 2h text` works without `add`.',
        ],
      },
      {
        title: 'Fixes',
        items: [
          'Live counters update again, and counters for users, bots and boosters count the whole member list.',
          'Bot commands no longer set off autoresponders, and hints show the prefix that was typed.',
        ],
      },
    ],
  },
  'v0.6.0': {
    label: 'v0.6.0 · Dashboard, embeds & Petto Vanity',
    summary: 'A release focused on the dashboard: it speaks Spanish and Brazilian Portuguese, previews messages like Discord, connects to the Embed Builder, and now also manages the separate Petto Vanity bot.',
    sections: [
      {
        title: 'Dashboard',
        items: [
          'The whole dashboard is translated to Spanish and Brazilian Portuguese, with `/es/dash` and `/pt-br/dash` and a language menu that remembers the choice.',
          'Message previews render like the Embed Builder, with markdown, links, mentions, emojis and timestamps, and show the bot\'s own name and avatar, including a custom one, also in the join gate.',
          'Server lists are cached for a short time and Premium is read once per request, so pages load faster.',
          'Fixed the dashboard not scrolling on small screens in the built site, and fixed preview freezes.',
        ],
      },
      {
        title: 'Embeds & variables',
        items: [
          'Dashboard messages can be sent to the Embed Builder with a share code, messages sent from it can be opened in the dashboard, and a test message can be sent to a channel.',
          'Added a registry of the embed variables and `GET /api/dashboard/variables`, so the dashboard reads the list from the bot. `npm run check` now fails when the registry and the variable engine disagree.',
          'Fixed a crash when an embed command was used without an embed name.',
        ],
      },
      {
        title: 'Petto Vanity',
        items: [
          'The separate Petto Vanity bot can be managed from the dashboard: vanity rules, Server Tag rules, thank-you messages and the staff log.',
          'Petto Vanity reports its state, servers, latency and uptime, with a public status page on the Petto site.',
        ],
      },
    ],
  },
  'v0.5.1-46': {
    label: 'v0.5.1-46 · Reliability, safety & automation',
    summary: 'A reliability and safety release with persistent malicious-link detection, stronger guild operations, independent moderation cases, and argument-aware custom commands.',
    sections: [
      {
        title: 'Reliability & onboarding',
        items: [
          'Fixed webhook counters and mention handling when sending webhook notifications.',
          'Fixed VoiceMaster interaction handling and improved resilience against transient PostgreSQL gateway timeouts.',
          'Added safe retries for transient database reads and stale-cache fallbacks for known configuration.',
          'Reduced database pressure from sticky messages and autoresponders, while preventing unsafe XP write retries.',
          'Fixed excessive permission overwrites and improved onboarding channel creation for large guilds.',
        ],
      },
      {
        title: 'AutoMod & malicious links',
        items: [
          'Added persistent malicious-URL detection for links discovered through `!am`.',
          'Known malicious URLs are reused from storage instead of being checked with an external service on every message.',
          'Known malicious links are removed automatically, and the development team is alerted when a new URL is detected.',
        ],
      },
      {
        title: 'Guild operations & compliance',
        items: [
          'Added the `guildsend` team command and automated guild diagnostics and compliance monitoring.',
          'Added shop/store/compliance detection, team review alerts, manual scans, leave confirmation controls, and clearer guild notices.',
        ],
      },
      {
        title: 'Moderation cases',
        items: [
          'Case numbers are now independent per guild and stored through persistent guild counters.',
          'All moderation sanctions and automated actions share one per-guild sequence, with a migration for existing case history.',
          '`case list` no longer requires a user and now supports optional user filtering and pagination.',
        ],
      },
      {
        title: 'Custom command arguments',
        items: [
          'Added `{args}`, `{arg1}` through `{arg10}`, `{args_from:N}`, `{arg_count}`, `{command_name}`, and `{prefix}`.',
          'Quoted text stays together as one argument, saved embed templates support the new variables, and user-provided arguments cannot create mass mentions.',
          'Custom commands can now use embed-only templates, editing preserves unchanged fields, and the command editor includes a variables reference.',
        ],
      },
    ],
  },
  'v0.5.0': {
    label: 'v0.5.0 · Connected roles & activity',
    summary: 'A connected release for linked roles, instant prefix sync, richer activity summaries, and social roleplay.',
    sections: [
      {
        title: 'Connected roles & dashboard',
        items: [
          'Added the linked-roles connection flow so members can connect Petto to Discord and receive the Petto Verified role in participating servers.',
          'The web stores the server prefix through the private bot API and notifies the bot immediately.',
          'The bot refreshes its prefix cache immediately, and resetting the prefix synchronizes the default `!` prefix again.',
          'Server nicknames remain free; Premium continues to cover the other server profile customization fields.',
        ],
      },
      {
        title: 'Activity & roleplay',
        items: [
          'Added the `!summary`, `!weekly`, and `!digest` activity chart with dark Overview styling, daily green/orange series, and a text-only fallback when Canvas is unavailable.',
          'Added Respond/Reject controls to targeted roleplay commands. The mentioned member can respond once with the same action or reject with a slap.',
          'Added persistent per-server, per-user, per-action roleplay counters and new commands: `!hi`, `!bye`, `!yes`, `!no`, `!laugh`, `!sad`, and `!angry`.',
        ],
      },
      {
        title: 'Fixes & safety',
        items: [
          'Fixed the statistics job\'s `.catch()` handling and updated setup/removal messages for clearer server configuration.',
          'Added rate limiting to the internal prefix API to reduce abuse and satisfy the security checks.',
          'Changed booster eligibility copy to use Discord\'s `server booster` terminology.',
        ],
      },
    ],
  },
  'v0.4.1': {
    label: 'v0.4.1 · Reports & reliability',
    summary: 'A focused update for reports, Premium server changes, profile details, and operational logs.',
    sections: [
      {
        title: 'Reports',
        items: [
          'Improved the report system and added the native `/report config` configuration form.',
          'Added the urgent moderator role selector and connected the new report settings to Community Configs.',
          'Report cards preserve the reported message link, text, and image attachments when available.',
        ],
      },
      {
        title: 'Fixes & reliability',
        items: [
          'Fixed the Premium issue that could block changing the active server or hide an existing Premium assignment.',
          'Improved audit-log caching, retries, stale fallbacks, and partial-message handling.',
          'Centralized event error handling so one rejected handler does not silently disappear.',
        ],
      },
      {
        title: 'Profile tools',
        items: [
          'Improved `!ui` and `!userinfo` with fresh profile data, banners, avatars, roles, badges, timestamps, and profile links.',
          'Added better media-change detection and more useful information for staff reviewing a member.',
        ],
      },
    ],
  },
  'v0.4.0': {
    label: 'v0.4.0 · Safety systems',
    summary: 'A major safety release with Honeypot, Petto Vault, stronger prefix parsing, and safer setup flows.',
    sections: [
      {
        title: 'New systems',
        items: [
          'Added the Components V2 Honeypot panel with trigger counts, moderation cases, sanctions logs, and automod logs.',
          'Added Petto Vault backup flows for create, list, export, restore, schedules, audit history, and safety backups.',
          'Backup numbers are scoped per server so staff see `#1`, `#2`, and so on instead of internal database IDs.',
        ],
      },
      {
        title: 'Moderation & safety',
        items: [
          'Custom prefixes are case-insensitive and accept optional whitespace before a command.',
          'Moderation targets accept mentions, IDs, exact usernames, and exact display names while rejecting ambiguous names.',
          'Setup now opts into AutoMod explicitly and reports partial permission or channel failures separately.',
        ],
      },
      {
        title: 'Experience',
        items: [
          'Honeypot and Vault panels use Petto artwork and Components V2 controls.',
          'Report flows support urgent roles, anonymous reports, image attachments, and the new red report indicators.',
          'Removed automatic invite creation for Top.gg to keep the official invite flow private and intentional.',
        ],
      },
    ],
  },
  'v0.3.0-2': {
    label: 'v0.3.0-2 · Operational visibility',
    summary: 'The operational visibility release for Discord REST rate limits and bot version tracking.',
    sections: [
      {
        title: 'Reliability',
        items: [
          'Added Discord REST rate-limit telemetry with method, sanitized route, scope, retry delay, and bucket limit.',
          'Repeated rate-limit events are grouped for one minute so the log stays useful without flooding staff.',
        ],
      },
      {
        title: 'Release notes',
        items: [
          'Bumped the bot version from `0.1.0` to `0.3.0-2` and documented the validation status.',
        ],
      },
    ],
  },
  'v0.3.0-1': {
    label: 'v0.3.0-1 · Vanity system',
    summary: 'Introduced Petto\'s Vanity system and documented the first public version of that release.',
    sections: [
      {
        title: 'Vanity',
        items: [
          'Added the Vanity system for managing and presenting a server\'s vanity identity through Petto.',
          'The original release entry and its full notes are available in the public changelog.',
        ],
      },
      {
        title: 'More details',
        items: [
          'See the August 13, 2026 entry in the Petto changelog for the complete release context.',
        ],
      },
    ],
  },
};
