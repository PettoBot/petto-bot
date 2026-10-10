const { EMOJI } = require('./emojis');

const RELEASES = [
  {
    version: 'v0.7.4',
    display: 'v0.7.4',
    name: 'Brownie',
    label: 'v0.7.4 · Brownie: Vanity in Petto, statistics & hardban',
    date: '2026-10-10',
    accent: 0xf0a88f,
    status: `${EMOJI.RELEASE_APPROVED} Latest`,
    summary: 'Vanity and Server Tag roles inside Petto, a new look for sanctions, a real hardban, `/summary` with sanctions, joins, leaves and invites, a fuller invite tracker, a prefix of your own and Petto working in GMT-5 (Colombia).',
    sections: [
      {
        title: `${EMOJI.RELEASE_ROCKET} Vanity and Server Tag`,
        items: [
          '`!vanity`, `!guildtag` and `!identity` (short names `!vy` and `!tag`) give or take a role by the Custom Status, the name or the Server Tag of a member, with a thank-you message, a log and persistent roles. The data of the old Vanity bot can be imported.',
          'Reaction roles: buttons with a color, a row and only an emoji, and `!reactionrole add new` posts a saved embed with its role button.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_MAGIC} Moderation`,
        items: [
          'A new default look for sanctions (reply, log and member DM) in Components V2 with new icons, and more kinds of message for `!sender`.',
          '`!hardban` is real: only the server owner and the antinuke admins can unban, and Petto puts the ban back if somebody else lifts it. A hackban is a ban by ID.',
          'Kicking or banning an administrator bot works when Petto is above it.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_EYES} Statistics`,
        items: [
          '`!summary` by `messages`, `voice`, `joins`, `leaves`, `invites` or `sanctions`, with the most active hour, a new picture and the Statistics page in the dashboard.',
          'The invite tracker counts fake and bonus invites, gives roles for reaching a number of invites, has `{inviter}` variables for the welcome message and a leaderboard by week or month.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_SETTINGS} Your own prefix and time`,
        items: [
          '`!myprefix` gives boosters of the support server, Premium users, partners and the team a prefix of their own in every server.',
          'Petto works in GMT-5 (Colombia) and says so: days, weeks, hours and the times you write.',
        ],
      },
    ],
  },
  {
    version: 'v0.7.3',
    display: 'v0.7.3',
    name: 'Flan',
    label: 'v0.7.3 · Flan: easier tickets, config cards & votes',
    date: '2026-10-08',
    accent: 0xffe3a3,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'A guided setup for tickets, a `!<command>config` card for every command, votes from top.gg with a voter role, and Petto online with the phone icon.',
    sections: [
      {
        title: `${EMOJI.RELEASE_ROCKET} Tickets`,
        items: [
          '`!ticket setup` is a guided setup: pick the channel, the support roles and a log channel, write the title and text, add the ticket types and publish everything with one press.',
          'Ticket forms are built with buttons (`!ticket form create name:<name>`), no need to type the field syntax.',
          'Each ticket type has its own welcome text, and the channel name accepts `{userid}` and `{category}`.',
          'Staff tools inside a ticket: `!ticket priority`, `!ticket transfer`, `!ticket note` and `!ticket request-close`.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_SETTINGS} Config cards`,
        items: [
          'Every module has a `!<module>config` card with what the server has set now and every command of the module: `!brconfig`, `!welcomeconfig`, `!levelconfig`, `!ticketconfig`, `!automodconfig`, `!logsconfig` and 36 more.',
          'Every other command gets its own card when Petto starts (`!banconfig`, `!purgeconfig`...), and a command with a short name has its card under it too (`!arconfig`).',
          '`!cmdconfig` shows the recommended Petto configuration with commands ready to copy.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_MAGIC} Votes`,
        items: [
          'Petto receives the votes from top.gg: each one is counted once, thanked in a channel with a card, and gives the voter a role that stays.',
          '`!votes` shows the votes of Petto and of a member, and `!votes top` the members who voted the most.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_RELOAD} Giveaways & status`,
        items: [
          'A giveaway that is running can be changed from the dashboard (prize, winners and end), and `!giveaway edit` reads a prize with several words and no quotes.',
          'Petto is online with the phone icon by default, and the team can change the dot with `!botstatus`.',
          'Changing several permissions of a channel is told in one log message.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_BUG} Fixes`,
        items: [
          'The partner replies really ping the manager of the partnership.',
          'Pinned and unpinned messages are logged again (the log failed with an error each time).',
        ],
      },
    ],
  },
  {
    version: 'v0.7.2',
    display: 'v0.7.2',
    name: 'Churro',
    label: 'v0.7.2 · Churro: logs, embed codes & quest threads',
    date: '2026-10-07',
    accent: 0xffc58a,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'A thread and a "how to complete it" message for the quest alerts, embed codes in autoresponders and `!editembed`, and many more events in the server logs.',
    sections: [
      {
        title: `${EMOJI.RELEASE_ROCKET} Quest alerts`,
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
        title: `${EMOJI.RELEASE_SETTINGS} Embed codes`,
        items: [
          'An autoresponder reply can be an embed code, with flags such as `--reply`, `--ping`, `--delete`, `--strict` and `--mode`.',
          '`!editembed <message link> <code>` changes a message that Petto already sent.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_SETTINGS} Server logs`,
        items: [
          'New categories: `webhooks`, `threads`, `integrations` and `commands`. Stickers, soundboard sounds, scheduled events, AutoMod rules, pins, stages, timeouts, boosts, kicks and many server settings are logged too, with who did it.',
          'In the channel log the @everyone role is written right and a change of permissions says who made it.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_BUG} Fixes`,
        items: [
          'A name that is already taken in the dashboard is no longer reported as a Petto error.',
          'An embed code with a block that lost its closing brace ends that block where the next one starts.',
          'The total of members in the status messages no longer drops by a whole server for a moment.',
        ],
      },
    ],
  },
  {
    version: 'v0.7.1-2',
    display: 'v0.7.1~2',
    name: 'Boba',
    label: 'v0.7.1~2 · Boba: giveaways from the dashboard',
    date: '2026-10-05',
    accent: 0xe7c4ff,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'A small release for the dashboard: start, end and draw giveaways from the web, and a fix for the page buttons of the lists.',
    sections: [
      {
        title: `${EMOJI.RELEASE_ROCKET} Dashboard`,
        items: [
          'Giveaways can be started from the dashboard, ended now, and drawn again, with the same engine as `/giveaway`.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_BUG} Fixes`,
        items: [
          'The page buttons of `!roles`, `!emojis` and the other lists no longer fail on some pages.',
        ],
      },
    ],
  },
  {
    version: 'v0.7.1-1',
    display: 'v0.7.1~1',
    name: 'Mochi',
    label: 'v0.7.1~1 · Mochi: lists, times & team',
    date: '2026-10-05',
    accent: 0xffb3d1,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'An improvement release: long lists with buttons, new info commands, better command blocking, times written in words, and a team you can edit from the dashboard.',
    sections: [
      {
        title: `${EMOJI.RELEASE_ROCKET} Lists with buttons`,
        items: [
          '`!roles` shows a page at a time with buttons and a menu to sort it (most members, newest, name) or filter it (with a color, empty).',
          'New: `!emojis`, `!channels`, `!boosters` and `!inrole <role>` (also `!members`), all with pages, and a menu to filter them. Only whoever asked can turn the pages.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_SETTINGS} Blocking commands`,
        items: [
          '`!disablecommand disable roles emojis channels` blocks several commands at once, `enable all` clears every rule and `list` has pages. `disablecommand` and `help` cannot be blocked, so nobody is left locked out.',
          'A blocked command is blocked as a slash command too, not only with the prefix.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_MAGIC} Times`,
        items: [
          'Every command that takes a length of time understands `3d 4h`, `1 hour 30 minutes`, `1h30m` and Spanish (`2 horas`). `!remind` also takes a moment: `tomorrow 8pm`, `2026-10-12 18:00`.',
          'New variables: `{timestamp}`, `{timestamp.relative}`, `{timestamp.full_long}`, and `{timestamp:tomorrow 8pm|R}` for any moment written in words.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_EXPERIENCE} Others`,
        items: [
          'The public stats page ranks the top 5 servers.',
          'The team page can be edited by the owner from the dashboard (up to 100 people per position).',
          'Every version has a name. This one is Mochi.',
        ],
      },
    ],
  },
  {
    version: 'v0.7.1',
    name: 'Pudding',
    label: 'v0.7.1 · Partners, panels & more',
    date: '2026-10-03',
    accent: 0xff91c2,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'Tools for communities: partnerships with a ranking, uploads, requests, reviews and profiles, buttons and panels with no code, saved embeds for sticky messages, and quest alerts with four sources.',
    sections: [
      {
        title: `${EMOJI.RELEASE_ROCKET} Partners`,
        items: [
          'A Partner Manager posts the invite of another server in a partner channel and, if it passes the requirements (minimum members, minimum age, a cooldown with the same server, a blacklist), it is counted and answered.',
          '`!partnerconfig` sets the channels (Free 6, Premium 25), the manager role, the requirements and 8 replies, each with text or a saved embed. `!partner stats` and `!partner leaderboard` show today, this week and all time.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_MAGIC} Buttons and panels, with no code`,
        items: [
          '`!responder add` makes a button (or a choice of a menu) that answers in private and gives, takes or toggles roles, with an optional required role.',
          '`!panel` shows them as buttons or as one menu, posts the message and updates it in place. Free servers can have 20 responders and 10 panels, Premium 250 and 50.',
          'Sticky messages can be one of your saved embeds (a V2 design too) and can be edited in the dashboard.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_EXPERIENCE} Uploads, requests & reviews`,
        items: [
          'Uploads: files posted in the channels you choose are counted per member, with a role and a welcome at the first one (`!uploadconfig`, `!uploads`). Free 20 channels, Premium 100.',
          'Requests: `!request make` posts a card with Claim, Done, Unclaim and Cancel buttons for the staff. With Premium, a claimed request goes back to open if it is not finished in time.',
          'Reviews and profiles: `!review give @member 4` rates a member from 1 to 5 stars and `!profile` shows the rating with the uploads, requests and partnerships.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_SETTINGS} Dashboard & improvements`,
        items: [
          'New dashboard pages: Partners, Buttons and panels, Uploads, Requests, and Reviews and profiles.',
          'Quest alerts read four sources (the short list of the discord-api-tracker repository first), so a new Quest is seen minutes after it starts even when the community API is down.',
          'Omniplex joins the Partners page of the website.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_BUG} Fixes`,
        items: [
          'A Quest that was published before it started is announced when it starts, not hours later.',
        ],
      },
    ],
  },
  {
    version: 'v0.7.0',
    name: 'Macaron',
    label: 'v0.7.0 · Petto Code, Quests & Embeds V2',
    date: '2026-10-03',
    accent: 0xff91c2,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'A big release: custom commands written in code, open to every server (Free 50 commands, Premium 100), with buttons, forms and reactions, an editor in the dashboard, Quest alerts, Components V2 embeds and global stats.',
    sections: [
      {
        title: `${EMOJI.RELEASE_PC} Petto Code`,
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
        title: `${EMOJI.RELEASE_ROCKET} Quest alerts`,
        items: [
          '`!quests`: Petto posts in a channel when Discord has a new Quest, with the picture, the reward (Orbs or the avatar decoration), the tasks, the platforms, the dates and country or 18+ limits.',
          'Add a role to ping, filter by reward (`orbs`, `decoration`, `code`, `ingame`, `nitro`) or task, and get a warning hours before it ends. `!quests list` is for everyone.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_MAGIC} Embeds V2`,
        items: [
          'A new **V2 editor** in Embeds: containers, text, pictures, sections, dividers and link buttons. Use the designs in Quest alerts, sanctions, the starboard, verification and bump messages, and with `!embed send` and `!embed preview`.',
          'V2 designs are shared with the Embed Builder with a `p2.` code, and use the usual variables (and `{quest.*}`).',
        ],
      },
      {
        title: `${EMOJI.RELEASE_EXPERIENCE} Global stats`,
        items: [
          'A public **Stats** page (`petto.sbs/stats`): messages, voice hours and reactions of all servers, moving counters, a top 3 of servers and a top 10 of members.',
          'Every server can hide itself in the dashboard (General) and every member with `!globalranking off`.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_SETTINGS} Dashboard & improvements`,
        items: [
          'New dashboard pages: **Commands in code** (a real editor that checks your code while you write, with templates, functions and a test button) and **Quests**.',
          'The menu has every section in its own group (Moderation, Security, Leveling, Automation, Community...) and on a phone it is a drawer at the side.',
          'The custom commands page shows the prefix of your server, and the web says Petto works with a prefix, not slash commands.',
          '`!help` points to the dashboard, the support server and the Petto Code docs.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_BUG} Fixes`,
        items: [
          'The Cloudflare tunnel no longer writes its token in the logs.',
          'Fixed dashboard errors that asked for data that does not exist, and the Premium texts that sounded unavailable.',
          'The server count of the home page and the status page now match.',
        ],
      },
    ],
  },
  {
    version: 'v0.6.1',
    name: 'Taiyaki',
    label: 'v0.6.1 · Leveling, cards & custom messages',
    date: '2026-10-02',
    accent: 0xff91c2,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'A big release: a new leveling system with rank cards, image cards for every message, saved embeds for sanctions, starboard, giveaways and more, plus jail, purge, history, reports management and new fun commands.',
    sections: [
      {
        title: `${EMOJI.RELEASE_EXPERIENCE} Leveling`,
        items: [
          '`!rank` answers with a rank card, the improved embed, or both (`!level rank-style`). The embed shows the position, XP to the next level, messages, voice time, the streak and the week.',
          'Anti-abuse rules (`!level rules`): minimum length, links and mentions, repeated text and voice minimums.',
          'XP events with a multiplier (`!level event`), daily bonus and streaks, and `!top 1 messages week` or `!top 1 messages month`.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_MAGIC} Image cards & embeds`,
        items: [
          'Image cards: pictures drawn for welcome, leave, boost, tickets, giveaways, level-up and more. The basic editor is free, the layer editor is Premium.',
          '`!embed create name code:` builds a whole embed (up to 10) from one code and saves it at once.',
          'Saved embeds can now replace the usual message of sanctions (DM, reply and log, per type, with `!sanctionmessage`), the starboard, giveaway messages, verification DMs and bump messages. New variables: `{case.*}`, `{star.*}`, `{verify.link}`, `{nextBump}`.',
        ],
      },
      {
        title: `${EMOJI.HAMMER} Moderation & reports`,
        items: [
          'Jail (`!jail`, `!unjail`): the member loses their roles and only sees the jail channel. Timed jails end by themselves and roles come back on release. Also usable in `warn escalation`.',
          '`!purge` deletes recent messages by member, kind or text, and `!history` shows a member\'s whole moderation history in one card.',
          'Reports are numbered with Claim, Resolve, Dismiss and Reopen buttons, categories, cooldown, daily limit, blocking, a reason on closing, a thread that follows the report and a settings panel.',
          'Report User menus on users and messages.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_ROCKET} Utility & fun`,
        items: [
          '`!roll` (`2d6+3`, `4d6kh3`), `!choose`, and the Fun category: `!8ball`, `!ship` (with a picture) and `!rps`.',
          'Customize (Premium): give Petto a name style in your server, a gradient, neon or glow, from the dashboard.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_SETTINGS} Improvements`,
        items: [
          '`!setup` opens a status panel at once, with a pre-filled quick setup.',
          'Info commands (`serverinfo`, `userinfo`, `botinfo`, `roleinfo`...) and `!case list` redesigned as cards. Roleplay answers reply to the original message. `!remind 2h text` works without `add`.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_BUG} Fixes`,
        items: [
          'Live counters update again, and counters for users, bots and boosters count the whole member list.',
          'Bot commands no longer set off autoresponders, and hints show the prefix that was typed.',
        ],
      },
    ],
  },
  {
    version: 'v0.6.0',
    name: 'Dango',
    label: 'v0.6.0 · Dashboard, embeds & Petto Vanity',
    date: '2026-09-30',
    accent: 0x8c7cff,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'A release focused on the dashboard: it speaks Spanish and Brazilian Portuguese, previews messages like Discord, connects to the Embed Builder, and now also manages the separate Petto Vanity bot.',
    sections: [
      {
        title: `${EMOJI.RELEASE_MAGIC} Dashboard`,
        items: [
          'The whole dashboard is translated to Spanish and Brazilian Portuguese, with `/es/dash` and `/pt-br/dash` and a language menu that remembers the choice.',
          'Message previews render like the Embed Builder, with markdown, links, mentions, emojis and timestamps, and show the bot\'s own name and avatar, including a custom one, also in the join gate.',
          'Server lists are cached for a short time and Premium is read once per request, so pages load faster.',
          'Fixed the dashboard not scrolling on small screens in the built site, and fixed preview freezes.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_LINK} Embeds & variables`,
        items: [
          'Dashboard messages can be sent to the Embed Builder with a share code, messages sent from it can be opened in the dashboard, and a test message can be sent to a channel.',
          'Added a registry of the embed variables and `GET /api/dashboard/variables`, so the dashboard reads the list from the bot. `npm run check` now fails when the registry and the variable engine disagree.',
          'Fixed a crash when an embed command was used without an embed name.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_SETTINGS} Petto Vanity`,
        items: [
          'The separate Petto Vanity bot can be managed from the dashboard: vanity rules, Server Tag rules, thank-you messages and the staff log.',
          'Petto Vanity reports its state, servers, latency and uptime, with a public status page on the Petto site.',
        ],
      },
    ],
  },
  {
    version: 'v0.5.1-46',
    name: 'Cupcake',
    label: 'v0.5.1-46 · Reliability, safety & automation',
    date: '2026-09-24',
    accent: 0x8c7cff,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'A reliability and safety release with persistent malicious-link detection, stronger guild operations, independent moderation cases, and argument-aware custom commands.',
    sections: [
      {
        title: `${EMOJI.RELEASE_BUG} Reliability & onboarding`,
        items: [
          'Fixed webhook counters and mention handling when sending webhook notifications.',
          'Fixed VoiceMaster interaction handling and improved resilience against transient PostgreSQL gateway timeouts.',
          'Added safe retries for transient database reads and stale-cache fallbacks for known configuration.',
          'Reduced database pressure from sticky messages and autoresponders, while preventing unsafe XP write retries.',
          'Fixed excessive permission overwrites and improved onboarding channel creation for large guilds.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_LOCKED} AutoMod & malicious links`,
        items: [
          'Added persistent malicious-URL detection for links discovered through `!am`.',
          'Known malicious URLs are reused from storage instead of being checked with an external service on every message.',
          'Known malicious links are removed automatically, and the development team is alerted when a new URL is detected.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_SETTINGS} Guild operations & compliance`,
        items: [
          'Added the `guildsend` team command and automated guild diagnostics and compliance monitoring.',
          'Added shop/store/compliance detection, team review alerts, manual scans, leave confirmation controls, and clearer guild notices.',
        ],
      },
      {
        title: `${EMOJI.HAMMER} Moderation cases`,
        items: [
          'Case numbers are now independent per guild and stored through persistent guild counters.',
          'All moderation sanctions and automated actions share one per-guild sequence, with a migration for existing case history.',
          '`case list` no longer requires a user and now supports optional user filtering and pagination.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_MAGIC} Custom command arguments`,
        items: [
          'Added `{args}`, `{arg1}` through `{arg10}`, `{args_from:N}`, `{arg_count}`, `{command_name}`, and `{prefix}`.',
          'Quoted text stays together as one argument, saved embed templates support the new variables, and user-provided arguments cannot create mass mentions.',
          'Custom commands can now use embed-only templates, editing preserves unchanged fields, and the command editor includes a variables reference.',
        ],
      },
    ],
  },
  {
    version: 'v0.5.0',
    name: 'Churro',
    label: 'v0.5.0 · Connected roles & activity',
    date: '2026-08-31',
    accent: 0x5eead4,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'A connected release for linked roles, instant prefix sync, richer activity summaries, and social roleplay.',
    sections: [
      {
        title: `${EMOJI.RELEASE_LINK} Connected roles & dashboard`,
        items: [
          'Added the linked-roles connection flow so members can connect Petto to Discord and receive the Petto Verified role in participating servers.',
          'The web stores the server prefix through the private bot API and notifies the bot immediately.',
          'The bot refreshes its prefix cache immediately, and resetting the prefix synchronizes the default `!` prefix again.',
          'Server nicknames remain free; Premium continues to cover the other server profile customization fields.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_ROCKET} Activity & roleplay`,
        items: [
          'Added the `!summary`, `!weekly`, and `!digest` activity chart with dark Overview styling, daily green/orange series, and a text-only fallback when Canvas is unavailable.',
          'Added Respond/Reject controls to targeted roleplay commands. The mentioned member can respond once with the same action or reject with a slap.',
          'Added persistent per-server, per-user, per-action roleplay counters and new commands: `!hi`, `!bye`, `!yes`, `!no`, `!laugh`, `!sad`, and `!angry`.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_BUG} Fixes & safety`,
        items: [
          'Fixed the statistics job\'s `.catch()` handling and updated setup/removal messages for clearer server configuration.',
          'Added rate limiting to the internal prefix API to reduce abuse and satisfy the security checks.',
          'Changed booster eligibility copy to use Discord\'s `server booster` terminology.',
        ],
      },
    ],
  },
  {
    version: 'v0.4.1',
    name: 'Waffle',
    label: 'v0.4.1 · Reports & reliability',
    date: '2026-08-26',
    accent: 0xfe6465,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'A focused update for reports, Premium server changes, profile details, and operational logs.',
    sections: [
      {
        title: `${EMOJI.REPORT} Reports`,
        items: [
          'Improved the report system and added the native `/report config` configuration form.',
          'Added the urgent moderator role selector and connected the new report settings to Community Configs.',
          'Report cards preserve the reported message link, text, and image attachments when available.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_BUG} Fixes & reliability`,
        items: [
          'Fixed the Premium issue that could block changing the active server or hide an existing Premium assignment.',
          'Improved audit-log caching, retries, stale fallbacks, and partial-message handling.',
          'Centralized event error handling so one rejected handler does not silently disappear.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_EYES} Profile tools`,
        items: [
          'Improved `!ui` and `!userinfo` with fresh profile data, banners, avatars, roles, badges, timestamps, and profile links.',
          'Added better media-change detection and more useful information for staff reviewing a member.',
        ],
      },
    ],
  },
  {
    version: 'v0.4.0',
    name: 'Crepe',
    label: 'v0.4.0 · Safety systems',
    date: '2026-08-24',
    accent: 0x8c7cff,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'A major safety release with Honeypot, Petto Vault, stronger prefix parsing, and safer setup flows.',
    sections: [
      {
        title: `${EMOJI.RELEASE_ROCKET} New systems`,
        items: [
          'Added the Components V2 Honeypot panel with trigger counts, moderation cases, sanctions logs, and automod logs.',
          'Added Petto Vault backup flows for create, list, export, restore, schedules, audit history, and safety backups.',
          'Backup numbers are scoped per server so staff see `#1`, `#2`, and so on instead of internal database IDs.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_LOCKED} Moderation & safety`,
        items: [
          'Custom prefixes are case-insensitive and accept optional whitespace before a command.',
          'Moderation targets accept mentions, IDs, exact usernames, and exact display names while rejecting ambiguous names.',
          'Setup now opts into AutoMod explicitly and reports partial permission or channel failures separately.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_MAGIC} Experience`,
        items: [
          'Honeypot and Vault panels use Petto artwork and Components V2 controls.',
          'Report flows support urgent roles, anonymous reports, image attachments, and the new red report indicators.',
          'Removed automatic invite creation for Top.gg to keep the official invite flow private and intentional.',
        ],
      },
    ],
  },
  {
    version: 'v0.3.0-2',
    name: 'Biscuit',
    label: 'v0.3.0-2 · Operational visibility',
    date: '2026-08-22',
    accent: 0x4b4f59,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'The operational visibility release for Discord REST rate limits and bot version tracking.',
    sections: [
      {
        title: `${EMOJI.RELEASE_METAL} Reliability`,
        items: [
          'Added Discord REST rate-limit telemetry with method, sanitized route, scope, retry delay, and bucket limit.',
          'Repeated rate-limit events are grouped for one minute so the log stays useful without flooding staff.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_NOTE} Release notes`,
        items: [
          'Bumped the bot version from `0.1.0` to `0.3.0-2` and documented the validation status.',
        ],
      },
    ],
  },
  {
    version: 'v0.3.0-1',
    name: 'Cookie',
    label: 'v0.3.0-1 · Vanity system',
    date: '2026-08-13',
    accent: 0x5c8dff,
    status: `${EMOJI.RELEASE_APPROVED} Published`,
    summary: 'Introduced Petto\'s Vanity system and documented the first public version of that release.',
    sections: [
      {
        title: `${EMOJI.RELEASE_MAGIC} Vanity`,
        items: [
          'Added the Vanity system for managing and presenting a server\'s vanity identity through Petto.',
          'The original release entry and its full notes are available in the public changelog.',
        ],
      },
      {
        title: `${EMOJI.RELEASE_LINK} More details`,
        items: [
          'See the August 13, 2026 entry in the Petto changelog for the complete release context.',
        ],
      },
    ],
  },
];

function getRelease(version) {
  return RELEASES.find((release) => release.version === version) ?? null;
}

function getLatestRelease() {
  return RELEASES[0];
}

function getReleaseIndex(version) {
  const index = RELEASES.findIndex((release) => release.version === version);
  return index === -1 ? 0 : index;
}

module.exports = { RELEASES, getRelease, getLatestRelease, getReleaseIndex };
