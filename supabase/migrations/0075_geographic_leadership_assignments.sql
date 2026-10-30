begin;

create table public.location_leadership_roles (
  id uuid primary key default gen_random_uuid(),
  role_key text not null unique check (role_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  name text not null check (length(trim(name)) between 2 and 100),
  description text not null default '' check (length(description) <= 2000),
  location_type text not null check (location_type in (
    'state', 'region', 'zone', 'range', 'district', 'coverage_area'
  )),
  is_builtin boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.location_leadership_roles(role_key, name, description, location_type, is_builtin)
values
  ('state_head', 'State Head', 'Coordinates newsroom operations for a state.', 'state', true),
  ('regional_head', 'Regional Head', 'Coordinates newsroom operations for a region.', 'region', true),
  ('zonal_head', 'Zonal Head', 'Coordinates newsroom operations for a zone.', 'zone', true),
  ('range_head', 'Range Head', 'Coordinates newsroom operations for a range.', 'range', true),
  ('district_head', 'District Head', 'Coordinates newsroom operations for a district.', 'district', true),
  ('coverage_area_head', 'Coverage Area Head', 'Coordinates newsroom operations for a coverage area.', 'coverage_area', true)
on conflict (role_key) do nothing;

create table public.location_leadership_assignments (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.location_leadership_roles(id) on delete restrict,
  location_id bigint not null references public.locations(id) on delete restrict,
  person_id uuid not null references public.profiles(id) on delete restrict,
  appointment_type text not null check (appointment_type in ('permanent', 'acting')),
  valid_from timestamptz not null,
  valid_to timestamptz,
  ended_at timestamptz,
  cancelled_at timestamptz,
  assignment_reason text not null check (length(trim(assignment_reason)) between 2 and 1000),
  end_reason text not null default '' check (length(end_reason) <= 1000),
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  check (appointment_type <> 'acting' or valid_to is not null),
  check (ended_at is null or ended_at > valid_from),
  check (ended_at is null or length(trim(end_reason)) >= 2),
  check (cancelled_at is null or length(trim(end_reason)) >= 2),
  check (ended_at is null or cancelled_at is null)
);

create index location_leadership_assignments_location_history_idx
  on public.location_leadership_assignments(location_id, role_id, valid_from desc);
create index location_leadership_assignments_person_history_idx
  on public.location_leadership_assignments(person_id, valid_from desc);

create or replace function public.chowk_location_leadership_person_is_eligible(target_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = target_person
      and (
        exists (
          select 1
          from public.hr_employees employee
          join public.hr_employee_assignments assignment
            on assignment.employee_id = employee.id and assignment.status = 'active'
          where employee.id = profile.id and employee.employment_status = 'active'
        )
        or (
          profile.role = 'reporter'
          and exists (
            select 1 from public.reporter_profiles reporter
            join public.reporter_assignments assignment
              on assignment.user_id = reporter.user_id and assignment.effective_to is null
            where reporter.user_id = profile.id
          )
        )
        or (
          profile.role in ('moderator', 'editor')
          and exists (
            select 1 from public.staff_onboarding onboarding
            join public.staff_role_assignments assignment
              on assignment.user_id = onboarding.user_id and assignment.status = 'active'
            where onboarding.user_id = profile.id
              and onboarding.status = 'active'
              and onboarding.requested_role = profile.role
          )
        )
      )
  );
$$;

create or replace function public.chowk_location_leadership_validate_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_type text;
  location_row public.locations%rowtype;
begin
  if tg_op = 'INSERT' then
    select role.location_type into role_type
    from public.location_leadership_roles role
    where role.id = new.role_id and role.is_active;
    if role_type is null then
      raise exception 'Choose an active geographic leadership role' using errcode = '23514';
    end if;

    select * into location_row
    from public.locations location
    where location.id = new.location_id and location.is_active;
    if location_row.id is null or location_row.location_type <> role_type then
      raise exception 'The role must be assigned to an active location of its configured level'
        using errcode = '23514';
    end if;

    if not public.chowk_location_leadership_person_is_eligible(new.person_id) then
      raise exception 'Choose an active HR employee or active newsroom contributor'
        using errcode = '23514';
    end if;
  else
    if new.role_id is distinct from old.role_id
        or new.location_id is distinct from old.location_id
        or new.person_id is distinct from old.person_id
        or new.appointment_type is distinct from old.appointment_type
        or new.valid_from is distinct from old.valid_from
        or new.valid_to is distinct from old.valid_to
        or new.assignment_reason is distinct from old.assignment_reason
        or new.assigned_by is distinct from old.assigned_by
        or new.created_at is distinct from old.created_at then
      raise exception 'Leadership appointment details are immutable; end it and create a new appointment'
        using errcode = '23514';
    end if;
    if old.ended_at is not null or old.cancelled_at is not null then
      raise exception 'Ended or cancelled appointments are immutable' using errcode = '23514';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    new.location_id::text || ':' || new.role_id::text || ':' || new.appointment_type,
    0
  ));

  if new.cancelled_at is null and exists (
    select 1
    from public.location_leadership_assignments other
    where other.location_id = new.location_id
      and other.role_id = new.role_id
      and other.appointment_type = new.appointment_type
      and other.id <> new.id
      and other.cancelled_at is null
      and tstzrange(
        other.valid_from,
        least(
          coalesce(other.valid_to, 'infinity'::timestamptz),
          coalesce(other.ended_at, 'infinity'::timestamptz)
        ),
        '[)'
      ) && tstzrange(
        new.valid_from,
        least(
          coalesce(new.valid_to, 'infinity'::timestamptz),
          coalesce(new.ended_at, 'infinity'::timestamptz)
        ),
        '[)'
      )
  ) then
    raise exception 'This territory already has an overlapping appointment for that role and appointment type'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger location_leadership_assignments_validate
  before insert or update on public.location_leadership_assignments
  for each row execute function public.chowk_location_leadership_validate_assignment();
create trigger location_leadership_roles_audit
  after insert or update on public.location_leadership_roles
  for each row execute function public.chowk_audit_row();
create trigger location_leadership_assignments_audit
  after insert or update on public.location_leadership_assignments
  for each row execute function public.chowk_audit_row();

create or replace function public.chowk_location_leadership_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.chowk_org_user_has_capability('newsroom.locations.manage') then
    raise exception 'Location management permission required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', role.id, 'role_key', role.role_key, 'name', role.name,
        'description', role.description, 'location_type', role.location_type,
        'is_builtin', role.is_builtin, 'is_active', role.is_active
      ) order by role.location_type, role.name)
      from public.location_leadership_roles role
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', location.id, 'name', location.name,
        'location_type', location.location_type, 'parent_id', location.parent_id,
        'is_active', location.is_active
      ) order by location.location_type, location.name)
      from public.locations location
    ), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', profile.id, 'full_name', profile.full_name,
        'email', profile.email, 'role', profile.role,
        'relationship', case
          when exists (
            select 1 from public.hr_employees employee
            join public.hr_employee_assignments assignment
              on assignment.employee_id = employee.id and assignment.status = 'active'
            where employee.id = profile.id and employee.employment_status = 'active'
          ) then 'HR employee'
          else 'Newsroom contributor'
        end
      ) order by profile.full_name, profile.email)
      from public.profiles profile
      where public.chowk_location_leadership_person_is_eligible(profile.id)
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', assignment.id, 'role_id', assignment.role_id,
        'role_name', role.name, 'role_key', role.role_key,
        'location_id', assignment.location_id, 'location_name', location.name,
        'location_type', location.location_type, 'parent_id', location.parent_id,
        'person_id', assignment.person_id, 'person_name', profile.full_name,
        'person_email', profile.email, 'person_role', profile.role,
        'appointment_type', assignment.appointment_type,
        'valid_from', assignment.valid_from, 'valid_to', assignment.valid_to,
        'ended_at', assignment.ended_at, 'cancelled_at', assignment.cancelled_at,
        'assignment_reason', assignment.assignment_reason,
        'end_reason', assignment.end_reason, 'assigned_by', assignment.assigned_by,
        'created_at', assignment.created_at,
        'appointment_state', case
          when assignment.cancelled_at is not null then 'cancelled'
          when least(
            coalesce(assignment.valid_to, 'infinity'::timestamptz),
            coalesce(assignment.ended_at, 'infinity'::timestamptz)
          ) <= now() then 'ended'
          when assignment.valid_from > now() then 'scheduled'
          else 'active'
        end
      ) order by assignment.valid_from desc)
      from public.location_leadership_assignments assignment
      join public.location_leadership_roles role on role.id = assignment.role_id
      join public.locations location on location.id = assignment.location_id
      join public.profiles profile on profile.id = assignment.person_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.chowk_location_leadership_save_role(
  target_id uuid,
  target_key text,
  target_name text,
  target_description text,
  target_location_type text,
  target_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.location_leadership_roles%rowtype;
  saved_id uuid;
begin
  if not public.chowk_org_user_has_capability('newsroom.locations.manage') then
    raise exception 'Location management permission required' using errcode = '42501';
  end if;
  if target_key is null or target_key !~ '^[a-z][a-z0-9_]{1,49}$'
      or target_name is null or length(trim(target_name)) not between 2 and 100
      or length(coalesce(target_description, '')) > 2000
      or target_location_type is null
      or target_location_type not in ('state', 'region', 'zone', 'range', 'district', 'coverage_area')
      or target_is_active is null then
    raise exception 'Enter a valid role key, name, location level, description, and status'
      using errcode = '22023';
  end if;

  if target_id is null then
    insert into public.location_leadership_roles(
      role_key, name, description, location_type, is_active, created_by
    ) values (
      target_key, trim(target_name), trim(coalesce(target_description, '')),
      target_location_type, target_is_active, (select auth.uid())
    ) returning id into saved_id;
  else
    select * into existing from public.location_leadership_roles
    where id = target_id for update;
    if not found then raise exception 'Leadership role not found' using errcode = 'P0002'; end if;
    if existing.is_builtin and (
      existing.role_key <> target_key or existing.location_type <> target_location_type
    ) then
      raise exception 'Built-in leadership role keys and location levels cannot be changed'
        using errcode = '23514';
    end if;
    if existing.location_type <> target_location_type and exists (
      select 1 from public.location_leadership_assignments where role_id = target_id
    ) then
      raise exception 'A role with appointment history cannot be moved to another location level'
        using errcode = '23514';
    end if;
    update public.location_leadership_roles
    set role_key = target_key, name = trim(target_name),
        description = trim(coalesce(target_description, '')),
        location_type = target_location_type, is_active = target_is_active,
        updated_at = now()
    where id = target_id returning id into saved_id;
  end if;
  return saved_id;
end;
$$;

create or replace function public.chowk_location_leadership_save_appointment(
  target_role uuid,
  target_location bigint,
  target_person uuid,
  target_appointment_type text,
  target_valid_from timestamptz,
  target_valid_to timestamptz,
  target_reason text,
  target_replace_assignment uuid default null,
  target_replace_reason text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  replaced public.location_leadership_assignments%rowtype;
  saved_id uuid;
begin
  if not public.chowk_org_user_has_capability('newsroom.locations.manage') then
    raise exception 'Location management permission required' using errcode = '42501';
  end if;
  if target_role is null or target_location is null or target_person is null
      or target_appointment_type is null
      or target_appointment_type not in ('permanent', 'acting')
      or target_valid_from is null
      or (target_valid_to is not null and target_valid_to <= target_valid_from)
      or (target_appointment_type = 'acting' and target_valid_to is null)
      or length(trim(coalesce(target_reason, ''))) not between 2 and 1000 then
    raise exception 'Enter a valid appointment type, date range, and reason'
      using errcode = '22023';
  end if;

  if target_replace_assignment is not null then
    select * into replaced from public.location_leadership_assignments
    where id = target_replace_assignment for update;
    if not found or replaced.role_id <> target_role
        or replaced.location_id <> target_location
        or replaced.appointment_type <> target_appointment_type
        or replaced.cancelled_at is not null
        or least(
          coalesce(replaced.valid_to, 'infinity'::timestamptz),
          coalesce(replaced.ended_at, 'infinity'::timestamptz)
        ) <= target_valid_from
        or replaced.valid_from >= target_valid_from
        or length(trim(coalesce(target_replace_reason, ''))) not between 2 and 1000 then
      raise exception 'Choose the overlapping appointment to replace and provide a reason'
        using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    target_location::text || ':' || target_role::text || ':' || target_appointment_type,
    0
  ));

  if target_replace_assignment is not null then
    update public.location_leadership_assignments
    set ended_at = target_valid_from, end_reason = trim(target_replace_reason)
    where id = replaced.id;
  end if;

  insert into public.location_leadership_assignments(
    role_id, location_id, person_id, appointment_type, valid_from, valid_to,
    assignment_reason, assigned_by
  ) values (
    target_role, target_location, target_person, target_appointment_type,
    target_valid_from, target_valid_to, trim(target_reason), (select auth.uid())
  ) returning id into saved_id;
  return saved_id;
end;
$$;

create or replace function public.chowk_location_leadership_end_appointment(
  target_assignment uuid,
  target_end_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.location_leadership_assignments%rowtype;
begin
  if not public.chowk_org_user_has_capability('newsroom.locations.manage') then
    raise exception 'Location management permission required' using errcode = '42501';
  end if;
  if length(trim(coalesce(target_end_reason, ''))) not between 2 and 1000 then
    raise exception 'Provide a reason for ending this appointment' using errcode = '22023';
  end if;
  select * into existing from public.location_leadership_assignments
  where id = target_assignment for update;
  if not found then raise exception 'Leadership appointment not found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    existing.location_id::text || ':' || existing.role_id::text || ':' || existing.appointment_type,
    0
  ));
  if existing.ended_at is not null or existing.cancelled_at is not null
      or least(
        coalesce(existing.valid_to, 'infinity'::timestamptz),
        coalesce(existing.ended_at, 'infinity'::timestamptz)
      ) <= now() then
    raise exception 'This appointment is already ended or cancelled' using errcode = '23514';
  end if;

  if existing.valid_from > now() then
    update public.location_leadership_assignments
    set cancelled_at = now(), end_reason = trim(target_end_reason)
    where id = target_assignment;
  else
    update public.location_leadership_assignments
    set ended_at = now(), end_reason = trim(target_end_reason)
    where id = target_assignment;
  end if;
end;
$$;

alter table public.location_leadership_roles enable row level security;
alter table public.location_leadership_assignments enable row level security;
revoke all on public.location_leadership_roles, public.location_leadership_assignments
  from anon, authenticated;
grant select on public.location_leadership_roles, public.location_leadership_assignments
  to authenticated;

revoke all on function public.chowk_location_leadership_person_is_eligible(uuid),
  public.chowk_location_leadership_validate_assignment(),
  public.chowk_location_leadership_snapshot(),
  public.chowk_location_leadership_save_role(uuid,text,text,text,text,boolean),
  public.chowk_location_leadership_save_appointment(uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid,text),
  public.chowk_location_leadership_end_appointment(uuid,text)
  from public, anon;
grant execute on function public.chowk_location_leadership_snapshot(),
  public.chowk_location_leadership_save_role(uuid,text,text,text,text,boolean),
  public.chowk_location_leadership_save_appointment(uuid,bigint,uuid,text,timestamptz,timestamptz,text,uuid,text),
  public.chowk_location_leadership_end_appointment(uuid,text)
  to authenticated;

commit;
