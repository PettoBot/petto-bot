-- One-time production migration: give every form (application) and every appeal form a number inside its server (#1, #2, #3...), so a form belongs to its
-- server and the first form of a new server is number 1, not whatever the shared internal id has reached.
--
-- The existing forms are numbered once, per server, in creation order (the internal id grows with creation). `forms.id` stays the
-- primary key and the id inside buttons and submissions; it is no longer shown to anyone. This is the same SQL that schema.sql runs
-- on every start (it is idempotent there too), kept here with the schema_migrations marker like the other one-time migrations, so it
-- can be run by hand before deploying the matching bot code. Running it again changes nothing.

begin;

create table if not exists schema_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);

alter table schema_migrations enable row level security;

lock table forms in access exclusive mode;
lock table appeal_forms in access exclusive mode;

alter table forms add column if not exists number integer;
alter table appeal_forms add column if not exists number integer;

do $$
begin
  if not exists (
    select 1
      from schema_migrations
     where name = '2026-11-01-per-server-form-numbers'
  ) then
    update forms f
       set number = n.position + coalesce((select max(x.number) from forms x where x.guild_id = f.guild_id and x.number is not null), 0)
      from (select id, row_number() over (partition by guild_id order by id)::integer as position from forms where number is null) n
     where f.id = n.id and f.number is null;

    update appeal_forms f
       set number = n.position + coalesce((select max(x.number) from appeal_forms x where x.guild_id = f.guild_id and x.number is not null), 0)
      from (select id, row_number() over (partition by guild_id order by id)::integer as position from appeal_forms where number is null) n
     where f.id = n.id and f.number is null;

    insert into schema_migrations (name)
    values ('2026-11-01-per-server-form-numbers');
  end if;
end;
$$;

create or replace function forms_assign_number() returns trigger
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('forms.number:' || new.guild_id));
  select coalesce(max(number), 0) + 1 into new.number from forms where guild_id = new.guild_id;
  return new;
end;
$$;

drop trigger if exists forms_assign_number on forms;
create trigger forms_assign_number before insert on forms for each row execute function forms_assign_number();

alter table forms alter column number set not null;
alter table forms drop constraint if exists forms_number_check;
alter table forms add constraint forms_number_check check (number >= 1);
create unique index if not exists idx_forms_guild_number on forms(guild_id, number);

create or replace function appeal_forms_assign_number() returns trigger
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('appeal_forms.number:' || new.guild_id));
  select coalesce(max(number), 0) + 1 into new.number from appeal_forms where guild_id = new.guild_id;
  return new;
end;
$$;

drop trigger if exists appeal_forms_assign_number on appeal_forms;
create trigger appeal_forms_assign_number before insert on appeal_forms for each row execute function appeal_forms_assign_number();

alter table appeal_forms alter column number set not null;
alter table appeal_forms drop constraint if exists appeal_forms_number_check;
alter table appeal_forms add constraint appeal_forms_number_check check (number >= 1);
create unique index if not exists idx_appeal_forms_guild_number on appeal_forms(guild_id, number);

commit;
