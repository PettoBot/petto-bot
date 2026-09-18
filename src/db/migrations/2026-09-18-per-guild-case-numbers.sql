-- One-time production migration: convert legacy/global-looking case numbers into
-- stable per-guild sequences while preserving chronological order and warn links.
--
-- Run this once in the Supabase SQL editor before deploying the matching bot code.
-- The schema_migrations marker makes repeated execution a no-op.

begin;

create table if not exists schema_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);

alter table schema_migrations enable row level security;

create table if not exists guild_case_counters (
  guild_id          text primary key references guilds(guild_id) on delete cascade,
  last_case_number  integer not null default 0 check (last_case_number >= 0)
);

alter table guild_case_counters enable row level security;

do $$
begin
  if not exists (
    select 1
      from schema_migrations
     where name = '2026-09-18-per-guild-case-numbers'
  ) then
    lock table mod_actions in access exclusive mode;
    lock table warns in access exclusive mode;

    create temporary table _petto_case_renumber on commit drop as
      select
        id,
        guild_id,
        case_number as old_case_number,
        row_number() over (
          partition by guild_id
          order by created_at asc, id asc
        )::integer as new_case_number
      from mod_actions;

    update mod_actions as action
       set case_number = -mapping.new_case_number
      from _petto_case_renumber as mapping
     where action.id = mapping.id;

    update warns as warning
       set case_number = mapping.new_case_number
      from _petto_case_renumber as mapping
     where warning.guild_id = mapping.guild_id
       and warning.case_number = mapping.old_case_number;

    update mod_actions as action
       set case_number = mapping.new_case_number
      from _petto_case_renumber as mapping
     where action.id = mapping.id;

    insert into guild_case_counters (guild_id, last_case_number)
      select guild_id, max(case_number)
        from mod_actions
       group by guild_id
    on conflict (guild_id) do update
      set last_case_number = excluded.last_case_number;

    insert into schema_migrations (name)
    values ('2026-09-18-per-guild-case-numbers');
  end if;
end;
$$;

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

commit;
