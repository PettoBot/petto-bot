-- Petto bot schema
-- Apply this schema to Petto's Discloud PostgreSQL database with psql.
-- The bot uses its private database connection and the dashboard API applies
-- its own request authentication and rate limiting.

-- ---------------------------------------------------------------------------
-- premium_entitlements / premium_slot_assignments: account-level Premium
-- ---------------------------------------------------------------------------
-- Premium belongs to the Discord user who owns the subscription. A user can
-- spend the slots included in that entitlement on the servers they manage.
-- There is deliberately no free-plan row: absence of an active entitlement
-- means Free, so a billing outage can never accidentally unlock Premium.
create table if not exists premium_entitlements (
  id                       bigserial primary key,
  user_id                  text not null,
  provider                 text not null default 'discord',
  provider_subscription_id text unique,
  plan_key                 text not null default 'premium-1',
  status                   text not null default 'pending' check (status in ('pending', 'active', 'past_due', 'canceled', 'expired')),
  slot_limit               integer not null default 0 check (slot_limit >= 0 and slot_limit <= 1000),
  current_period_end       timestamptz,
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_premium_entitlements_user on premium_entitlements(user_id);
create index if not exists idx_premium_entitlements_active on premium_entitlements(user_id, status) where status = 'active';
create index if not exists idx_premium_entitlements_updated_id on premium_entitlements(updated_at desc, id desc) where user_id is not null;
alter table premium_entitlements enable row level security;

-- A guild can only have one active Premium owner at a time. Reassigning a
-- slot is an explicit dashboard action and keeps the old row as history.
create table if not exists premium_slot_assignments (
  id             bigserial primary key,
  entitlement_id bigint not null references premium_entitlements(id) on delete cascade,
  user_id        text not null,
  guild_id       text not null,
  status         text not null default 'active' check (status in ('active', 'released')),
  assigned_at    timestamptz not null default now(),
  released_at    timestamptz,
  unique (entitlement_id, guild_id)
);

create unique index if not exists idx_premium_one_active_owner_per_guild
  on premium_slot_assignments(guild_id) where status = 'active';
create index if not exists idx_premium_assignments_user on premium_slot_assignments(user_id, status);
create index if not exists idx_premium_assignments_guild on premium_slot_assignments(guild_id, status);
alter table premium_slot_assignments enable row level security;

-- Before billing is connected, this table lets a user select the servers they
-- want Premium on without pretending that a payment happened. Requests are
-- harmless and can be removed once Discord entitlements are live.
create table if not exists premium_slot_requests (
  id           bigserial primary key,
  user_id      text not null,
  guild_id     text not null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'canceled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, guild_id)
);

create index if not exists idx_premium_requests_user on premium_slot_requests(user_id, status);
alter table premium_slot_requests enable row level security;

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
  setup_channel_id  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Older databases created before bot_nickname/bot_avatar_url existed.
alter table guilds add column if not exists bot_nickname text;
alter table guilds add column if not exists bot_avatar_url text;
alter table guilds add column if not exists bot_banner_url text;
alter table guilds add column if not exists bot_description text;
-- The Premium display name style of the bot in this server: { fontId, effectId, colors: [decimal, ...] }.
alter table guilds add column if not exists bot_name_style jsonb;
alter table guilds add column if not exists setup_channel_id text;
alter table guilds add column if not exists invites_paused_until timestamptz;
alter table guilds add column if not exists compliance_ignored boolean not null default false;
alter table guilds add column if not exists compliance_ignored_by text;
alter table guilds add column if not exists compliance_ignored_at timestamptz;
alter table guilds add column if not exists compliance_ignore_reason text;

-- Persistent compliance signal summary. This stores only the latest actionable
-- server-level signal; raw message evidence remains transient and is never stored.
create table if not exists guild_compliance_scores (
  guild_id            text primary key references guilds(guild_id) on delete cascade,
  score               integer not null default 0 check (score between 0 and 16),
  confidence          text not null default 'low',
  actionable          boolean not null default false,
  labels              jsonb not null default '[]'::jsonb,
  families            jsonb not null default '[]'::jsonb,
  first_detected_at   timestamptz not null default now(),
  last_detected_at    timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_guild_compliance_scores_score on guild_compliance_scores (score desc, last_detected_at desc);
alter table guild_compliance_scores enable row level security;

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

-- Roles automatically given to new members on join. `target` lets a row apply to everyone,
-- humans only, or bots only, so one server can have e.g. a human-only "Member" role and a
-- separate bot-only "Bots" role without needing two different features.
create table if not exists join_roles (
  guild_id   text not null references guilds(guild_id) on delete cascade,
  role_id    text not null,
  target     text not null default 'all' check (target in ('all', 'humans', 'bots')),
  created_at timestamptz not null default now(),
  primary key (guild_id, role_id)
);
alter table join_roles enable row level security;

-- Auto-creates a thread off every new message in a configured channel, optionally posting a
-- starter message inside it (same {variable}/{reactreply:} text as welcome/leave/boost).
create table if not exists auto_threads (
  guild_id       text not null references guilds(guild_id) on delete cascade,
  channel_id     text not null,
  name_template  text not null default '{user_name}',
  message_text   text,
  embed_template text,
  archive_minutes integer not null default 60 check (archive_minutes in (60, 1440, 4320, 10080)),
  created_at     timestamptz not null default now(),
  primary key (guild_id, channel_id)
);
alter table auto_threads enable row level security;

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
  type          text not null check (type in ('ban', 'unban', 'kick', 'mute', 'unmute', 'tempban', 'tempmute', 'warn', 'softban', 'jail', 'unjail')),
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
  check (type in ('ban', 'unban', 'kick', 'mute', 'unmute', 'tempban', 'tempmute', 'warn', 'softban', 'jail', 'unjail'));

create index if not exists idx_mod_actions_guild_user on mod_actions(guild_id, user_id);
create index if not exists idx_mod_actions_guild_created on mod_actions(guild_id, created_at desc);
create index if not exists idx_mod_actions_expires on mod_actions(expires_at) where expires_at is not null and active;

alter table mod_actions enable row level security;

-- Jail: a restricted role plus a channel to talk to staff. Jailing saves the member's roles so they can be
-- restored on release, and the row is written before any role changes so a crash never loses them.
create table if not exists jail_config (
  guild_id         text primary key references guilds(guild_id) on delete cascade,
  jail_role_id     text,
  jail_channel_id  text,
  updated_at       timestamptz not null default now()
);

alter table jail_config enable row level security;

create table if not exists jailed_members (
  guild_id        text not null references guilds(guild_id) on delete cascade,
  user_id         text not null,
  case_number     integer,
  saved_role_ids  text[] not null default '{}',
  jailed_by       text not null,
  reason          text,
  jailed_at       timestamptz not null default now(),
  expires_at      timestamptz,
  primary key (guild_id, user_id)
);

create index if not exists idx_jailed_members_expires on jailed_members(expires_at) where expires_at is not null;

alter table jailed_members enable row level security;

-- Durable per-server case counters. The counter survives case deletion, so deleting
-- the latest case never causes its number to be reused.
create table if not exists guild_case_counters (
  guild_id          text primary key references guilds(guild_id) on delete cascade,
  last_case_number  integer not null default 0 check (last_case_number >= 0)
);

alter table guild_case_counters enable row level security;

-- Atomically allocates the next case number for this guild and inserts the case.
-- The MAX() guard only repairs a missing/stale counter; normal numbering comes
-- from guild_case_counters and therefore never mixes numbers between servers.
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

  insert into guild_case_counters (guild_id, last_case_number)
  values (p_guild_id, 0)
  on conflict (guild_id) do nothing;

  update guild_case_counters
     set last_case_number = greatest(
       last_case_number,
       coalesce((select max(case_number) from mod_actions where guild_id = p_guild_id), 0)
     ) + 1
   where guild_id = p_guild_id
   returning last_case_number into v_case_number;

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
  event      text not null check (event in ('messages', 'members', 'roles', 'channels', 'invites', 'emojis', 'voice', 'server', 'sanctions', 'verification', 'automod', 'tickets', 'webhooks', 'threads', 'integrations', 'commands')),
  color      integer,
  created_at timestamptz not null default now(),
  primary key (guild_id, channel_id, event)
);

-- `create table if not exists` above is a no-op against an already-migrated database, so the
-- CHECK constraint (added here for the 'sanctions'/'verification'/'automod'/'tickets' categories) needs its own idempotent migration step.
alter table log_entries drop constraint if exists log_entries_event_check;
alter table log_entries add constraint log_entries_event_check
  check (event in ('messages', 'members', 'roles', 'channels', 'invites', 'emojis', 'voice', 'server', 'sanctions', 'verification', 'automod', 'tickets', 'webhooks', 'threads', 'integrations', 'commands'));

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
-- image_cards: pictures drawn for a message (welcome, tickets, ...). `data` is the card
-- described in src/utils/cardSchema.js. A message template points at a card by name.
-- card_assets: pictures uploaded for cards (backgrounds and layers), kept as bytes
-- after being decoded and written again, so what is stored is always a clean PNG, JPEG or WebP.
-- ---------------------------------------------------------------------------
create table if not exists image_cards (
  id         bigserial primary key,
  guild_id   text not null references guilds(guild_id) on delete cascade,
  name       text not null,
  data       jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guild_id, name)
);

create index if not exists idx_image_cards_guild on image_cards(guild_id);

alter table image_cards enable row level security;

create table if not exists card_assets (
  id         bigserial primary key,
  guild_id   text not null references guilds(guild_id) on delete cascade,
  name       text not null,
  mime       text not null,
  width      integer not null,
  height     integer not null,
  size       integer not null,
  bytes      bytea not null,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_card_assets_guild on card_assets(guild_id);

alter table card_assets enable row level security;

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

-- Global malicious-link cache populated by scheduled threat-feed imports and
-- explicit !am link checks. Ordinary messages query this local table/cache and
-- never call an external reputation service.
create table if not exists malicious_links (
  normalized_url       text primary key,
  hostname             text not null,
  threat_types         text[] not null default '{}',
  source               text not null default 'public_threat_feeds',
  reported_by          text,
  first_seen_guild_id  text,
  first_seen_channel_id text,
  first_seen_at        timestamptz not null default now(),
  last_checked_at      timestamptz not null default now(),
  dev_alerted_at       timestamptz
);

create index if not exists malicious_links_hostname_idx on malicious_links (hostname);
alter table malicious_links enable row level security;

-- Honeypot bait channels. A message in one of these channels is treated as a
-- security violation and the configured punishment is applied automatically.
create table if not exists honeypots (
  guild_id       text not null references guilds(guild_id) on delete cascade,
  channel_id     text not null,
  punishment     text not null default 'softban' check (punishment in ('ban', 'softban', 'kick')),
  panel_message_id text,
  -- Number of unique members whose first Honeypot message was claimed.
  caught_count   integer not null default 0 check (caught_count >= 0),
  -- Legacy message-hit counter retained for existing databases and tooling.
  trigger_count  integer not null default 0 check (trigger_count >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (guild_id, channel_id)
);

alter table honeypots add column if not exists caught_count integer not null default 0;

alter table honeypots enable row level security;

-- One durable claim per member and Honeypot. This prevents a burst of messages
-- from creating repeated sanctions, even across concurrent workers/restarts.
create table if not exists honeypot_user_triggers (
  guild_id   text not null,
  channel_id text not null,
  user_id    text not null,
  message_id text,
  punishment text not null check (punishment in ('ban', 'softban', 'kick')),
  created_at timestamptz not null default now(),
  primary key (guild_id, channel_id, user_id),
  foreign key (guild_id, channel_id)
    references honeypots(guild_id, channel_id) on delete cascade
);

create index if not exists idx_honeypot_user_triggers_guild
  on honeypot_user_triggers(guild_id, created_at desc);

alter table honeypot_user_triggers enable row level security;

create or replace function claim_honeypot_user(
  p_guild_id text,
  p_channel_id text,
  p_user_id text,
  p_message_id text,
  p_punishment text
) returns boolean
language plpgsql
as $$
begin
  insert into honeypot_user_triggers (guild_id, channel_id, user_id, message_id, punishment)
    values (p_guild_id, p_channel_id, p_user_id, p_message_id, p_punishment)
    on conflict (guild_id, channel_id, user_id) do nothing;

  if not found then
    return false;
  end if;

  update honeypots
    set caught_count = caught_count + 1,
        updated_at = now()
    where guild_id = p_guild_id and channel_id = p_channel_id;

  return true;
end;
$$;

-- Keep the counter atomic when multiple spam messages arrive at once.
create or replace function increment_honeypot_trigger(
  p_guild_id text,
  p_channel_id text
) returns honeypots
language plpgsql
as $$
declare
  v_row honeypots;
begin
  update honeypots
    set trigger_count = trigger_count + 1,
        updated_at = now()
    where guild_id = p_guild_id and channel_id = p_channel_id
    returning * into v_row;

  return v_row;
end;
$$;

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

-- Server configuration snapshots. The JSON is deliberately limited to Discord
-- configuration and never contains bot credentials, access tokens, or message content.
create table if not exists guild_backups (
  id             bigserial primary key,
  guild_id       text not null references guilds(guild_id) on delete cascade,
  backup_number  bigint,
  created_by     text not null,
  label          text not null default 'Manual backup',
  source         text not null default 'manual' check (source in ('manual', 'scheduled')),
  snapshot      jsonb not null,
  created_at    timestamptz not null default now()
);

-- `id` is an internal database key. `backup_number` is the number shown to
-- server staff and must start at 1 independently inside each guild.
alter table guild_backups add column if not exists backup_number bigint;
alter table guild_backups add column if not exists source text not null default 'manual';
alter table guild_backups drop constraint if exists guild_backups_source_check;
alter table guild_backups add constraint guild_backups_source_check check (source in ('manual', 'scheduled'));

with numbered as (
  select backups.id,
    coalesce(existing.max_number, 0)
      + row_number() over (partition by backups.guild_id order by backups.created_at asc, backups.id asc) as number
  from guild_backups as backups
  left join (
    select guild_id, max(backup_number) as max_number
    from guild_backups
    group by guild_id
  ) as existing on existing.guild_id = backups.guild_id
  where backups.backup_number is null
)
update guild_backups as backups
set backup_number = numbered.number
from numbered
where backups.id = numbered.id;

alter table guild_backups alter column backup_number set not null;
create unique index if not exists idx_guild_backups_guild_number on guild_backups(guild_id, backup_number);
create index if not exists idx_guild_backups_guild_created on guild_backups(guild_id, created_at desc);
alter table guild_backups enable row level security;

-- Allocate the visible number atomically per guild.
create or replace function create_guild_backup(
  p_guild_id text,
  p_created_by text,
  p_label text,
  p_source text,
  p_snapshot jsonb
) returns guild_backups
language plpgsql
as $$
declare
  v_row guild_backups;
  v_number bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_guild_id, 0));
  select coalesce(max(backup_number), 0) + 1 into v_number
  from guild_backups
  where guild_id = p_guild_id;

  insert into guild_backups (guild_id, backup_number, created_by, label, source, snapshot)
  values (p_guild_id, v_number, p_created_by, coalesce(nullif(p_label, ''), case when p_source = 'scheduled' then 'Scheduled backup' else 'Manual backup' end), p_source, p_snapshot)
  returning * into v_row;

  return v_row;
end;
$$;

create table if not exists guild_backup_audit (
  id             bigserial primary key,
  guild_id       text not null references guilds(guild_id) on delete cascade,
  actor_id       text not null,
  action         text not null,
  backup_number  bigint,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists idx_guild_backup_audit_guild_created on guild_backup_audit(guild_id, created_at desc);
alter table guild_backup_audit enable row level security;

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

-- Jail was added as an escalation action after the first release.
alter table warn_escalation_rules drop constraint if exists warn_escalation_rules_action_check;
alter table warn_escalation_rules add constraint warn_escalation_rules_action_check check (action in ('mute', 'tempmute', 'kick', 'ban', 'jail'));

alter table warn_escalation_rules enable row level security;

-- ---------------------------------------------------------------------------
-- report_config: destination channel for member-submitted reports (both the
-- /report slash command and the "Report Message" context-menu command).
-- ---------------------------------------------------------------------------
create table if not exists report_config (
  guild_id                     text primary key references guilds(guild_id) on delete cascade,
  channel_id                   text,
  enabled                      boolean not null default false,
  anonymous_reporting_enabled  boolean not null default false,
  urgent_role_id               text,
  updated_at                   timestamptz not null default now()
);

alter table report_config add column if not exists anonymous_reporting_enabled boolean not null default false;
alter table report_config add column if not exists urgent_role_id text;

alter table report_config enable row level security;

-- Report system settings added after the first release.
alter table report_config add column if not exists ping_role_id text;
alter table report_config add column if not exists cooldown_seconds integer not null default 60;
alter table report_config add column if not exists daily_limit integer not null default 10;
alter table report_config add column if not exists require_reason boolean not null default false;
alter table report_config add column if not exists notify_reporter boolean not null default true;
alter table report_config add column if not exists auto_thread boolean not null default false;
alter table report_config drop constraint if exists report_config_cooldown_check;
alter table report_config add constraint report_config_cooldown_check check (cooldown_seconds between 0 and 86400);
alter table report_config drop constraint if exists report_config_daily_limit_check;
alter table report_config add constraint report_config_daily_limit_check check (daily_limit between 0 and 100);

-- Members who may not submit reports (abuse of the report channel).
create table if not exists report_blocked_users (
  guild_id    text not null references guilds(guild_id) on delete cascade,
  user_id     text not null,
  blocked_by  text not null,
  reason      text,
  created_at  timestamptz not null default now(),
  primary key (guild_id, user_id)
);

alter table report_blocked_users enable row level security;

-- Every submitted report, numbered per server like moderation cases. The card in the report channel is
-- rebuilt from this row whenever staff claim, resolve or dismiss it.
create table if not exists guild_report_counters (
  guild_id            text primary key references guilds(guild_id) on delete cascade,
  last_report_number  integer not null default 0 check (last_report_number >= 0)
);

alter table guild_report_counters enable row level security;

create table if not exists reports (
  id                 bigserial primary key,
  guild_id           text not null references guilds(guild_id) on delete cascade,
  report_number      integer not null,
  reporter_id        text not null,
  reported_user_id   text not null,
  category           text not null default 'other',
  reason             text,
  source_channel_id  text,
  message_link       text,
  message_content    text,
  image_urls         text[] not null default '{}',
  anonymous          boolean not null default false,
  urgent             boolean not null default false,
  status             text not null default 'open' check (status in ('open', 'claimed', 'resolved', 'dismissed')),
  handled_by         text,
  handled_at         timestamptz,
  report_channel_id  text,
  report_message_id  text,
  created_at         timestamptz not null default now(),
  unique (guild_id, report_number)
);

create index if not exists idx_reports_guild_status on reports(guild_id, status, report_number desc);
create index if not exists idx_reports_guild_reporter on reports(guild_id, reporter_id, created_at desc);
create index if not exists idx_reports_guild_reported on reports(guild_id, reported_user_id);

alter table reports enable row level security;

-- The discussion thread of a report, why staff closed it, and whether the reporter was invited to the thread.
alter table reports add column if not exists thread_id text;
alter table reports add column if not exists resolution_note text;
alter table reports add column if not exists reporter_invited_at timestamptz;
alter table report_config add column if not exists notify_on_claim boolean not null default false;
-- Who reopened a closed report, and why.
alter table reports add column if not exists reopened_by text;
alter table reports add column if not exists reopen_note text;

-- Allocates the next report number for the server and inserts the report in one step. The advisory lock keeps
-- two simultaneous reports from receiving the same number, the same pattern create_mod_case() uses.
create or replace function create_report(
  p_guild_id          text,
  p_reporter_id       text,
  p_reported_user_id  text,
  p_category          text,
  p_reason            text,
  p_source_channel_id text,
  p_message_link      text,
  p_message_content   text,
  p_image_urls        text[],
  p_anonymous         boolean,
  p_urgent            boolean
) returns reports
language plpgsql
as $$
declare
  v_number integer;
  v_row reports;
begin
  perform pg_advisory_xact_lock(hashtext('report:' || p_guild_id));

  insert into guild_report_counters (guild_id, last_report_number)
  values (p_guild_id, 0)
  on conflict (guild_id) do nothing;

  update guild_report_counters
     set last_report_number = greatest(
       last_report_number,
       coalesce((select max(report_number) from reports where guild_id = p_guild_id), 0)
     ) + 1
   where guild_id = p_guild_id
   returning last_report_number into v_number;

  insert into reports (guild_id, report_number, reporter_id, reported_user_id, category, reason, source_channel_id, message_link, message_content, image_urls, anonymous, urgent)
  values (p_guild_id, v_number, p_reporter_id, p_reported_user_id, p_category, p_reason, p_source_channel_id, p_message_link, p_message_content, coalesce(p_image_urls, '{}'), p_anonymous, p_urgent)
  returning * into v_row;

  return v_row;
end;
$$;


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

-- Reusable ticket intake forms. Discord modals support up to five text inputs;
-- the field schema is kept as JSONB so the form can evolve without another table.
create table if not exists ticket_forms (
  id                 bigserial primary key,
  guild_id           text not null references guilds(guild_id) on delete cascade,
  name               text not null,
  title              text not null default 'Ticket details',
  fields             jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (guild_id, name)
);

create index if not exists idx_ticket_forms_guild on ticket_forms(guild_id);

alter table ticket_forms enable row level security;

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
  form_id                bigint references ticket_forms(id) on delete set null,
  required_role_ids      text[] not null default '{}',
  created_at             timestamptz not null default now(),
  unique (guild_id, key)
);

create index if not exists idx_ticket_categories_guild on ticket_categories(guild_id);
create index if not exists idx_ticket_categories_panel on ticket_categories(panel_id);

alter table ticket_categories enable row level security;

alter table ticket_categories add column if not exists form_id bigint references ticket_forms(id) on delete set null;
alter table ticket_categories add column if not exists required_role_ids text[] not null default '{}';

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
  form_id       bigint references ticket_forms(id) on delete set null,
  form_answers  jsonb not null default '{}'::jsonb,
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
alter table tickets add column if not exists form_id bigint references ticket_forms(id) on delete set null;
alter table tickets add column if not exists form_answers jsonb not null default '{}'::jsonb;

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

create index if not exists idx_ticket_settings_autoclose_enabled
  on ticket_settings(guild_id) where autoclose_inactivity_enabled;

alter table ticket_settings enable row level security;

-- Per-server ticket access blacklist, separate from the existing blocked-role
-- shortcut in ticket_settings so staff can block individual users as well.
create table if not exists ticket_blacklist (
  id          bigserial primary key,
  guild_id    text not null references guilds(guild_id) on delete cascade,
  target_type text not null check (target_type in ('user', 'role')),
  target_id   text not null,
  reason      text,
  created_at  timestamptz not null default now(),
  unique (guild_id, target_type, target_id)
);

create index if not exists idx_ticket_blacklist_guild on ticket_blacklist(guild_id);

alter table ticket_blacklist enable row level security;

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

create index if not exists idx_bump_reminders_due
  on bump_reminders(next_bump_at) where channel_id is not null and next_bump_at is not null;

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
-- Booster roles: a custom, self-colored role each server booster can create for
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
  notify_message     text not null default '{user} just leveled up to **{level}**!',
  notify_embed       boolean not null default false,
  notify_embed_template text,
  notify_every       integer not null default 1,
  role_mode          text not null default 'highest' check (role_mode in ('highest', 'all')),
  ignored_channel_ids text[] not null default '{}',
  join_xp            integer not null default 0,
  join_level         integer not null default 0,
  updated_at         timestamptz not null default now()
);

alter table level_config add column if not exists notify_embed_template text;
alter table level_config add column if not exists voice_enabled boolean not null default true;
alter table level_config add column if not exists voice_curve_a numeric not null default 1;
alter table level_config add column if not exists voice_curve_b numeric not null default 50;
alter table level_config add column if not exists voice_curve_c numeric not null default 100;
alter table level_config add column if not exists voice_difficulty numeric not null default 2.5;
alter table level_config add column if not exists voice_rounding integer not null default 50;
alter table level_config add column if not exists voice_max_level integer not null default 1000;
alter table level_config add column if not exists voice_notify_mode text not null default 'off';
alter table level_config add column if not exists voice_notify_channel_id text;
alter table level_config add column if not exists voice_notify_message text not null default '{user} reached voice level **{level}**!';
alter table level_config add column if not exists voice_notify_embed boolean not null default false;
alter table level_config add column if not exists voice_notify_embed_template text;
alter table level_config add column if not exists voice_notify_every integer not null default 1;
alter table level_config add column if not exists voice_role_mode text not null default 'highest';
alter table level_config add column if not exists voice_ignored_channel_ids text[] not null default '{}';

-- Remove Petto's old star from untouched default level-up messages while preserving
-- custom messages configured by server administrators.
update level_config
set notify_message = '{user} just leveled up to **{level}**!'
where notify_message = '{EMOJI} {user} just leveled up to **{level}**!';

update level_config
set voice_notify_message = '{user} reached voice level **{level}**!'
where voice_notify_message = '{EMOJI} {user} reached voice level **{level}**!';

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
alter table level_users add column if not exists voice_xp bigint not null default 0;
alter table level_users add column if not exists voice_level integer not null default 0;
create index if not exists idx_level_users_voice_leaderboard on level_users(guild_id, voice_xp desc);

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

-- Voice XP has its own total and level so /rank voice and /top voice do not mix
-- time spent in voice with message XP.
create or replace function add_voice_xp(
  p_guild_id      text,
  p_user_id       text,
  p_voice_xp_gain bigint,
  p_vc_inc        bigint default 0
) returns level_users
language plpgsql
as $$
declare
  v_row level_users;
begin
  insert into level_users (guild_id, user_id, voice_xp, vc_minutes)
  values (p_guild_id, p_user_id, greatest(p_voice_xp_gain, 0), greatest(p_vc_inc, 0))
  on conflict (guild_id, user_id) do update
    set voice_xp = level_users.voice_xp + excluded.voice_xp,
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

-- A sticky message can be a saved embed (also a Components V2 design) instead of text.
alter table sticky_messages add column if not exists embed_template text;

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
  interaction_type text not null default 'reaction',
  button_label text,
  unique (message_id, emoji)
);

alter table reaction_roles add column if not exists interaction_type text not null default 'reaction';
alter table reaction_roles add column if not exists button_label text;

create index if not exists idx_reaction_roles_message on reaction_roles(message_id);
create index if not exists idx_reaction_roles_guild on reaction_roles(guild_id);

alter table reaction_roles enable row level security;

-- ── Reaction triggers ────────────────────────────────────────────────────────

create table if not exists reaction_triggers (
  id         bigserial primary key,
  guild_id   text not null references guilds(guild_id) on delete cascade,
  emoji      text not null,
  trigger    text not null,
  owner_id   text not null,
  match_mode text not null default 'contains' check (match_mode in ('contains', 'startsWith', 'endsWith', 'exact')),
  channel_ids text[] not null default '{}',
  role_ids    text[] not null default '{}',
  case_sensitive boolean not null default false,
  cooldown_seconds integer not null default 0 check (cooldown_seconds between 0 and 86400),
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  unique (guild_id, emoji, trigger)
);

alter table reaction_triggers add column if not exists match_mode text not null default 'contains';
alter table reaction_triggers add column if not exists channel_ids text[] not null default '{}';
alter table reaction_triggers add column if not exists role_ids text[] not null default '{}';
alter table reaction_triggers add column if not exists case_sensitive boolean not null default false;
alter table reaction_triggers add column if not exists cooldown_seconds integer not null default 0;
alter table reaction_triggers add column if not exists enabled boolean not null default true;

create index if not exists idx_reaction_triggers_guild on reaction_triggers(guild_id);
create index if not exists idx_reaction_triggers_match on reaction_triggers(guild_id, trigger);

alter table reaction_triggers enable row level security;

create table if not exists reaction_message_configs (
  id         bigserial primary key,
  guild_id   text not null references guilds(guild_id) on delete cascade,
  channel_id text not null,
  emojis     text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (guild_id, channel_id)
);

create index if not exists idx_reaction_message_configs_guild on reaction_message_configs(guild_id);

alter table reaction_message_configs enable row level security;

-- ── Managed webhooks ─────────────────────────────────────────────────────────

create table if not exists managed_webhooks (
  id           bigserial primary key,
  guild_id     text not null references guilds(guild_id) on delete cascade,
  channel_id   text not null,
  webhook_id   text not null unique,
  webhook_token text not null,
  name         text not null,
  created_by   text not null,
  default_username text,
  default_avatar_url text,
  default_message text,
  default_embed jsonb,
  enabled      boolean not null default true,
  created_at   timestamptz not null default now()
);

alter table managed_webhooks add column if not exists default_username text;
alter table managed_webhooks add column if not exists default_avatar_url text;
alter table managed_webhooks add column if not exists default_message text;
alter table managed_webhooks add column if not exists default_embed jsonb;
alter table managed_webhooks add column if not exists enabled boolean not null default true;

create index if not exists idx_managed_webhooks_guild on managed_webhooks(guild_id);

alter table managed_webhooks enable row level security;

-- ── Live counters ────────────────────────────────────────────────────────────

create table if not exists server_counters (
  id              bigserial primary key,
  guild_id        text not null references guilds(guild_id) on delete cascade,
  channel_id      text not null,
  counter_option  text not null,
  channel_type    text not null check (channel_type in ('voice', 'text', 'category', 'announce', 'stage')),
  created_by      text not null,
  name_template  text not null default '{option}: {value}',
  prefix         text not null default '',
  suffix         text not null default '',
  parent_id      text,
  interval_seconds integer not null default 60 check (interval_seconds between 60 and 86400),
  enabled        boolean not null default true,
  last_updated_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (guild_id, channel_id)
);

alter table server_counters add column if not exists name_template text not null default '{option}: {value}';
alter table server_counters add column if not exists prefix text not null default '';
alter table server_counters add column if not exists suffix text not null default '';
alter table server_counters add column if not exists parent_id text;
alter table server_counters add column if not exists interval_seconds integer not null default 60;
alter table server_counters add column if not exists enabled boolean not null default true;
alter table server_counters add column if not exists last_updated_at timestamptz;

create index if not exists idx_server_counters_guild on server_counters(guild_id);

alter table server_counters enable row level security;

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

-- What custom commands written in code remember (also created on demand, in the dedicated database when there is one).
create table if not exists custom_command_data (
  guild_id   text not null,
  user_id    text not null default '',
  key        text not null,
  value      jsonb not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (guild_id, user_id, key)
);
create index if not exists idx_custom_command_data_top on custom_command_data(guild_id, key);
create index if not exists idx_custom_command_data_expires on custom_command_data(expires_at) where expires_at is not null;
alter table custom_command_data enable row level security;

-- Commands written in code (Petto Code). When `code` is set it runs instead of the response and the embed.
alter table custom_commands add column if not exists code text;
alter table custom_commands add column if not exists created_by text;
-- What starts a command: the prefix of Petto ('command'), its own prefix, the start of a message, a whole message, or words inside.
alter table custom_commands add column if not exists trigger_type text not null default 'command';
alter table custom_commands add column if not exists trigger_text text;
alter table custom_commands drop constraint if exists custom_commands_trigger_type_check;
alter table custom_commands add constraint custom_commands_trigger_type_check check (trigger_type in ('command', 'prefix', 'startswith', 'exact', 'contains'));

-- ── Configurable command aliases ─────────────────────────────────────────

create table if not exists command_aliases (
  id         bigserial primary key,
  guild_id   text not null references guilds(guild_id) on delete cascade,
  name       text not null,
  command    text not null,
  created_at timestamptz not null default now(),
  unique (guild_id, name)
);

create index if not exists idx_command_aliases_guild on command_aliases(guild_id);

alter table command_aliases enable row level security;

-- ── Repeating timers ──────────────────────────────────────────────────────

create table if not exists auto_messages (
  id          bigserial primary key,
  guild_id    text not null references guilds(guild_id) on delete cascade,
  channel_id  text not null,
  interval_ms bigint not null check (interval_ms >= 600000),
  message     text not null,
  next_run_at timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (guild_id, channel_id)
);

create index if not exists idx_auto_messages_due on auto_messages(next_run_at);

alter table auto_messages enable row level security;

-- ── Starboard ─────────────────────────────────────────────────────────────

create table if not exists starboards (
  guild_id            text primary key references guilds(guild_id) on delete cascade,
  channel_id          text,
  threshold           integer not null default 3 check (threshold between 1 and 100),
  emoji               text not null default '⭐',
  selfstar            boolean not null default false,
  color               integer not null default 16760839,
  timestamp           boolean not null default true,
  jumpurl             boolean not null default true,
  attachments         boolean not null default true,
  ignored_channel_ids text[] not null default '{}',
  ignored_role_ids    text[] not null default '{}',
  ignored_user_ids    text[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists starboard_entries (
  guild_id            text not null references guilds(guild_id) on delete cascade,
  source_message_id   text not null,
  starboard_message_id text not null,
  count               integer not null default 0,
  updated_at          timestamptz not null default now(),
  primary key (guild_id, source_message_id)
);

create index if not exists idx_starboard_entries_guild on starboard_entries(guild_id);

alter table starboards enable row level security;
alter table starboard_entries enable row level security;

-- ── VoiceMaster temporary channels ───────────────────────────────────────

create table if not exists voice_configs (
  guild_id          text primary key references guilds(guild_id) on delete cascade,
  creator_channel_id text not null,
  panel_channel_id   text not null,
  panel_message_id   text,
  category_id        text,
  default_limit      integer not null default 0 check (default_limit between 0 and 99),
  default_name       text not null default '{user.name}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists voice_temp_channels (
  guild_id         text not null references guilds(guild_id) on delete cascade,
  channel_id       text primary key,
  owner_id         text not null,
  trusted_user_ids text[] not null default '{}',
  banned_user_ids  text[] not null default '{}',
  is_locked        boolean not null default false,
  is_ghosted       boolean not null default false,
  user_limit       integer not null default 0 check (user_limit between 0 and 99),
  created_at       timestamptz not null default now()
);

create index if not exists idx_voice_temp_guild on voice_temp_channels(guild_id);

alter table voice_configs enable row level security;
alter table voice_temp_channels enable row level security;

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

-- Global stats page: the totals of every server, and a ranking of the servers that chose to be in it.
-- A server is only named in the ranking when it turns this on in the dashboard; the totals never name anyone.
alter table guilds add column if not exists global_stats_visible boolean not null default false;
-- Every server is in the ranking unless it hides itself (the older `global_stats_visible` is no longer read).
alter table guilds add column if not exists global_stats_hidden boolean not null default false;

-- People who chose to appear in the user ranking (`!globalranking on`). Being here is the choice; nobody is added without it.
create table if not exists global_stats_users (
  user_id    text primary key,
  created_at timestamptz not null default now()
);
alter table global_stats_users enable row level security;

-- Everyone can appear in the user ranking unless they hide themselves (`!globalranking off`). This replaces the table above.
create table if not exists global_stats_hidden_users (
  user_id    text primary key,
  created_at timestamptz not null default now()
);
alter table global_stats_hidden_users enable row level security;

-- One row, `main`, rewritten every minute by the bot with what the public stats page shows.
create table if not exists global_stats (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table global_stats enable row level security;

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
create index if not exists idx_polls_due on polls(ends_at) where not closed and ends_at is not null;
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

-- Roleplay response controls and counters. A response is claimed by request_id
-- so two fast button clicks cannot double-count the same interaction.
create table if not exists roleplay_counters (
  guild_id  text not null references guilds(guild_id) on delete cascade,
  user_id   text not null,
  action    text not null,
  count     integer not null default 0 check (count >= 0),
  primary key (guild_id, user_id, action)
);
create index if not exists idx_roleplay_counters_user on roleplay_counters(guild_id, user_id);
alter table roleplay_counters enable row level security;

create table if not exists roleplay_responses (
  request_id  text primary key,
  guild_id    text not null references guilds(guild_id) on delete cascade,
  message_id  text not null,
  channel_id  text not null,
  actor_id    text not null,
  target_id   text not null,
  action      text not null,
  response    text not null check (response in ('accepted', 'rejected')),
  created_at  timestamptz not null default now()
);
create unique index if not exists idx_roleplay_responses_message on roleplay_responses(message_id);
create index if not exists idx_roleplay_responses_guild on roleplay_responses(guild_id, created_at desc);
alter table roleplay_responses enable row level security;

create or replace function record_roleplay_response(
  p_request_id text,
  p_guild_id text,
  p_message_id text,
  p_channel_id text,
  p_actor_id text,
  p_target_id text,
  p_action text,
  p_response text
)
returns table (claimed boolean, counter_value integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  if p_response not in ('accepted', 'rejected') then
    raise exception 'Invalid roleplay response type';
  end if;
  if p_action !~ '^[a-z][a-z0-9_-]{0,31}$' then
    raise exception 'Invalid roleplay action';
  end if;

  insert into roleplay_responses (request_id, guild_id, message_id, channel_id, actor_id, target_id, action, response)
  values (p_request_id, p_guild_id, p_message_id, p_channel_id, p_actor_id, p_target_id, p_action, p_response)
  on conflict (request_id) do nothing;

  if not found then
    return query select false, 0;
    return;
  end if;

  if p_response = 'accepted' then
    insert into roleplay_counters (guild_id, user_id, action, count)
    values (p_guild_id, p_target_id, p_action, 1)
    on conflict (guild_id, user_id, action)
    do update set count = roleplay_counters.count + 1
    returning roleplay_counters.count into next_count;

    insert into roleplay_counters (guild_id, user_id, action, count)
    values (p_guild_id, p_actor_id, p_action, 1)
    on conflict (guild_id, user_id, action)
    do update set count = roleplay_counters.count + 1;
  else
    insert into roleplay_counters (guild_id, user_id, action, count)
    values (p_guild_id, p_actor_id, 'slap', 1)
    on conflict (guild_id, user_id, action)
    do update set count = roleplay_counters.count + 1
    returning roleplay_counters.count into next_count;
  end if;

  return query select true, next_count;
end;
$$;

-- Custom messages (saved embed templates) for moderation: what a sanctioned member receives in a DM, what is posted
-- where the command was used, and what goes to the sanctions log. `type` is a sanction type, or `default` for the ones
-- that have no template of their own.
create table if not exists sanction_templates (
  guild_id       text not null references guilds(guild_id) on delete cascade,
  type           text not null check (type in ('default', 'ban', 'tempban', 'softban', 'unban', 'kick', 'mute', 'tempmute', 'unmute', 'warn', 'jail', 'unjail')),
  dm_template    text,
  reply_template text,
  log_template   text,
  updated_at     timestamptz not null default now(),
  primary key (guild_id, type)
);
alter table sanction_templates enable row level security;

-- Custom messages for the starboard repost, the giveaway announcements, verification and bump.
alter table starboards add column if not exists embed_template text;
alter table giveaway_config add column if not exists winner_embed_template text;
alter table giveaway_config add column if not exists deny_embed_template text;
alter table giveaway_config add column if not exists claim_time_embed_template text;
alter table giveaway_config add column if not exists claim_time_over_embed_template text;
alter table giveaway_config add column if not exists accept_embed_template text;
alter table giveaway_config add column if not exists no_entries_embed_template text;

-- Saved embeds (embed_templates names) for verification and bump messages.
alter table verification_config add column if not exists prompt_embed_template text;
alter table verification_config add column if not exists verified_embed_template text;
alter table bump_reminders add column if not exists thankyou_embed_template text;
alter table bump_reminders add column if not exists reminder_embed_template text;
-- Leveling v2: rank card, anti-abuse rules, XP events, daily bonus and streaks, weekly and monthly rankings.
alter table level_config add column if not exists rank_style text not null default 'card' check (rank_style in ('card', 'embed', 'both'));
alter table level_config add column if not exists rank_card text;
alter table level_config add column if not exists notify_card text;
alter table level_config add column if not exists voice_notify_card text;
-- A message shorter than this many characters (after links, mentions and spaces are removed) gives no XP.
alter table level_config add column if not exists min_message_chars integer not null default 3 check (min_message_chars between 0 and 200);
-- The same text again within a minute gives no XP.
alter table level_config add column if not exists anti_repeat boolean not null default true;
-- Voice XP only while at least this many people (not bots) are in the channel, and optionally not while muted.
alter table level_config add column if not exists voice_min_members integer not null default 2 check (voice_min_members between 1 and 20);
alter table level_config add column if not exists voice_ignore_muted boolean not null default false;
-- Bonus XP for the first activity of each day, and extra per consecutive day (up to streak_max_days).
alter table level_config add column if not exists daily_bonus_xp integer not null default 0 check (daily_bonus_xp between 0 and 100000);
alter table level_config add column if not exists streak_bonus_xp integer not null default 0 check (streak_bonus_xp between 0 and 10000);
alter table level_config add column if not exists streak_max_days integer not null default 7 check (streak_max_days between 1 and 365);

alter table level_users add column if not exists last_active_day date;
alter table level_users add column if not exists streak integer not null default 0;
alter table level_users add column if not exists best_streak integer not null default 0;

-- Temporary XP multipliers with a start and an end, for all XP or only text or voice.
create table if not exists xp_events (
  id          bigserial primary key,
  guild_id    text not null references guilds(guild_id) on delete cascade,
  name        text not null,
  multiplier  numeric not null check (multiplier > 0 and multiplier <= 20),
  source      text not null default 'all' check (source in ('all', 'text', 'voice')),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null check (ends_at > starts_at),
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_xp_events_guild_time on xp_events(guild_id, ends_at);
alter table xp_events enable row level security;

-- XP earned in one week or month. The key changes with the period, so a new period starts empty by itself.
create table if not exists level_period_xp (
  guild_id    text not null references guilds(guild_id) on delete cascade,
  user_id     text not null,
  kind        text not null check (kind in ('week', 'month')),
  period_key  text not null,
  text_xp     bigint not null default 0,
  voice_xp    bigint not null default 0,
  primary key (guild_id, user_id, kind, period_key)
);
create index if not exists idx_level_period_board on level_period_xp(guild_id, kind, period_key, text_xp desc);
create index if not exists idx_level_period_voice_board on level_period_xp(guild_id, kind, period_key, voice_xp desc);
alter table level_period_xp enable row level security;

-- Adds XP to the week and month rows of a member in one statement.
create or replace function add_period_xp(
  p_guild_id  text,
  p_user_id   text,
  p_week_key  text,
  p_month_key text,
  p_text_xp   bigint,
  p_voice_xp  bigint
) returns void
language plpgsql
as $$
begin
  insert into level_period_xp (guild_id, user_id, kind, period_key, text_xp, voice_xp)
  values (p_guild_id, p_user_id, 'week', p_week_key, p_text_xp, p_voice_xp),
         (p_guild_id, p_user_id, 'month', p_month_key, p_text_xp, p_voice_xp)
  on conflict (guild_id, user_id, kind, period_key) do update
    set text_xp = level_period_xp.text_xp + excluded.text_xp,
        voice_xp = level_period_xp.voice_xp + excluded.voice_xp;
end;
$$;

-- Marks a member active today. Returns whether it is the first activity of the day and the streak after it.
create or replace function touch_level_streak(
  p_guild_id text,
  p_user_id  text,
  p_today    date
) returns table (new_day boolean, streak integer)
language plpgsql
as $$
declare
  v_last   date;
  v_streak integer;
begin
  select last_active_day, level_users.streak into v_last, v_streak
  from level_users where guild_id = p_guild_id and user_id = p_user_id for update;
  if not found then
    return query select false, 0;
    return;
  end if;
  if v_last = p_today then
    return query select false, v_streak;
    return;
  end if;
  v_streak := case when v_last = p_today - 1 then v_streak + 1 else 1 end;
  update level_users
    set last_active_day = p_today, streak = v_streak, best_streak = greatest(best_streak, v_streak)
    where guild_id = p_guild_id and user_id = p_user_id;
  return query select true, v_streak;
end;
$$;

-- Quest alerts: a message in a channel when a new Discord Quest appears (data from api.discordquest.com).
create table if not exists quest_config (
  guild_id       text primary key references guilds(guild_id) on delete cascade,
  enabled        boolean not null default false,
  channel_id     text,
  role_id        text,
  style          text not null default 'card' check (style in ('card', 'template')),
  embed_template text,
  reward_kinds   text[] not null default '{}',
  task_kinds     text[] not null default '{}',
  hide_sections  text[] not null default '{}',
  accent_color   integer,
  expiring_hours integer not null default 0 check (expiring_hours between 0 and 168),
  updated_at     timestamptz not null default now()
);
alter table quest_config enable row level security;

create table if not exists quest_seen (
  quest_id      text primary key,
  first_seen_at timestamptz not null default now(),
  expires_at    timestamptz
);
alter table quest_seen enable row level security;

create table if not exists quest_posts (
  guild_id   text not null references guilds(guild_id) on delete cascade,
  quest_id   text not null,
  kind       text not null check (kind in ('new', 'expiring')),
  message_id text,
  posted_at  timestamptz not null default now(),
  primary key (guild_id, quest_id, kind)
);
alter table quest_posts enable row level security;

-- Partners: a partnership is counted when a Partner Manager posts the invite of another server in a partner channel and
-- it passes the requirements of the server. `partner_log` has one row per counted partnership (daily, weekly and total
-- numbers are counted from it); `messages` holds the replies a server changed (key -> { text, template }).
create table if not exists partner_config (
  guild_id         text primary key references guilds(guild_id) on delete cascade,
  enabled          boolean not null default false,
  channel_ids      text[] not null default '{}',
  manager_role_id  text,
  min_members      integer not null default 0 check (min_members between 0 and 10000000),
  min_age_days     integer not null default 0 check (min_age_days between 0 and 3650),
  cooldown_days    integer not null default 0 check (cooldown_days between 0 and 365),
  keep_original    boolean not null default true,
  react_emoji      text,
  messages         jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);
alter table partner_config enable row level security;

create table if not exists partner_blacklist (
  guild_id         text not null references guilds(guild_id) on delete cascade,
  partner_guild_id text not null,
  note             text,
  created_at       timestamptz not null default now(),
  primary key (guild_id, partner_guild_id)
);
alter table partner_blacklist enable row level security;

create table if not exists partner_log (
  id               bigserial primary key,
  guild_id         text not null references guilds(guild_id) on delete cascade,
  manager_id       text not null,
  partner_guild_id text not null,
  partner_name     text,
  members          integer,
  invite_code      text,
  channel_id       text,
  message_id       text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_partner_log_guild_time on partner_log (guild_id, created_at desc);
create index if not exists idx_partner_log_manager on partner_log (guild_id, manager_id, created_at desc);
create index if not exists idx_partner_log_partner on partner_log (guild_id, partner_guild_id, created_at desc);
alter table partner_log enable row level security;

-- Button responders and panels: a responder is a button (or a choice of a menu) that answers with a private message and
-- gives, takes or toggles roles; a panel is the message that shows some of them, as buttons or as one dropdown menu.
create table if not exists button_responders (
  id                bigserial primary key,
  guild_id          text not null references guilds(guild_id) on delete cascade,
  name              text not null check (name ~ '^[a-z0-9_-]{1,60}$'),
  label             text not null default '' check (char_length(label) <= 80),
  emoji             text,
  style             text not null default 'secondary' check (style in ('primary', 'secondary', 'success', 'danger')),
  reply             text not null default '' check (char_length(reply) <= 2000),
  reply_template    text,
  give_role_ids     text[] not null default '{}',
  remove_role_ids   text[] not null default '{}',
  required_role_ids text[] not null default '{}',
  toggle            boolean not null default false,
  created_by        text,
  created_at        timestamptz not null default now(),
  unique (guild_id, name)
);
alter table button_responders enable row level security;

create table if not exists component_panels (
  id             bigserial primary key,
  guild_id       text not null references guilds(guild_id) on delete cascade,
  name           text not null check (name ~ '^[a-z0-9_-]{1,60}$'),
  kind           text not null default 'buttons' check (kind in ('buttons', 'select')),
  content        text not null default '' check (char_length(content) <= 2000),
  embed_template text,
  responders     text[] not null default '{}',
  placeholder    text not null default '' check (char_length(placeholder) <= 100),
  exclusive      boolean not null default false,
  channel_id     text,
  message_id     text,
  created_at     timestamptz not null default now(),
  unique (guild_id, name)
);
alter table component_panels enable row level security;

-- Uploads: the messages with files posted in the channels a server chose are counted per member, for the numbers, the
-- ranking and the welcome of a new uploader (a role and a message).
create table if not exists upload_config (
  guild_id         text primary key references guilds(guild_id) on delete cascade,
  enabled          boolean not null default false,
  channel_ids      text[] not null default '{}',
  uploader_role_id text,
  welcome          jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);
alter table upload_config enable row level security;

create table if not exists upload_log (
  id         bigserial primary key,
  guild_id   text not null references guilds(guild_id) on delete cascade,
  user_id    text not null,
  channel_id text not null,
  message_id text not null,
  files      integer not null default 1,
  created_at timestamptz not null default now(),
  unique (guild_id, message_id)
);
create index if not exists idx_upload_log_guild_time on upload_log (guild_id, created_at desc);
create index if not exists idx_upload_log_user on upload_log (guild_id, user_id, created_at desc);
alter table upload_log enable row level security;

-- Requests: members ask for something with `!request`, a card with buttons is posted for the staff to claim and finish.
-- A claimed request that is not finished in `completion_hours` goes back to open by itself (Premium).
create table if not exists request_config (
  guild_id         text primary key references guilds(guild_id) on delete cascade,
  enabled          boolean not null default false,
  channel_id       text,
  staff_role_id    text,
  ping_role_id     text,
  max_open         integer not null default 3 check (max_open between 1 and 25),
  completion_hours integer not null default 0 check (completion_hours between 0 and 720),
  messages         jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);
alter table request_config enable row level security;

create table if not exists requests (
  id           bigserial primary key,
  guild_id     text not null references guilds(guild_id) on delete cascade,
  number       integer not null,
  user_id      text not null,
  content      text not null check (char_length(content) <= 1000),
  status       text not null default 'open' check (status in ('open', 'claimed', 'done', 'cancelled')),
  claimed_by   text,
  channel_id   text,
  message_id   text,
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  completed_at timestamptz,
  unique (guild_id, number)
);
create index if not exists idx_requests_guild_status on requests (guild_id, status, created_at desc);
create index if not exists idx_requests_user on requests (guild_id, user_id, status);
create index if not exists idx_requests_claimed on requests (status, claimed_at) where status = 'claimed';
alter table requests enable row level security;

-- Reviews and profiles: members rate each other from 1 to 5 stars (one review per pair, changed by sending it again), and
-- `!profile` shows the numbers of the member: uploads, requests, partnerships and the average rating.
create table if not exists profile_config (
  guild_id          text primary key references guilds(guild_id) on delete cascade,
  reviews_enabled   boolean not null default true,
  review_channel_id text,
  updated_at        timestamptz not null default now()
);
alter table profile_config enable row level security;

create table if not exists member_reviews (
  id          bigserial primary key,
  guild_id    text not null references guilds(guild_id) on delete cascade,
  target_id   text not null,
  reviewer_id text not null,
  stars       integer not null check (stars between 1 and 5),
  comment     text not null default '' check (char_length(comment) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (guild_id, target_id, reviewer_id),
  check (target_id <> reviewer_id)
);
create index if not exists idx_member_reviews_target on member_reviews (guild_id, target_id, updated_at desc);
alter table member_reviews enable row level security;

-- Partners, more settings: a cooldown that can be hours (`cooldown_minutes`, used instead of `cooldown_days` when set), the
-- channel where a new Partner Manager is welcomed, and refusing NSFW servers or servers with some words in their profile.
alter table partner_config add column if not exists cooldown_minutes integer not null default 0 check (cooldown_minutes between 0 and 525600);
alter table partner_config add column if not exists welcome_channel_id text;
alter table partner_config add column if not exists block_nsfw boolean not null default false;
alter table partner_config add column if not exists blocked_keywords text[] not null default '{}';

-- Honeypot: what is posted in the bait channel. `default` is the warning panel Petto makes, `custom` is the text and/or the
-- saved embed below (with {honeypot.*} variables), `none` posts nothing.
alter table honeypots add column if not exists panel_mode text not null default 'default' check (panel_mode in ('default', 'custom', 'none'));
alter table honeypots add column if not exists panel_text text not null default '' check (char_length(panel_text) <= 2000);
alter table honeypots add column if not exists panel_template text;

-- What the dashboard needs to know about each server Petto is in, kept up to date by the bot so the web reads it from here
-- instead of asking Discord on every page. `channels` and `roles` have the shape of Discord's own API answers.
create table if not exists discord_guild_snapshots (
  guild_id     text primary key,
  name         text not null,
  icon         text,
  owner_id     text,
  member_count integer,
  channels     jsonb not null default '[]'::jsonb,
  roles        jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now()
);

-- The rest of what the dashboard asked Discord for on each page: the server banner, how many emojis and boosts it has, and how
-- the bot looks in it (its server nickname and server avatar).
alter table discord_guild_snapshots add column if not exists banner text;
alter table discord_guild_snapshots add column if not exists emoji_count integer;
alter table discord_guild_snapshots add column if not exists premium_tier integer;
alter table discord_guild_snapshots add column if not exists boost_count integer;
alter table discord_guild_snapshots add column if not exists bot_nick text;
alter table discord_guild_snapshots add column if not exists bot_avatar text;

-- A poll can use one of the server's saved Components V2 embeds as its design (with the {poll.*} variables); empty is the default card.
alter table polls add column if not exists embed_template text;

-- The people shown on the public team page. The owner edits them from the dashboard; the page keeps its own
-- list while this table is empty. Each position holds up to 100 people (the dashboard checks it).
create table if not exists site_team (
  id bigserial primary key,
  position text not null,
  user_id text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (position, user_id)
);
create index if not exists site_team_position_idx on site_team (position, sort_order);
