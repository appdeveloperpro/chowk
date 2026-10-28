create table if not exists public.staff_role_definitions (
  id uuid primary key default gen_random_uuid(),
  role_key text not null unique check (role_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  display_name text not null check (length(trim(display_name)) between 2 and 80),
  description text not null default '' check (length(description) <= 500),
  duties text not null default '' check (length(duties) <= 5000),
  access_profile text not null check (access_profile in ('reporter', 'moderator', 'editor')),
  is_builtin boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists staff_role_definitions_name_lower_idx
  on public.staff_role_definitions(lower(display_name));

insert into public.staff_role_definitions(
  role_key, display_name, description, duties, access_profile, is_builtin
)
values
  ('reporter', 'Reporter', 'Reports news from an assigned coverage area.', 'Gather, verify, and submit news within the assigned reporting coverage.', 'reporter', true),
  ('moderator', 'Moderator', 'Reviews reporter submissions.', 'Review assigned submissions and apply newsroom moderation actions.', 'moderator', true),
  ('editor', 'Editor', 'Manages editorial review and publishing.', 'Review, revise, schedule, and publish newsroom content.', 'editor', true)
on conflict (role_key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    access_profile = excluded.access_profile,
    is_builtin = true;

alter table public.staff_onboarding
  add column if not exists staff_role_id uuid
  references public.staff_role_definitions(id) on delete restrict;

update public.staff_onboarding onboarding
set staff_role_id = definition.id
from public.staff_role_definitions definition
where definition.role_key = onboarding.requested_role
  and onboarding.staff_role_id is null;

create table if not exists public.staff_role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  staff_role_id uuid not null references public.staff_role_definitions(id) on delete restrict,
  role_key_snapshot text not null,
  display_name_snapshot text not null,
  status text not null check (status in ('pending', 'active', 'ended')),
  duties_snapshot text not null default '',
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  starts_at timestamptz,
  ended_at timestamptz,
  end_reason text not null default '',
  check ((status = 'ended') = (ended_at is not null)),
  check ((status = 'active') = (starts_at is not null))
);

create unique index if not exists staff_role_assignments_one_current_idx
  on public.staff_role_assignments(user_id)
  where status in ('pending', 'active');
create index if not exists staff_role_assignments_user_history_idx
  on public.staff_role_assignments(user_id, assigned_at desc);

insert into public.staff_role_assignments(
  user_id, staff_role_id, role_key_snapshot, display_name_snapshot,
  status, duties_snapshot, assigned_by, assigned_at, starts_at
)
select onboarding.user_id, onboarding.staff_role_id,
  definition.role_key, definition.display_name,
  case when onboarding.status = 'active' then 'active' else 'pending' end,
  definition.duties, onboarding.invited_by, onboarding.invited_at,
  case when onboarding.status = 'active' then coalesce(onboarding.reviewed_at, onboarding.updated_at) else null end
from public.staff_onboarding onboarding
join public.staff_role_definitions definition on definition.id = onboarding.staff_role_id
where onboarding.status in ('invited', 'submitted', 'changes_requested', 'approved_pending_agreement', 'active')
  and not exists (
    select 1 from public.staff_role_assignments assignment
    where assignment.user_id = onboarding.user_id
      and assignment.status in ('pending', 'active')
  );

insert into public.staff_role_assignments(
  user_id, staff_role_id, role_key_snapshot, display_name_snapshot,
  status, duties_snapshot, assigned_at, starts_at
)
select reporter.user_id, definition.id, definition.role_key, definition.display_name,
  'active', definition.duties, reporter.created_at, coalesce(reporter.created_at, now())
from public.reporter_profiles reporter
join public.profiles profile on profile.id = reporter.user_id and profile.role = 'reporter'
join public.staff_role_definitions definition on definition.role_key = 'reporter'
where not exists (
  select 1 from public.staff_role_assignments assignment
  where assignment.user_id = reporter.user_id
    and assignment.status in ('pending', 'active')
);

alter table public.staff_role_definitions enable row level security;
alter table public.staff_role_assignments enable row level security;

drop policy if exists "Admins and assigned staff read staff role definitions"
  on public.staff_role_definitions;
create policy "Admins and assigned staff read staff role definitions"
  on public.staff_role_definitions for select to authenticated
  using (
    (select public.chowk_has_any_role(array['admin', 'super_admin']))
    or exists (
      select 1 from public.staff_onboarding onboarding
      where onboarding.user_id = (select auth.uid())
        and onboarding.staff_role_id = staff_role_definitions.id
    )
  );

drop policy if exists "Staff and admins read staff role assignments"
  on public.staff_role_assignments;
create policy "Staff and admins read staff role assignments"
  on public.staff_role_assignments for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.chowk_has_any_role(array['admin', 'super_admin']))
  );

revoke all on public.staff_role_definitions, public.staff_role_assignments
  from anon, authenticated;
grant select on public.staff_role_definitions, public.staff_role_assignments
  to authenticated;

create or replace function public.chowk_admin_save_staff_role_definition(
  target_role_id uuid,
  target_role_key text,
  target_display_name text,
  target_description text,
  target_duties text,
  target_access_profile text,
  target_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  existing_role public.staff_role_definitions%rowtype;
  saved_role_id uuid;
begin
  if actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if target_role_key is null
      or target_role_key !~ '^[a-z][a-z0-9_]{1,49}$'
      or target_display_name is null
      or length(trim(coalesce(target_display_name, ''))) not between 2 and 80
      or length(coalesce(target_description, '')) > 500
      or length(coalesce(target_duties, '')) > 5000
      or target_access_profile is null
      or target_access_profile not in ('reporter', 'moderator', 'editor')
      or target_is_active is null then
    raise exception 'Enter a valid staff title, description, duties, access profile, and active status'
      using errcode = '22023';
  end if;

  if target_role_id is null then
    if target_access_profile = 'reporter' then
      raise exception 'Reporter permissions are assigned only through the Reporter Desk workflow'
        using errcode = '23514';
    end if;
    insert into public.staff_role_definitions(
      role_key, display_name, description, duties, access_profile, is_active, created_by
    )
    values (
      target_role_key, trim(target_display_name), trim(coalesce(target_description, '')),
      trim(coalesce(target_duties, '')), target_access_profile, target_is_active, actor
    )
    returning id into saved_role_id;
  else
    select * into existing_role
    from public.staff_role_definitions
    where id = target_role_id
    for update;
    if not found then
      raise exception 'Staff role was not found' using errcode = 'P0002';
    end if;
    if target_role_key is distinct from existing_role.role_key
        or target_access_profile is distinct from existing_role.access_profile
        or (existing_role.is_builtin and target_is_active is distinct from true) then
      raise exception 'Role keys and access profiles cannot be changed; built-in roles cannot be deactivated'
        using errcode = '23514';
    end if;
    update public.staff_role_definitions
    set role_key = target_role_key,
        display_name = trim(target_display_name),
        description = trim(coalesce(target_description, '')),
        duties = trim(coalesce(target_duties, '')),
        access_profile = target_access_profile,
        is_active = target_is_active,
        updated_at = now()
    where id = target_role_id
    returning id into saved_role_id;
  end if;
  return saved_role_id;
end;
$$;

revoke all on function public.chowk_admin_save_staff_role_definition(uuid,text,text,text,text,text,boolean)
  from public, anon;
grant execute on function public.chowk_admin_save_staff_role_definition(uuid,text,text,text,text,text,boolean)
  to authenticated;

create or replace function public.chowk_admin_create_staff_role_invitation(
  target_user uuid,
  target_role_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  role_row public.staff_role_definitions%rowtype;
begin
  if actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select * into role_row
  from public.staff_role_definitions
  where id = target_role_id and is_active
  for share;
  if not found then
    raise exception 'Choose an active staff role' using errcode = '22023';
  end if;
  if role_row.access_profile = 'reporter' then
    raise exception 'Reporter invitations must use the Reporter Desk application workflow'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.profiles where id = target_user and role = 'subscriber'
  ) then
    raise exception 'The invited account is missing or already has a newsroom role' using errcode = '23514';
  end if;
  insert into public.staff_onboarding(user_id, requested_role, staff_role_id, invited_by)
  values (target_user, role_row.access_profile, role_row.id, actor);
  insert into public.staff_role_assignments(
    user_id, staff_role_id, role_key_snapshot, display_name_snapshot,
    status, duties_snapshot, assigned_by
  )
  values (
    target_user, role_row.id, role_row.role_key, role_row.display_name,
    'pending', role_row.duties, actor
  );
end;
$$;

revoke all on function public.chowk_admin_create_staff_role_invitation(uuid,uuid)
  from public, anon;
grant execute on function public.chowk_admin_create_staff_role_invitation(uuid,uuid)
  to authenticated;

create or replace function public.chowk_admin_create_staff_onboarding_invitation(
  target_user uuid,
  target_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_id uuid;
begin
  if target_role not in ('moderator', 'editor') then
    raise exception 'Staff role must be moderator or editor' using errcode = '22023';
  end if;
  select id into role_id
  from public.staff_role_definitions
  where role_key = target_role and is_builtin and is_active;
  if role_id is null then
    raise exception 'Built-in staff role is unavailable' using errcode = '23514';
  end if;
  perform public.chowk_admin_create_staff_role_invitation(target_user, role_id);
end;
$$;

revoke all on function public.chowk_admin_create_staff_onboarding_invitation(uuid,text)
  from public, anon;
grant execute on function public.chowk_admin_create_staff_onboarding_invitation(uuid,text)
  to authenticated;

create or replace function public.chowk_admin_reassign_staff_job_role(
  target_user uuid,
  target_role_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  current_onboarding public.staff_onboarding%rowtype;
  target_role public.staff_role_definitions%rowtype;
  assignment_id uuid;
begin
  if actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select * into current_onboarding
  from public.staff_onboarding
  where user_id = target_user and status = 'active'
  for update;
  if not found then
    raise exception 'Only active staff can be reassigned to a different job title' using errcode = '23514';
  end if;
  select * into target_role
  from public.staff_role_definitions
  where id = target_role_id and is_active;
  if not found then
    raise exception 'Choose an active staff role' using errcode = '22023';
  end if;
  if target_role.access_profile <> current_onboarding.requested_role then
    raise exception 'Changing the staff member access profile requires a new onboarding and agreement flow'
      using errcode = '23514';
  end if;
  if current_onboarding.staff_role_id = target_role.id then
    raise exception 'This staff member already has that job title' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('chowk_staff_job_assignment:' || target_user::text, 0)
  );
  update public.staff_role_assignments
  set status = 'ended', ended_at = now(), end_reason = 'Reassigned by administrator'
  where user_id = target_user and status = 'active';
  update public.staff_onboarding
  set staff_role_id = target_role.id, updated_at = now()
  where user_id = target_user;
  insert into public.staff_role_assignments(
    user_id, staff_role_id, role_key_snapshot, display_name_snapshot,
    status, duties_snapshot, assigned_by, starts_at
  )
  values (
    target_user, target_role.id, target_role.role_key, target_role.display_name,
    'active', target_role.duties, actor, now()
  )
  returning id into assignment_id;
  return assignment_id;
end;
$$;

revoke all on function public.chowk_admin_reassign_staff_job_role(uuid,uuid)
  from public, anon;
grant execute on function public.chowk_admin_reassign_staff_job_role(uuid,uuid)
  to authenticated;

create or replace function public.chowk_sync_staff_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    update public.staff_role_assignments
    set status = 'active', starts_at = coalesce(starts_at, now())
    where user_id = new.user_id and status = 'pending';
  elsif new.status = 'rejected' and old.status is distinct from 'rejected' then
    update public.staff_role_assignments
    set status = 'ended', ended_at = now(), end_reason = 'Staff onboarding rejected'
    where user_id = new.user_id and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists chowk_sync_staff_role_assignment on public.staff_onboarding;
create trigger chowk_sync_staff_role_assignment
  after update of status on public.staff_onboarding
  for each row execute function public.chowk_sync_staff_role_assignment();

create or replace function public.chowk_sync_reporter_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reporter_role public.staff_role_definitions%rowtype;
begin
  if new.role = 'reporter' and old.role is distinct from 'reporter' then
    select * into reporter_role
    from public.staff_role_definitions
    where role_key = 'reporter' and is_active;
    if not found or not exists (
      select 1 from public.reporter_profiles where user_id = new.id
    ) then
      raise exception 'Reporter role assignment requires an active reporter profile'
        using errcode = '23514';
    end if;
    insert into public.staff_role_assignments(
      user_id, staff_role_id, role_key_snapshot, display_name_snapshot,
      status, duties_snapshot, starts_at
    )
    select new.id, reporter_role.id, reporter_role.role_key, reporter_role.display_name,
      'active', reporter_role.duties, now()
    where not exists (
      select 1 from public.staff_role_assignments assignment
      where assignment.user_id = new.id
        and assignment.status in ('pending', 'active')
    );
  elsif new.role is distinct from old.role then
    update public.staff_role_assignments assignment
    set status = 'ended', ended_at = now(), end_reason = 'Account access profile changed'
    from public.staff_role_definitions definition
    where assignment.staff_role_id = definition.id
      and assignment.user_id = new.id
      and assignment.status = 'active'
      and definition.access_profile <> new.role;
  end if;
  return new;
end;
$$;

drop trigger if exists chowk_sync_reporter_role_assignment on public.profiles;
create trigger chowk_sync_reporter_role_assignment
  after update of role on public.profiles
  for each row execute function public.chowk_sync_reporter_role_assignment();
