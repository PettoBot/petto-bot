-- Petto bot schema
-- Run this in the Supabase SQL editor (or via `supabase db push` / psql).
-- The bot connects with the service_role key, which bypasses RLS entirely.
-- RLS is enabled anyway so that no other key (anon, authenticated) can read
-- or write this data if one is ever created for a future dashboard.

-- ---------------------------------------------------------------------------
-- guilds: per-server configuration
-- ---------------------------------------------------------------------------
create table if not exists guilds (
  guild_id          text primary key,
  prefix            text not null default '!',
  mute_role_id      text,
  language          text not null default 'en',
  bot_nickname      text,
  bot_avatar_url    text,
  bot_banner_url    text,
  bot_description   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Older databases created before bot_nickname/bot_avatar_url existed.
alter table guilds add column if not exists bot_nickname text;
alter table guilds add column if not exists bot_avatar_url text;
alter table guilds add column if not exists bot_banner_url text;
alter table guilds add column if not exists bot_description text;
alter table guilds add column if not exists invites_paused_until timestamptz;

-- Named sets of roles for /role group give|take <name> <member> — bulk-assign/remove several
-- roles at once instead of listing them out every time.
create table if not exists role_groups (
  guild_id   text not null references guilds(guild_id) on delete cascade,
  name       text not null,
  role_ids   text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (guild_id, name)
);
alter table role_groups enable row level security;

-- Sanctions are logged via the 'sanctions' category of the /logs system (log_entries/log_webhooks)
-- instead of a single fixed channel, so this column from an earlier design is no longer used.
alter table guilds drop column if exists mod_log_channel_id;

alter table guilds enable row level security;

-- ---------------------------------------------------------------------------
-- mod_actions: the numbered case log (ban, kick, mute, unmute, unban, warn, ...)
-- ---------------------------------------------------------------------------
create table if not exists mod_actions (
  id            bigserial primary key,
  guild_id      text not null references guilds(guild_id) on delete cascade,
  case_number   integer not null,
  user_id       text not null,
  moderator_id  text not null,
  type          text not null check (type in ('ban', 'unban', 'kick', 'mute', 'unmute', 'tempban', 'tempmute', 'warn', 'softban')),
  reason        text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,
  active        boolean not null default true,
  unique (guild_id, case_number)
);

-- `create table if not exists` above is a no-op against an already-migrated database, so the
-- CHECK constraint (added here for tempban/tempmute/softban) needs its own idempotent migration step.
alter table mod_actions drop constraint if exists mod_actions_type_check;
alter table mod_actions add constraint mod_actions_type_check
  check (type in ('ban', 'unban', 'kick', 'mute', 'unmute', 'tempban', 'tempmute', 'warn', 'softban'));

create index if not exists idx_mod_actions_guild_user on mod_actions(guild_id, user_id);
create index if not exists idx_mod_actions_guild_created on mod_actions(guild_id, created_at desc);
create index if not exists idx_mod_actions_expires on mod_actions(expires_at) where expires_at is not null and active;

alter table mod_actions enable row level security;

-- Atomically allocates the next per-guild case number and inserts the case.
-- Using an advisory lock avoids a race between the "select max()" and the
-- insert when two moderation actions happen in the same guild at once.
create or replace function create_mod_case(
  p_guild_id      text,
  p_user_id       text,
  p_moderator_id  text,
  p_type          text,
  p_reason        text default null,
  p_expires_at    timestamptz default null
) returns mod_actions
language plpgsql
as $$
declare
  v_case_number integer;
  v_row mod_actions;
begin
  perform pg_advisory_xact_lock(hashtext(p_guild_id));

  select coalesce(max(case_number), 0) + 1
    into v_case_number
    from mod_actions
    where guild_id = p_guild_id;

  insert into mod_actions (guild_id, case_number, user_id, moderator_id, type, reason, expires_at)
  values (p_guild_id, v_case_number, p_user_id, p_moderator_id, p_type, p_reason, p_expires_at)
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- warns: dedicated warn history (each warn also creates a mod_actions case)
-- ---------------------------------------------------------------------------
create table if not exists warns (
  id            bigserial primary key,
  guild_id      text not null references guilds(guild_id) on delete cascade,
  case_number   integer,
  user_id       text not null,
  moderator_id  text not null,
  reason        text,
  created_at    timestamptz not null default now(),
  active        boolean not null default true
);

create index if not exists idx_warns_guild_user on warns(guild_id, user_id);

alter table warns enable row level security;

-- ---------------------------------------------------------------------------
-- Audit logging system: per-channel webhooks deliver embeds for 8 event
-- categories (messages/members/roles/channels/invites/emojis/voice/server).
-- Ported from the legacy "bli" bot's src/handlers/logs/* + /log command.
-- ---------------------------------------------------------------------------

-- One webhook per (guild, channel) that log entries for that channel post through.
create table if not exists log_webhooks (
  guild_id      text not null references guilds(guild_id) on delete cascade,
  channel_id    text not null,
  webhook_id    text not null,
  webhook_token text not null,
  created_at    timestamptz not null default now(),
  primary key (guild_id, channel_id)
);

alter table log_webhooks enable row level security;

-- Which event categories are routed to which channel, with an optional per-entry color override.
create table if not exists log_entries (
  guild_id   text not null references guilds(guild_id) on delete cascade,
  channel_id text not null,
  event      text not null check (event in ('messages', 'members', 'roles', 'channels', 'invites', 'emojis', 'voice', 'server', 'sanctions', 'verification', 'automod', 'tickets')),
  color      integer,
  created_at timestamptz not null default now(),
  primary key (guild_id, channel_id, event)
);

-- `create table if not exists` above is a no-op against an already-migrated database, so the
-- CHECK constraint (added here for the 'sanctions'/'verification'/'automod'/'tickets' categories) needs its own idempotent migration step.
alter table log_entries drop constraint if exists log_entries_event_check;
alter table log_entries add constraint log_entries_event_check
  check (event in ('messages', 'members', 'roles', 'channels', 'invites', 'emojis', 'voice', 'server', 'sanctions', 'verification', 'automod', 'tickets'));

create index if not exists idx_log_entries_guild_event on log_entries(guild_id, event);

alter table log_entries enable row level security;

-- User or channel IDs excluded from logging (e.g. a bot's own spam channel, a muted troll).
create table if not exists log_ignored (
  guild_id  text not null references guilds(guild_id) on delete cascade,
  target_id text not null,
  primary key (guild_id, target_id)
);

alter table log_ignored enable row level security;

-- ---------------------------------------------------------------------------
-- notes: non-punitive staff annotations on a user (distinct from mod_actions —
-- a note doesn't get a case number and isn't a sanction, just a record for staff).
-- ---------------------------------------------------------------------------
create table if not exists notes (
  id           bigserial primary key,
  guild_id     text not null references guilds(guild_id) on delete cascade,
  user_id      text not null,
  moderator_id text not null,
  note         text not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_notes_guild_user on notes(guild_id, user_id);

alter table notes enable row level security;

-- ---------------------------------------------------------------------------
-- embed_templates: named, reusable embeds built via /embed (structured fields +
-- an interactive modal panel). `data` mirrors the shape EmbedBuilder expects:
-- { title, description, color, url, thumbnail, image, timestamp, author, footer, fields }.
-- ---------------------------------------------------------------------------
create table if not exists embed_templates (
  id         bigserial primary key,
  guild_id   text not null references guilds(guild_id) on delete cascade,
  name       text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guild_id, name)
);

create index if not exists idx_embed_templates_guild on embed_templates(guild_id);

alter table embed_templates enable row level security;

-- ---------------------------------------------------------------------------
-- verification_config: Cloudflare Turnstile join-gate settings per guild.
-- Verification tokens themselves are stateless (signed + expiring, see
-- src/utils/verifyToken.js) — nothing about an in-flight verification is stored.
-- ---------------------------------------------------------------------------
create table if not exists verification_config (
  guild_id           text primary key references guilds(guild_id) on delete cascade,
  enabled            boolean not null default false,
  unverified_role_id text,
  verified_role_id   text,
  updated_at         timestamptz not null default now()
);

alter table verification_config enable row level security;

-- One row per redeemed magic-link token (jti = the token's unique id, embedded
-- in its signed payload). Tokens are otherwise stateless — this table exists
-- solely to make a link single-use: redeeming it twice is rejected once its
-- jti shows up here, even though the signature itself would still be valid
-- until the token's own expiry.
create table if not exists verification_redemptions (
  jti         text primary key,
  guild_id    text not null references guilds(guild_id) on delete cascade,
  user_id     text not null,
  redeemed_at timestamptz not null default now()
);

alter table verification_redemptions enable row level security;

-- ---------------------------------------------------------------------------
-- Automod: word filter / anti-spam / anti-raid, all detected locally (regex,
-- in-memory join/message tracking) — no per-message external API calls.
-- ---------------------------------------------------------------------------
create table if not exists automod_config (
  guild_id              text primary key references guilds(guild_id) on delete cascade,
  word_filter_enabled   boolean not null default false,
  word_filter_action    text not null default 'warn' check (word_filter_action in ('warn', 'mute', 'kick', 'delete')),
  banned_words          text[] not null default '{}',
  anti_spam_enabled     boolean not null default false,
  max_mentions          integer not null default 5,
  allowed_invite_codes  text[] not null default '{}',
  anti_raid_enabled     boolean not null default false,
  raid_join_threshold   integer not null default 6,
  raid_window_seconds   integer not null default 10,
  raid_action           text not null default 'alert' check (raid_action in ('alert', 'kick')),
  -- Roles that bypass the word filter / anti-spam checks above entirely.
  immune_role_ids       text[] not null default '{}',
  -- New-account detection on join.
  anti_alt_enabled      boolean not null default false,
  anti_alt_min_age_days integer not null default 7,
  anti_alt_action       text not null default 'kick' check (anti_alt_action in ('kick', 'flag')),
  updated_at            timestamptz not null default now()
);

-- `create table if not exists` is a no-op against an already-migrated database, so columns
-- added after the first release of this table need their own idempotent migration step.
alter table automod_config add column if not exists word_filter_action text not null default 'warn';
alter table automod_config drop constraint if exists automod_config_word_filter_action_check;
alter table automod_config add constraint automod_config_word_filter_action_check check (word_filter_action in ('warn', 'mute', 'kick', 'delete'));
alter table automod_config add column if not exists immune_role_ids text[] not null default '{}';
alter table automod_config add column if not exists anti_alt_enabled boolean not null default false;
alter table automod_config add column if not exists anti_alt_min_age_days integer not null default 7;
alter table automod_config add column if not exists anti_alt_action text not null default 'kick';
alter table automod_config drop constraint if exists automod_config_anti_alt_action_check;
alter table automod_config add constraint automod_config_anti_alt_action_check check (anti_alt_action in ('kick', 'flag'));

alter table automod_config enable row level security;

-- Channels where ANY message is treated as a violation (e.g. an announcements-only
-- channel) — independent of the word filter / anti-spam toggles above.
create table if not exists automod_silent_channels (
  guild_id   text not null references guilds(guild_id) on delete cascade,
  channel_id text not null,
  action     text not null default 'warn' check (action in ('warn', 'mute', 'kick')),
  created_at timestamptz not null default now(),
  primary key (guild_id, channel_id)
);

alter table automod_silent_channels enable row level security;

-- ---------------------------------------------------------------------------
-- Anti-nuke: detects a single executor (compromised staff account or malicious
-- bot) performing a burst of destructive actions (bans, channel deletes, role
-- deletes) and responds automatically — quarantine (strip roles) for a human,
-- ban for a bot. The guild owner and any whitelisted id are never auto-actioned.
-- ---------------------------------------------------------------------------
create table if not exists antinuke_config (
  guild_id         text primary key references guilds(guild_id) on delete cascade,
  enabled          boolean not null default false,
  action_threshold integer not null default 5,
  window_seconds   integer not null default 10,
  whitelist_ids    text[] not null default '{}',
  updated_at       timestamptz not null default now()
);

alter table antinuke_config enable row level security;

-- ---------------------------------------------------------------------------
-- warn_escalation_rules: "at warning #N, do X automatically" — checked against
-- the user's live active-warn count every time a warn is added (manual or automod).
-- ---------------------------------------------------------------------------
create table if not exists warn_escalation_rules (
  guild_id    text not null references guilds(guild_id) on delete cascade,
  warn_count  integer not null check (warn_count > 0),
  action      text not null check (action in ('mute', 'tempmute', 'kick', 'ban')),
  duration_ms bigint,
  primary key (guild_id, warn_count)
);

alter table warn_escalation_rules enable row level security;

-- ---------------------------------------------------------------------------
-- report_config: destination channel for member-submitted reports (both the
-- /report slash command and the "Report Message" context-menu command).
-- ---------------------------------------------------------------------------
create table if not exists report_config (
  guild_id   text primary key references guilds(guild_id) on delete cascade,
  channel_id text,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table report_config enable row level security;

-- ---------------------------------------------------------------------------
-- Ticket system: panels (the message members click), categories (a panel's
-- buttons/options, each with its own support roles + parent channel category +
-- optional /embed welcome message), and tickets (one row per opened ticket,
-- guild-wide sequential numbering via create_ticket(), same advisory-lock
-- pattern as create_mod_case()). Panel/category embeds can point at a saved
-- embed_templates row by name, so /embed and /ticket share the same content.
-- ---------------------------------------------------------------------------
create table if not exists ticket_panels (
  id             bigserial primary key,
  guild_id       text not null references guilds(guild_id) on delete cascade,
  channel_id     text not null,
  message_id     text,
  title          text,
  description    text,
  embed_template text,
  style          text not null default 'button' check (style in ('button', 'select')),
  created_at     timestamptz not null default now()
);

create index if not exists idx_ticket_panels_guild on ticket_panels(guild_id);

alter table ticket_panels enable row level security;

create table if not exists ticket_categories (
  id                     bigserial primary key,
  guild_id               text not null references guilds(guild_id) on delete cascade,
  panel_id               bigint references ticket_panels(id) on delete set null,
  key                    text not null,
  label                  text not null,
  emoji                  text,
  button_style           text not null default 'primary' check (button_style in ('primary', 'secondary', 'success', 'danger')),
  description            text,
  parent_channel_id      text,
  support_role_ids       text[] not null default '{}',
  ping_role_ids          text[] not null default '{}',
  welcome_embed_template text,
  naming_pattern         text not null default 'ticket-{number}',
  max_open_per_user      integer not null default 1,
  created_at             timestamptz not null default now(),
  unique (guild_id, key)
);

create index if not exists idx_ticket_categories_guild on ticket_categories(guild_id);
create index if not exists idx_ticket_categories_panel on ticket_categories(panel_id);

alter table ticket_categories enable row level security;

create table if not exists tickets (
  id            bigserial primary key,
  guild_id      text not null references guilds(guild_id) on delete cascade,
  ticket_number integer not null,
  category_id   bigint not null references ticket_categories(id) on delete cascade,
  channel_id    text,
  opener_id     text not null,
  claimed_by    text,
  status        text not null default 'open' check (status in ('open', 'closed')),
  close_reason  text,
  closed_by     text,
  created_at    timestamptz not null default now(),
  closed_at     timestamptz,
  -- Full rendered transcript HTML (see utils/ticketTranscript.js), persisted so the web transcript
  -- viewer can serve it even after the ticket channel itself has been deleted.
  transcript_html text,
  unique (guild_id, ticket_number)
);

create index if not exists idx_tickets_guild_status on tickets(guild_id, status);
create index if not exists idx_tickets_channel on tickets(channel_id);
create index if not exists idx_tickets_guild_opener on tickets(guild_id, opener_id);

-- `create table if not exists` above is a no-op against an already-migrated database.
alter table tickets add column if not exists transcript_html text;
alter table tickets add column if not exists staff_message_count integer not null default 0;
alter table tickets add column if not exists last_activity_at timestamptz not null default now();

alter table tickets enable row level security;

-- Guild-wide ticket behavior (one row per guild), separate from per-category config in
-- ticket_categories: claim rules, close rules, autoclose, and post-close ratings.
create table if not exists ticket_settings (
  guild_id                      text primary key references guilds(guild_id) on delete cascade,
  claim_mode                    text not null default 'shared' check (claim_mode in ('shared', 'exclusive')),
  ping_on_claim                 boolean not null default false,
  roles_to_add_on_claim         text[] not null default '{}',
  close_requires_support_role   boolean not null default false,
  close_requires_reason         boolean not null default false,
  hide_closing_user             boolean not null default false,
  dm_user_on_close              boolean not null default true,
  default_close_reason          text,
  log_staff_message_counts      boolean not null default false,
  autoclose_leave               boolean not null default false,
  autoclose_inactivity_enabled  boolean not null default false,
  autoclose_inactivity_hours    integer not null default 168,
  rating_enabled                boolean not null default false,
  rating_mode                   text not null default 'rating_only' check (rating_mode in ('rating_only', 'rating_comment')),
  rating_log_channel_id         text,
  opened_log_channel_id         text,
  closed_log_channel_id         text,
  blocked_role_ids              text[] not null default '{}',
  updated_at                    timestamptz not null default now()
);

alter table ticket_settings enable row level security;

create table if not exists ticket_ratings (
  id         bigserial primary key,
  guild_id   text not null references guilds(guild_id) on delete cascade,
  ticket_id  bigint not null references tickets(id) on delete cascade,
  user_id    text not null,
  rating     integer not null check (rating between 1 and 5),
  comment    text,
  created_at timestamptz not null default now(),
  unique (ticket_id)
);

create index if not exists idx_ticket_ratings_guild on ticket_ratings(guild_id);

alter table ticket_ratings enable row level security;

-- ---------------------------------------------------------------------------
-- member_events_config: welcome / leave / boost announcement messages.
-- Ported from "bli" (WelcomeSettings) and "urubot" (bienvenidas.js), ideas from
-- both merged: each trigger can use plain text (variables resolved via
-- utils/embedVariables.js, same engine /embed uses) or point at a saved
-- /embed template by name, same integration pattern as ticket categories.
--
-- Boost fires per Discord's own MessageType.GuildBoost system message (one per
-- individual boost, not just "started boosting" — a member can apply more than
-- one boost, and this catches every one of them, not just the first), matching
-- urubot's approach; boost_level_* fires separately on GuildBoostTier1/2/3
-- (the server reaching a new boost tier), an occasional, more notable event.
-- ---------------------------------------------------------------------------
create table if not exists member_events_config (
  guild_id                   text primary key references guilds(guild_id) on delete cascade,
  welcome_channel_id         text,
  welcome_message            text,
  welcome_embed_template     text,
  leave_channel_id           text,
  leave_message              text,
  leave_embed_template       text,
  boost_channel_id           text,
  boost_message              text,
  boost_embed_template       text,
  boost_level_message        text,
  boost_level_embed_template text,
  updated_at                 timestamptz not null default now()
);

alter table member_events_config enable row level security;

-- ---------------------------------------------------------------------------
-- bump_reminders: reminds the server to /bump again (DISBOARD) after the
-- cooldown, with an optional thank-you message, channel autolock between
-- bumps, and autoclean of chatter in the bump channel. Ported from "bli".
-- ---------------------------------------------------------------------------
create table if not exists bump_reminders (
  guild_id      text primary key references guilds(guild_id) on delete cascade,
  channel_id    text,
  message       text not null default 'It''s time to **/bump** the server!',
  thankyou      text not null default '{user.mention} successfully bumped! Bump again {nextBump}.',
  pingable      boolean not null default false,
  autolock      boolean not null default false,
  autoclean     boolean not null default false,
  next_bump_at  timestamptz,
  last_bumper_id text,
  updated_at    timestamptz not null default now()
);

alter table bump_reminders enable row level security;

-- Atomically allocates the next guild-wide ticket number, same advisory-lock
-- technique as create_mod_case() (different lock key so the two features never
-- contend with each other), and inserts the ticket row without a channel_id yet
-- — the caller creates the Discord channel next, then fills channel_id in.
create or replace function create_ticket(
  p_guild_id     text,
  p_category_id  bigint,
  p_opener_id    text
) returns tickets
language plpgsql
as $$
declare
  v_number integer;
  v_row tickets;
begin
  perform pg_advisory_xact_lock(hashtext(p_guild_id || ':ticket'));

  select coalesce(max(ticket_number), 0) + 1
    into v_number
    from tickets
    where guild_id = p_guild_id;

  insert into tickets (guild_id, ticket_number, category_id, opener_id)
  values (p_guild_id, v_number, p_category_id, p_opener_id)
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Booster roles: a custom, self-colored role each Nitro booster can create for
-- themselves (color/name/icon, optionally shared with other members) — ported
-- from "bli"'s boosterrole.js/BoosterRole/BoosterRoleConfig, with one addition
-- the user asked for: admins can directly create/edit/remove ANY member's
-- booster role too (bli only ever let the booster themselves touch it).
-- ---------------------------------------------------------------------------
create table if not exists booster_roles (
  id                 bigserial primary key,
  guild_id           text not null references guilds(guild_id) on delete cascade,
  user_id            text not null,
  role_id            text not null,
  color              text,
  color2             text,
  shared_with        text[] not null default '{}',
  color_cooldown_at  timestamptz,
  icon_cooldown_at   timestamptz,
  rename_cooldown_at timestamptz,
  created_at         timestamptz not null default now(),
  unique (guild_id, user_id)
);

create index if not exists idx_booster_roles_guild on booster_roles(guild_id);

alter table booster_roles enable row level security;

create table if not exists booster_role_config (
  guild_id            text primary key references guilds(guild_id) on delete cascade,
  base_role_id        text,
  role_limit          integer not null default 1,
  share_max           integer not null default 0,
  filtered_words      text[] not null default '{}',
  color_cooldown_ms   bigint not null default 0,
  icon_cooldown_ms    bigint not null default 0,
  rename_cooldown_ms  bigint not null default 0,
  updated_at          timestamptz not null default now()
);

alter table booster_role_config enable row level security;

-- ---------------------------------------------------------------------------
-- Leveling / XP / rank / leaderboard. Ported from "bli" (LevelConfig/LevelUser,
-- the a*x^3+b*x^2+c*x XP curve, the embed-style rank/leaderboard — no image
-- rank card) and "urubot" (_config.js's actual admin surface: rates, rewards,
-- multipliers, ignored channels, notify alerts, join bonus, manual xp/level
-- management, role_mode) — bli defined a very configurable schema but never
-- actually exposed most of it through a command; this ports the schema AND
-- builds the admin commands bli was missing, which is the whole point of
-- "super configurable" here.
-- ---------------------------------------------------------------------------
create table if not exists level_config (
  guild_id           text primary key references guilds(guild_id) on delete cascade,
  enabled            boolean not null default false,
  xp_min             integer not null default 15,
  xp_max             integer not null default 25,
  xp_per_vc_minute   integer not null default 5,
  cooldown_seconds   integer not null default 60,
  -- XP curve: totalXpForLevel(level) = round((a*level^3 + b*level^2 + c*level) * difficulty / rounding) * rounding
  curve_a            numeric not null default 1,
  curve_b            numeric not null default 50,
  curve_c            numeric not null default 100,
  difficulty         numeric not null default 2.5,
  rounding           integer not null default 50,
  max_level          integer not null default 1000,
  notify_mode        text not null default 'reply' check (notify_mode in ('off', 'reply', 'channel', 'dm')),
  notify_channel_id  text,
  notify_message     text not null default '{EMOJI} {user} just leveled up to **{level}**!',
  notify_embed       boolean not null default false,
  notify_every       integer not null default 1,
  role_mode          text not null default 'highest' check (role_mode in ('highest', 'all')),
  ignored_channel_ids text[] not null default '{}',
  join_xp            integer not null default 0,
  join_level         integer not null default 0,
  updated_at         timestamptz not null default now()
);

alter table level_config enable row level security;

create table if not exists level_users (
  guild_id   text not null references guilds(guild_id) on delete cascade,
  user_id    text not null,
  xp         bigint not null default 0,
  level      integer not null default 0,
  messages   bigint not null default 0,
  vc_minutes bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);

create index if not exists idx_level_users_leaderboard on level_users(guild_id, xp desc);

alter table level_users enable row level security;

create table if not exists level_rewards (
  guild_id text not null references guilds(guild_id) on delete cascade,
  level    integer not null check (level > 0),
  role_id  text not null,
  primary key (guild_id, level)
);

alter table level_rewards enable row level security;

create table if not exists level_multipliers (
  guild_id    text not null references guilds(guild_id) on delete cascade,
  target_id   text not null,
  target_type text not null check (target_type in ('role', 'channel')),
  multiplier  numeric not null check (multiplier >= 0),
  primary key (guild_id, target_id)
);

alter table level_multipliers enable row level security;

-- Atomically upserts + increments a user's XP/message/vc counters in one round
-- trip (plain UPDATE ... SET xp = xp + n is already row-atomic in Postgres —
-- this just avoids a separate read-then-write for the insert-if-missing case).
create or replace function add_level_xp(
  p_guild_id    text,
  p_user_id     text,
  p_xp_gain     bigint,
  p_message_inc bigint default 0,
  p_vc_inc      bigint default 0
) returns level_users
language plpgsql
as $$
declare
  v_row level_users;
begin
  insert into level_users (guild_id, user_id, xp, messages, vc_minutes)
  values (p_guild_id, p_user_id, p_xp_gain, p_message_inc, p_vc_inc)
  on conflict (guild_id, user_id) do update
    set xp = level_users.xp + excluded.xp,
        messages = level_users.messages + excluded.messages,
        vc_minutes = level_users.vc_minutes + excluded.vc_minutes,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- The rest of this file ports the remaining standalone systems from "bli":
-- AFK, autoresponder, sticky messages, ping-on-join. DM-on-join reuses the
-- existing member_events_config table (two new columns) plus utils/
-- memberEventMessage.js's sendMemberEvent() instead of a new table. "steal"
-- and "disable command" need no schema at all (steal is a stateless action;
-- disabled_commands is its own small table below).
-- ---------------------------------------------------------------------------

create table if not exists afk_status (
  guild_id text not null references guilds(guild_id) on delete cascade,
  user_id  text not null,
  reason   text not null default 'AFK',
  set_at   timestamptz not null default now(),
  primary key (guild_id, user_id)
);

alter table afk_status enable row level security;

-- No TTL/cleanup job — read queries filter to the last 3 days themselves,
-- same "don't bother expiring old rows" precedent as verification_redemptions.
create table if not exists afk_mentions (
  id           bigserial primary key,
  guild_id     text not null references guilds(guild_id) on delete cascade,
  afk_user_id  text not null,
  mentioned_by text not null,
  channel_id   text not null,
  message_link text,
  content      text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_afk_mentions_lookup on afk_mentions(guild_id, afk_user_id, created_at desc);

alter table afk_mentions enable row level security;

create table if not exists auto_responders (
  id             bigserial primary key,
  guild_id       text not null references guilds(guild_id) on delete cascade,
  ar_id          text not null,
  trigger        text not null,
  reply          text not null,
  match_mode     text not null default 'contains' check (match_mode in ('contains', 'startsWith', 'endsWith', 'exact', 'regex')),
  reply_type     text not null default 'text' check (reply_type in ('text', 'embed')),
  delete_trigger boolean not null default false,
  channel_ids    text[] not null default '{}',
  embed_title    text,
  embed_color    integer,
  embed_footer   text,
  embed_template text,
  created_at     timestamptz not null default now(),
  unique (guild_id, ar_id)
);

create index if not exists idx_auto_responders_guild on auto_responders(guild_id);
alter table auto_responders add column if not exists embed_template text;
alter table auto_responders add column if not exists reply_to_trigger boolean not null default false;
alter table auto_responders add column if not exists role_ids text[] not null default '{}';
alter table auto_responders add column if not exists ping_user boolean not null default false;

alter table auto_responders enable row level security;

create table if not exists sticky_messages (
  guild_id   text not null references guilds(guild_id) on delete cascade,
  channel_id text not null,
  message_id text,
  content    text not null,
  primary key (guild_id, channel_id)
);

alter table sticky_messages enable row level security;

create table if not exists sticky_roles_config (
  guild_id text primary key references guilds(guild_id) on delete cascade,
  enabled  boolean not null default false
);

alter table sticky_roles_config enable row level security;

-- One row per member who's left while sticky roles was on, consumed (deleted) the moment
-- they rejoin and their roles are restored, or ignored/dropped once stale (see MAX_AGE_MS
-- in guildMemberAddStickyRoles.js) so a years-old snapshot can't hand back a role setup
-- nobody remembers granting.
create table if not exists sticky_role_snapshots (
  guild_id text not null references guilds(guild_id) on delete cascade,
  user_id  text not null,
  role_ids text[] not null default '{}',
  left_at  timestamptz not null default now(),
  primary key (guild_id, user_id)
);

alter table sticky_role_snapshots enable row level security;

create table if not exists poj_config (
  guild_id text primary key references guilds(guild_id) on delete cascade,
  enabled  boolean not null default true
);

alter table poj_config enable row level security;

create table if not exists poj_channels (
  guild_id        text not null references guilds(guild_id) on delete cascade,
  channel_id      text not null,
  delete_after_ms integer not null default 5000,
  primary key (guild_id, channel_id)
);

alter table poj_channels enable row level security;

create table if not exists disabled_commands (
  id         bigserial primary key,
  guild_id   text not null references guilds(guild_id) on delete cascade,
  command    text not null,
  channel_id text -- null = disabled server-wide
);

create index if not exists idx_disabled_commands_lookup on disabled_commands(guild_id, command);

alter table disabled_commands enable row level security;

-- DM-on-join reuses member_events_config (welcome/leave/boost already live there).
alter table member_events_config add column if not exists dm_join_message text;
alter table member_events_config add column if not exists dm_join_embed_template text;

-- ── Giveaways ──────────────────────────────────────────────────────────────

create table if not exists giveaway_presets (
  id       bigserial primary key,
  guild_id text not null references guilds(guild_id) on delete cascade,
  name     text not null,
  unique (guild_id, name)
);

create index if not exists idx_giveaway_presets_guild on giveaway_presets(guild_id);

alter table giveaway_presets enable row level security;

create table if not exists giveaway_preset_roles (
  preset_id        bigint not null references giveaway_presets(id) on delete cascade,
  role_id          text not null,
  claim_time_ms    integer not null default 0,
  entries          integer not null default 0,
  claim_time_stack boolean not null default false,
  entries_stack    boolean not null default false,
  primary key (preset_id, role_id)
);

alter table giveaway_preset_roles enable row level security;

create table if not exists giveaway_templates (
  id       bigserial primary key,
  guild_id text not null references guilds(guild_id) on delete cascade,
  name     text not null,
  data     jsonb not null default '{}'::jsonb,
  unique (guild_id, name)
);

create index if not exists idx_giveaway_templates_guild on giveaway_templates(guild_id);

alter table giveaway_templates enable row level security;

create table if not exists giveaway_config (
  guild_id               text primary key references guilds(guild_id) on delete cascade,
  embed_template         text,
  reaction               text not null default '🎉',
  entry_mode             text not null default 'button' check (entry_mode in ('reaction', 'button')),
  winner_message         text,
  deny_message           text,
  claim_time_message     text,
  claim_time_over_message text,
  accept_message         text,
  no_entries_message     text
);

alter table giveaway_config enable row level security;

create table if not exists giveaways (
  id             bigserial primary key,
  guild_id       text not null references guilds(guild_id) on delete cascade,
  channel_id     text not null,
  message_id     text,
  host_id        text not null,
  prize          text not null,
  winners_count  integer not null default 1,
  ends_at        timestamptz not null,
  claim_time_ms  integer,
  entry_mode     text not null default 'button' check (entry_mode in ('reaction', 'button')),
  reaction       text not null default '🎉',
  preset_id      bigint references giveaway_presets(id) on delete set null,
  embed_template text,
  ended          boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists idx_giveaways_active on giveaways(ends_at) where not ended;
create index if not exists idx_giveaways_guild on giveaways(guild_id);

alter table giveaways enable row level security;

create table if not exists giveaway_entries (
  giveaway_id bigint not null references giveaways(id) on delete cascade,
  user_id     text not null,
  weight      integer not null default 1,
  entered_at  timestamptz not null default now(),
  primary key (giveaway_id, user_id)
);

alter table giveaway_entries enable row level security;

create table if not exists giveaway_winners (
  id               bigserial primary key,
  giveaway_id      bigint not null references giveaways(id) on delete cascade,
  user_id          text not null,
  status           text not null default 'pending' check (status in ('pending', 'claimed', 'denied', 'expired')),
  claim_expires_at timestamptz,
  won_at           timestamptz not null default now()
);

create index if not exists idx_giveaway_winners_giveaway on giveaway_winners(giveaway_id);
create index if not exists idx_giveaway_winners_claim_pending on giveaway_winners(claim_expires_at) where status = 'pending' and claim_expires_at is not null;

alter table giveaway_winners enable row level security;

-- ── Reaction roles ───────────────────────────────────────────────────────

create table if not exists reaction_roles (
  id         bigserial primary key,
  guild_id   text not null references guilds(guild_id) on delete cascade,
  channel_id text not null,
  message_id text not null,
  emoji      text not null,
  role_id    text not null,
  mode       text not null default 'toggle' check (mode in ('toggle', 'add', 'remove')),
  unique (message_id, emoji)
);

create index if not exists idx_reaction_roles_message on reaction_roles(message_id);
create index if not exists idx_reaction_roles_guild on reaction_roles(guild_id);

alter table reaction_roles enable row level security;

-- ── Custom commands ──────────────────────────────────────────────────────

create table if not exists custom_commands (
  id             bigserial primary key,
  guild_id       text not null references guilds(guild_id) on delete cascade,
  name           text not null,
  response       text,
  embed_template text,
  created_at     timestamptz not null default now(),
  unique (guild_id, name)
);

create index if not exists idx_custom_commands_guild on custom_commands(guild_id);

alter table custom_commands enable row level security;

-- ── Reminders ────────────────────────────────────────────────────────────

create table if not exists reminders (
  id         bigserial primary key,
  guild_id   text not null references guilds(guild_id) on delete cascade,
  channel_id text not null,
  user_id    text not null,
  message    text not null,
  remind_at  timestamptz not null,
  sent       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_reminders_due on reminders(remind_at) where not sent;
create index if not exists idx_reminders_user on reminders(guild_id, user_id) where not sent;

alter table reminders enable row level security;

-- ── Invite tracking ──────────────────────────────────────────────────────

create table if not exists invite_uses (
  guild_id   text not null references guilds(guild_id) on delete cascade,
  inviter_id text not null,
  joins      integer not null default 0,
  leaves     integer not null default 0,
  primary key (guild_id, inviter_id)
);

alter table invite_uses enable row level security;

create table if not exists member_invites (
  guild_id    text not null references guilds(guild_id) on delete cascade,
  user_id     text not null,
  inviter_id  text,
  invite_code text,
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,
  primary key (guild_id, user_id)
);

alter table member_invites enable row level security;

create or replace function increment_invite_stat(p_guild_id text, p_inviter_id text, p_joins_delta integer, p_leaves_delta integer)
returns void as $$
begin
  insert into invite_uses (guild_id, inviter_id, joins, leaves)
  values (p_guild_id, p_inviter_id, greatest(p_joins_delta, 0), greatest(p_leaves_delta, 0))
  on conflict (guild_id, inviter_id) do update
    set joins = invite_uses.joins + excluded.joins,
        leaves = invite_uses.leaves + excluded.leaves;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- bot_status: one row per gateway shard, overwritten on every heartbeat.
-- Read by the marketing site's /status page at build time.
-- ---------------------------------------------------------------------------
create table if not exists bot_status (
  shard_id     integer primary key,
  status       text not null,
  guild_count  integer not null default 0,
  ping_ms      integer,
  updated_at   timestamptz not null default now()
);

alter table bot_status enable row level security;

-- Public read-only: the status page polls this straight from the browser
-- with the anon key, no server round-trip. Nothing in this table is
-- sensitive (just shard health, guild counts, and ping).
drop policy if exists "bot_status_public_read" on bot_status;
create policy "bot_status_public_read" on bot_status for select to anon using (true);

-- ---------------------------------------------------------------------------
-- bot_host: one singleton row with process-level stats (uptime, memory),
-- overwritten on every heartbeat alongside bot_status.
-- ---------------------------------------------------------------------------
create table if not exists bot_host (
  id              integer primary key default 1,
  uptime_seconds  integer not null,
  memory_mb       numeric not null,
  node_version    text,
  updated_at      timestamptz not null default now(),
  constraint bot_host_singleton check (id = 1)
);

alter table bot_host enable row level security;

drop policy if exists "bot_host_public_read" on bot_host;
create policy "bot_host_public_read" on bot_host for select to anon using (true);

-- ---------------------------------------------------------------------------
-- activity_stats: per-guild, per-channel, per-day counters powering the
-- dashboard's activity chart and top-channels tables. Purely observational,
-- no per-guild opt-out (same footprint as the log system, not a behavior
-- change like leveling), grows from whenever this shipped, no backfill.
-- ---------------------------------------------------------------------------
create table if not exists activity_stats (
  guild_id      text not null references guilds(guild_id) on delete cascade,
  channel_id    text not null,
  day           date not null,
  messages      integer not null default 0,
  reactions     integer not null default 0,
  voice_seconds integer not null default 0,
  primary key (guild_id, channel_id, day)
);

create index if not exists idx_activity_stats_guild_day on activity_stats(guild_id, day);

alter table activity_stats enable row level security;

-- Atomic upsert-increment, same idiom as add_level_xp: a plain select-then-write
-- from JS would race under concurrent messages, this does it in one statement.
create or replace function increment_activity_stat(
  p_guild_id           text,
  p_channel_id         text,
  p_day                date,
  p_messages_inc       integer default 0,
  p_reactions_inc      integer default 0,
  p_voice_seconds_inc  integer default 0
) returns void
language plpgsql
as $$
begin
  insert into activity_stats (guild_id, channel_id, day, messages, reactions, voice_seconds)
  values (p_guild_id, p_channel_id, p_day, p_messages_inc, p_reactions_inc, p_voice_seconds_inc)
  on conflict (guild_id, channel_id, day) do update
    set messages = activity_stats.messages + excluded.messages,
        reactions = activity_stats.reactions + excluded.reactions,
        voice_seconds = activity_stats.voice_seconds + excluded.voice_seconds;
end;
$$;

-- Mass role assign/remove across every member matching a set of filters, run once in the
-- background by the bot (not instant, potentially thousands of Discord API calls). Only one
-- pending/running job per guild is enforced in application code, not here.
create table if not exists bulk_role_jobs (
  id                 bigserial primary key,
  guild_id           text not null references guilds(guild_id) on delete cascade,
  action             text not null check (action in ('add', 'remove')),
  target_role_id     text not null,
  member_type        text not null default 'all' check (member_type in ('all', 'bots', 'humans')),
  filter_role_ids    text[] not null default '{}',
  filter_mode        text not null default 'any' check (filter_mode in ('any', 'all')),
  filter_exclude     boolean not null default false,
  joined_before      timestamptz,
  joined_after       timestamptz,
  notify_channel_id  text,
  status             text not null default 'pending' check (status in ('pending', 'running', 'completed', 'cancelled', 'failed')),
  total_members      integer not null default 0,
  processed_members  integer not null default 0,
  success_count      integer not null default 0,
  error_count        integer not null default 0,
  error_message      text,
  started_by         text not null,
  created_at         timestamptz not null default now(),
  finished_at        timestamptz
);

create index if not exists idx_bulk_role_jobs_guild on bulk_role_jobs(guild_id);
create index if not exists idx_bulk_role_jobs_active on bulk_role_jobs(guild_id) where status in ('pending', 'running');

alter table bulk_role_jobs enable row level security;

-- Custom numeric authorization system (0-100), layered on top of Discord's own permissions,
-- not a replacement for them. A "group" is a named bucket of users and/or roles sharing one
-- level. A member's effective level is the highest level among every group they belong to
-- (directly as a user, or via any of their roles), falling back to the guild's base/@everyone
-- group. Server owner and anyone with Administrator always bypass this entirely (checked in
-- code, not stored here) so a misconfigured level can never lock out the people who can fix it.
create table if not exists permission_groups (
  id         bigserial primary key,
  guild_id   text not null references guilds(guild_id) on delete cascade,
  name       text not null,
  level      integer not null default 0 check (level between 0 and 100),
  is_base    boolean not null default false,
  created_at timestamptz not null default now(),
  unique (guild_id, name)
);
create index if not exists idx_permission_groups_guild on permission_groups(guild_id);
alter table permission_groups enable row level security;

create table if not exists permission_group_members (
  id           bigserial primary key,
  group_id     bigint not null references permission_groups(id) on delete cascade,
  subject_type text not null check (subject_type in ('user', 'role')),
  subject_id   text not null,
  unique (group_id, subject_type, subject_id)
);
create index if not exists idx_permission_group_members_group on permission_group_members(group_id);
alter table permission_group_members enable row level security;

-- Required level to run a command, per guild. Commands with no row here default to level 0
-- (open to everyone, same as today, this feature is purely opt-in).
create table if not exists command_permission_levels (
  guild_id       text not null references guilds(guild_id) on delete cascade,
  command_name   text not null,
  required_level integer not null default 0 check (required_level between 0 and 100),
  updated_at     timestamptz not null default now(),
  primary key (guild_id, command_name)
);
alter table command_permission_levels enable row level security;

-- Who changed what in the custom permission system, and when. Nothing enforces anything off
-- this table, it's pure accountability so multiple staff editing levels can see each other's
-- history instead of silently overwriting one another.
create table if not exists permission_audit_log (
  id          bigserial primary key,
  guild_id    text not null references guilds(guild_id) on delete cascade,
  actor_id    text not null,
  actor_name  text not null,
  action      text not null,
  summary     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_permission_audit_log_guild on permission_audit_log(guild_id, created_at desc);
alter table permission_audit_log enable row level security;

-- Simple reputation/karma system (YAGPDB-style /rep): members give each other a point, once
-- per cooldown period, no external infra needed. `last_given_at` tracks when THIS user last
-- gave a point to someone else (their own giving cooldown), separate from `points` (what
-- others have given them) — the same row serves both roles.
create table if not exists reputation_config (
  guild_id       text primary key references guilds(guild_id) on delete cascade,
  enabled        boolean not null default true,
  cooldown_hours integer not null default 24 check (cooldown_hours >= 0)
);
alter table reputation_config enable row level security;

create table if not exists reputation (
  guild_id      text not null references guilds(guild_id) on delete cascade,
  user_id       text not null,
  points        integer not null default 0,
  last_given_at timestamptz,
  primary key (guild_id, user_id)
);
create index if not exists idx_reputation_guild_points on reputation(guild_id, points desc);
alter table reputation enable row level security;

-- /poll: a button-voted poll. `options` is the ordered list of choice labels; a user's vote is
-- their chosen index into that array. One row in poll_votes per (poll, user) so re-voting just
-- changes their choice instead of stacking votes.
create table if not exists polls (
  id           bigserial primary key,
  guild_id     text not null references guilds(guild_id) on delete cascade,
  channel_id   text not null,
  message_id   text not null,
  creator_id   text not null,
  question     text not null,
  options      jsonb not null,
  image        text,
  multi        boolean not null default false,
  ends_at      timestamptz,
  closed       boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists idx_polls_message on polls(message_id);
alter table polls enable row level security;
alter table polls add column if not exists image text;

create table if not exists poll_votes (
  poll_id  bigint not null references polls(id) on delete cascade,
  user_id  text not null,
  choices  integer[] not null,
  voted_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);
alter table poll_votes enable row level security;
