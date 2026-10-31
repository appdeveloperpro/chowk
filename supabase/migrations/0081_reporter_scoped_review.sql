begin;

alter table public.locations
  drop constraint if exists locations_location_type_check;

alter table public.locations
  add constraint locations_location_type_check
  check (location_type in (
    'state', 'region', 'zone', 'range', 'district', 'tehsil', 'block', 'city', 'coverage_area'
  ));

create or replace function public.chowk_validate_location_hierarchy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_type text;
  expected_state_id bigint;
  existing_state_id bigint;
  expected_zone_id bigint;
  parent_zone_id bigint;
begin
  if tg_op = 'UPDATE' and (old.location_type = 'city' or new.location_type = 'city') then
    if old.location_type = 'city'
       and new.location_type = 'city'
       and new.parent_id is not distinct from old.parent_id then
      select location_type into parent_type
      from public.locations where id = old.parent_id;
      if parent_type is distinct from 'district' then
        raise exception 'Legacy city records must remain attached to their original district'
          using errcode = '23514';
      end if;
      if new.is_active and not exists (
        select 1 from public.locations where id = old.parent_id and is_active
      ) then
        raise exception 'Activate the parent location before activating this legacy city'
          using errcode = '23514';
      end if;
      return new;
    end if;
    raise exception 'City locations are legacy records and cannot be created or moved; use a coverage area'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' and new.location_type = 'city' then
    raise exception 'City locations are no longer created; use a coverage area'
      using errcode = '23514';
  end if;

  if new.parent_id is null then
    if new.location_type <> 'state' then
      raise exception 'Only a state can be a top-level location' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'A location cannot be its own parent' using errcode = '23514';
  end if;

  select location_type into parent_type
  from public.locations where id = new.parent_id;
  if parent_type is null then
    raise exception 'Choose an existing parent location' using errcode = '23514';
  end if;
  if not (
    (new.location_type = 'region' and parent_type = 'state')
    or (new.location_type = 'zone' and parent_type = 'region')
    or (new.location_type = 'range' and parent_type = 'zone')
    or (new.location_type = 'district' and parent_type = 'range')
    or (new.location_type = 'tehsil' and parent_type = 'district')
    or (new.location_type = 'block' and parent_type in ('district', 'tehsil'))
    or (new.location_type = 'coverage_area' and parent_type in ('district', 'tehsil', 'block'))
  ) then
    raise exception 'Use State > Region > Zone > Range > District > Tehsil > Block > Coverage area; Tehsil, Block, and Coverage area can be used where applicable'
      using errcode = '23514';
  end if;

  if new.is_active and exists (
    with recursive ancestors(id, parent_id, is_active, visited) as (
      select parent.id, parent.parent_id, parent.is_active, array[new.id, parent.id]
      from public.locations parent where parent.id = new.parent_id
      union all
      select parent.id, parent.parent_id, parent.is_active, ancestors.visited || parent.id
      from ancestors
      join public.locations parent on parent.id = ancestors.parent_id
      where not parent.id = any(ancestors.visited)
    )
    select 1 from ancestors where not is_active
  ) then
    raise exception 'Activate the full parent chain before activating this location'
      using errcode = '23514';
  end if;

  if new.location_type = 'district' then
    with recursive ancestors(id, parent_id, location_type, visited) as (
      select parent.id, parent.parent_id, parent.location_type, array[new.parent_id, parent.id]
      from public.locations parent where parent.id = new.parent_id
      union all
      select parent.id, parent.parent_id, parent.location_type, ancestors.visited || parent.id
      from ancestors
      join public.locations parent on parent.id = ancestors.parent_id
      where not parent.id = any(ancestors.visited)
    )
    select
      (select id from ancestors where location_type = 'state' limit 1),
      (select id from ancestors where location_type = 'zone' limit 1)
    into expected_state_id, parent_zone_id;
    if expected_state_id is null or parent_zone_id is null then
      raise exception 'The district range must belong to a zone within a state' using errcode = '23514';
    end if;

    if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id then
      select mapping.zone_id into expected_zone_id
      from (
        select zone_id from public.zone_districts
        where district_id = new.id order by valid_from desc, id desc limit 1
      ) mapping;
      if expected_zone_id is null and exists (
        select 1 from public.locations old_range
        where old_range.id = old.parent_id and old_range.location_type = 'range'
      ) then
        with recursive ancestors(id, parent_id, location_type, visited) as (
          select parent.id, parent.parent_id, parent.location_type, array[old.id, parent.id]
          from public.locations parent where parent.id = old.parent_id
          union all
          select parent.id, parent.parent_id, parent.location_type, ancestors.visited || parent.id
          from ancestors
          join public.locations parent on parent.id = ancestors.parent_id
          where not parent.id = any(ancestors.visited)
        )
        select id into expected_zone_id from ancestors
        where location_type = 'zone' limit 1;
      end if;
      if expected_zone_id is not null and expected_zone_id is distinct from parent_zone_id then
        raise exception 'The district must remain in its mapped zone; update its zone mapping through an audited reassignment first.'
          using errcode = '23514';
      end if;
      with recursive ancestors(id, parent_id, location_type, visited) as (
        select parent.id, parent.parent_id, parent.location_type, array[old.id, parent.id]
        from public.locations parent where parent.id = old.parent_id
        union all
        select parent.id, parent.parent_id, parent.location_type, ancestors.visited || parent.id
        from ancestors
        join public.locations parent on parent.id = ancestors.parent_id
        where not parent.id = any(ancestors.visited)
      )
      select id into existing_state_id from ancestors
      where location_type = 'state' limit 1;
      if existing_state_id is not null and existing_state_id <> expected_state_id then
        raise exception 'A district and its new range must belong to the same state'
          using errcode = '23514';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' and exists (
    with recursive descendants(id, visited) as (
      select old.id, array[old.id]
      union all
      select child.id, descendants.visited || child.id
      from descendants
      join public.locations child on child.parent_id = descendants.id
      where not child.id = any(descendants.visited)
    )
    select 1 from descendants where id = new.parent_id
  ) then
    raise exception 'A location cannot be moved beneath one of its descendants' using errcode = '23514';
  end if;
  return new;
end;
$$;

alter table public.location_leadership_roles
  drop constraint if exists location_leadership_roles_location_type_check;
alter table public.location_leadership_roles
  add constraint location_leadership_roles_location_type_check
  check (location_type in (
    'state', 'region', 'zone', 'range', 'district', 'tehsil', 'block', 'coverage_area'
  ));

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
      or target_location_type not in (
        'state', 'region', 'zone', 'range', 'district', 'tehsil', 'block', 'coverage_area'
      )
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
    if not found then
      raise exception 'Leadership role not found' using errcode = 'P0002';
    end if;
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

insert into public.organization_permission_catalog(permission_key, area, description, is_active)
values (
  'reporters.applications.review',
  'People',
  'Review reporter applications within explicitly assigned geographic scopes.',
  true
)
on conflict (permission_key) do update
set area = excluded.area, description = excluded.description, is_active = true;

alter table public.staff_role_permissions
  add constraint staff_role_permissions_reporter_review_scope_check
  check (permission_key <> 'reporters.applications.review' or scope = 'all');

create table public.reporter_application_review_scopes (
  id bigint generated by default as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  location_id bigint not null references public.locations(id) on delete restrict,
  is_active boolean not null default true,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, location_id)
);

create index reporter_application_review_scopes_active_user_idx
  on public.reporter_application_review_scopes(user_id, location_id)
  where is_active;

alter table public.reporter_application_review_scopes enable row level security;
revoke all on public.reporter_application_review_scopes from anon, authenticated;
grant select on public.reporter_application_review_scopes to authenticated;
create policy "Super admins view reporter review scopes"
  on public.reporter_application_review_scopes for select to authenticated
  using ((select public.chowk_has_any_role(array['super_admin'])));

create trigger reporter_application_review_scopes_updated_at
  before update on public.reporter_application_review_scopes
  for each row execute function public.chowk_set_updated_at();
create trigger reporter_application_review_scopes_audit
  after insert or update on public.reporter_application_review_scopes
  for each row execute function public.chowk_audit_row();

create or replace function public.chowk_org_permission_module_enabled(target_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when target_permission like 'hr.%'
      then public.chowk_org_module_is_enabled('human-resources')
    when target_permission like 'newsroom.articles.%'
      or target_permission = 'newsroom.categories.manage'
      then public.chowk_org_module_is_enabled('newsroom')
    when target_permission = 'newsroom.media.manage'
      then public.chowk_org_module_is_enabled('media')
    when target_permission in ('newsroom.comments.moderate', 'newsroom.reports.manage')
      then public.chowk_org_module_is_enabled('moderation')
    when target_permission = 'newsroom.locations.manage'
      then public.chowk_org_module_is_enabled('locations')
    when target_permission in ('reporters.manage', 'reporters.applications.review')
      then public.chowk_org_module_is_enabled('reporters')
    else true
  end;
$$;

create or replace function public.chowk_user_can_review_reporter_application(target_application bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then false
    when exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role in ('admin', 'super_admin')
    ) then true
    when not public.chowk_org_user_has_capability('reporters.applications.review') then false
    else exists (
      with recursive target_locations(location_id) as (
        select details.coverage_area_id
        from public.reporter_applications application
        join public.reporter_application_private_details details
          on details.application_id = application.id
        join public.rto_offices office on office.id = application.rto_office_id
        where application.id = target_application
          and details.coverage_area_id is not null
          and exists (
            with recursive ancestors(id, parent_id, visited) as (
              select location.id, location.parent_id, array[location.id]
              from public.locations location
              where location.id = details.coverage_area_id
              union all
              select parent.id, parent.parent_id, ancestors.visited || parent.id
              from ancestors
              join public.locations parent on parent.id = ancestors.parent_id
              where not parent.id = any(ancestors.visited)
            )
            select 1 from ancestors where id = office.location_id
          )
        union
        select office.location_id
        from public.reporter_applications application
        join public.rto_offices office on office.id = application.rto_office_id
        where application.id = target_application
          and office.location_id is not null
          and not exists (
            select 1 from public.reporter_application_private_details details
            where details.application_id = application.id
              and details.coverage_area_id is not null
          )
      ),
      location_path(id, parent_id, visited) as (
        select location.id, location.parent_id, array[location.id]
        from target_locations target
        join public.locations location on location.id = target.location_id
        union all
        select parent.id, parent.parent_id, path.visited || parent.id
        from location_path path
        join public.locations parent on parent.id = path.parent_id
        where not parent.id = any(path.visited)
      )
      select 1
      from public.reporter_application_review_scopes scope
      join public.locations scope_location
        on scope_location.id = scope.location_id and scope_location.is_active
      join location_path path on path.id = scope.location_id
      where scope.user_id = (select auth.uid())
        and scope.is_active
    )
  end;
$$;

create or replace function public.chowk_reporter_review_scope_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
      or not (select public.chowk_has_any_role(array['super_admin'])) then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'reviewers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', profile.id,
        'full_name', profile.full_name,
        'email', profile.email,
        'role_name', definition.display_name
      ) order by profile.full_name, profile.email)
      from public.staff_role_assignments assignment
      join public.staff_role_definitions definition
        on definition.id = assignment.staff_role_id and definition.is_active
      join public.staff_role_permissions permission
        on permission.staff_role_id = definition.id
       and permission.permission_key = 'reporters.applications.review'
      join public.profiles profile on profile.id = assignment.user_id
      join public.organization_people person
        on person.person_id = assignment.user_id
       and person.source_type = 'staff_role_assignment'
       and person.source_id = assignment.id::text
       and person.status = 'active' and person.ends_at is null
      where assignment.status = 'active'
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', location.id, 'name', location.name,
        'location_type', location.location_type, 'parent_id', location.parent_id
      ) order by location.location_type, location.name)
      from public.locations location
      where location.is_active and location.location_type <> 'city'
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', scope.id, 'user_id', scope.user_id, 'location_id', scope.location_id,
        'is_active', scope.is_active, 'assigned_by', scope.assigned_by,
        'created_at', scope.created_at,
        'reviewer_name', profile.full_name, 'reviewer_email', profile.email,
        'role_name', definition.display_name, 'location_name', location.name,
        'location_type', location.location_type
      ) order by scope.is_active desc, location.name, profile.full_name)
      from public.reporter_application_review_scopes scope
      join public.profiles profile on profile.id = scope.user_id
      join public.locations location on location.id = scope.location_id
      left join lateral (
        select role.display_name
        from public.staff_role_assignments assignment
        join public.staff_role_definitions role on role.id = assignment.staff_role_id
        join public.staff_role_permissions permission
          on permission.staff_role_id = role.id
         and permission.permission_key = 'reporters.applications.review'
        where assignment.user_id = scope.user_id and assignment.status = 'active'
        order by assignment.assigned_at desc limit 1
      ) definition on true
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.chowk_admin_save_reporter_review_scope(
  target_user uuid,
  target_location bigint,
  target_is_active boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id bigint;
begin
  if (select auth.uid()) is null
      or not (select public.chowk_has_any_role(array['super_admin'])) then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  if target_is_active is null then
    raise exception 'Choose whether the reviewer scope is active' using errcode = '22023';
  end if;
  if target_user is null or target_location is null then
    raise exception 'Choose a reviewer and location scope' using errcode = '22023';
  end if;
  if not target_is_active then
    update public.reporter_application_review_scopes
    set is_active = false, assigned_by = (select auth.uid())
    where user_id = target_user and location_id = target_location
    returning id into saved_id;
    if saved_id is null then
      raise exception 'An existing reviewer scope is required before it can be removed'
        using errcode = 'P0002';
    end if;
    return saved_id;
  end if;
  if not exists (
        select 1
        from public.staff_role_assignments assignment
        join public.staff_role_definitions definition
          on definition.id = assignment.staff_role_id and definition.is_active
        join public.staff_role_permissions permission
          on permission.staff_role_id = definition.id
         and permission.permission_key = 'reporters.applications.review'
        join public.organization_people person
          on person.person_id = assignment.user_id
         and person.source_type = 'staff_role_assignment'
         and person.source_id = assignment.id::text
         and person.status = 'active' and person.ends_at is null
        where assignment.user_id = target_user and assignment.status = 'active'
      ) then
    raise exception 'Choose an active staff member with the Reporter Application Reviewer access role'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.locations
    where id = target_location and is_active and location_type <> 'city'
  ) then
    raise exception 'Choose an active location for the reviewer scope' using errcode = '22023';
  end if;
  insert into public.reporter_application_review_scopes(
    user_id, location_id, is_active, assigned_by
  ) values (target_user, target_location, coalesce(target_is_active, true), (select auth.uid()))
  on conflict (user_id, location_id) do update
    set is_active = excluded.is_active, assigned_by = excluded.assigned_by
  returning id into saved_id;
  return saved_id;
end;
$$;

create or replace function public.chowk_admin_review_reporter_application_scoped(
  target_application bigint,
  decision text,
  note text,
  signer_name text,
  signer_designation text,
  signature_accepted boolean,
  requested_fields jsonb,
  target_designation bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_profile public.profiles%rowtype;
  application_row public.reporter_applications%rowtype;
  rto public.rto_offices%rowtype;
  state_row public.states%rowtype;
  reporter_type public.reporter_types%rowtype;
  issued_number integer;
  new_code text;
  item jsonb;
  expected_designation text;
begin
  if actor is null or not public.chowk_user_can_review_reporter_application(target_application) then
    raise exception 'You are not assigned to review this application location'
      using errcode = '42501';
  end if;
  if decision not in ('approved', 'rejected', 'needs_information')
      or jsonb_typeof(requested_fields) is distinct from 'array'
      or jsonb_array_length(requested_fields) > 40 then
    raise exception 'Choose a valid decision and provide no more than 40 field requests'
      using errcode = '22023';
  end if;
  if decision <> 'needs_information' and jsonb_array_length(requested_fields) > 0 then
    raise exception 'Field requests are only allowed when requesting more information'
      using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(requested_fields)
  loop
    if jsonb_typeof(item) is distinct from 'object'
        or coalesce(item ->> 'field', '') not in (
          'state_id', 'rto_office_id', 'mobile_number', 'date_of_birth',
          'emergency_contact_name', 'emergency_contact_relationship',
          'emergency_contact_phone', 'blood_group', 'preferred_language',
          'coverage_area_id', 'coverage_localities', 'experience_years',
          'experience_summary', 'availability', 'bank_account_holder',
          'bank_name', 'bank_account_number', 'bank_ifsc', 'profile_photo',
          'aadhaar_front', 'aadhaar_back', 'pan_card', 'bank_proof',
          'father_first_name', 'father_last_name', 'permanent_address_line1',
          'permanent_address_line2', 'permanent_address_city',
          'permanent_address_district', 'permanent_address_state',
          'permanent_address_postal_code'
        )
        or coalesce(item ->> 'kind', '') not in ('correction', 'reupload', 'other')
        or length(trim(coalesce(item ->> 'instruction', ''))) not between 2 and 500
        or (item ->> 'kind' = 'reupload' and item ->> 'field' not in (
          'profile_photo', 'aadhaar_front', 'aadhaar_back', 'pan_card', 'bank_proof'
        ))
        or (item ->> 'kind' = 'correction' and item ->> 'field' in (
          'profile_photo', 'aadhaar_front', 'aadhaar_back', 'pan_card', 'bank_proof'
        )) then
      raise exception 'Each field request needs a valid field, action and instruction'
        using errcode = '22023';
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(requested_fields) as request(item)
    group by item ->> 'field' having count(*) > 1
  ) then
    raise exception 'Each field can only be requested once' using errcode = '22023';
  end if;
  if decision in ('rejected', 'needs_information')
      and length(trim(coalesce(note, ''))) < 2 then
    raise exception 'A clear applicant-facing note is required for this decision'
      using errcode = '22023';
  end if;
  if decision = 'needs_information' and jsonb_array_length(requested_fields) = 0 then
    raise exception 'Select at least one field to request'
      using errcode = '22023';
  end if;

  select * into application_row
  from public.reporter_applications
  where id = target_application for update;
  if not found or application_row.status not in ('pending', 'needs_information') then
    raise exception 'Only an application awaiting review can be reviewed'
      using errcode = '23514';
  end if;
  if not public.chowk_user_can_review_reporter_application(target_application) then
    raise exception 'You are not assigned to review this application location'
      using errcode = '42501';
  end if;

  select * into actor_profile from public.profiles where id = actor;
  if length(trim(coalesce(actor_profile.full_name, ''))) < 2 then
    raise exception 'Complete your account name before reviewing applications'
      using errcode = '22023';
  end if;
  expected_designation := case actor_profile.role
    when 'super_admin' then 'Super Administrator'
    when 'admin' then 'Administrator'
    else (
      select definition.display_name
      from public.staff_role_assignments assignment
      join public.staff_role_definitions definition
        on definition.id = assignment.staff_role_id and definition.is_active
      join public.staff_role_permissions permission
        on permission.staff_role_id = definition.id
       and permission.permission_key = 'reporters.applications.review'
      where assignment.user_id = actor and assignment.status = 'active'
      order by assignment.assigned_at desc limit 1
    )
  end;
  if decision = 'approved' then
    if length(trim(coalesce(signer_name, ''))) < 2
        or lower(trim(signer_name)) <> lower(trim(actor_profile.full_name))
        or expected_designation is null
        or not coalesce(signature_accepted, false)
        or target_designation is null then
      raise exception 'Approver attestation and reporter designation are required'
        using errcode = '22023';
    end if;
    select * into rto from public.rto_offices
    where id = application_row.rto_office_id and is_active;
    select * into state_row from public.states
    where id = application_row.state_id and is_active;
    select * into reporter_type from public.reporter_types
    where id = application_row.reporter_type_id and is_active;
    if rto.id is null or state_row.id is null or reporter_type.id is null
        or rto.state_id <> state_row.id
        or not exists (
          select 1 from public.reporter_designations
          where id = target_designation and is_active
        ) then
      raise exception 'Application location or reporter designation is no longer active'
        using errcode = '23514';
    end if;
    update public.reporter_applications
    set reporter_designation_id = target_designation
    where id = application_row.id;
    insert into public.reporter_code_counters(rto_office_id, reporter_type_id)
    values (rto.id, reporter_type.id)
    on conflict do nothing;
    update public.reporter_code_counters
    set next_number = next_number + 1
    where rto_office_id = rto.id and reporter_type_id = reporter_type.id
    returning next_number - 1 into issued_number;
    if issued_number > 9999 then
      raise exception 'Reporter ID sequence is exhausted for this RTO and reporter type'
        using errcode = '22003';
    end if;
    new_code := lower(
      state_row.state_code || rto.rto_code || '-' || reporter_type.type_code || '-'
      || lpad(issued_number::text, 4, '0')
    );
    insert into public.reporter_profiles(user_id, reporter_code)
    values (application_row.user_id, new_code)
    on conflict (user_id) do nothing;
    if not exists (
      select 1 from public.reporter_assignments
      where user_id = application_row.user_id and effective_to is null
    ) then
      insert into public.reporter_assignments(
        user_id, rto_office_id, reporter_type_id, reporter_designation_id, assigned_by
      ) values (
        application_row.user_id, rto.id, reporter_type.id, target_designation, actor
      );
    end if;
  end if;

  update public.reporter_applications
  set status = decision,
      review_note = trim(coalesce(note, '')),
      review_requests = case when decision = 'needs_information' then requested_fields else '[]'::jsonb end,
      reviewed_by = actor,
      reviewed_at = now(),
      company_signer_name = case when decision = 'approved' then trim(signer_name) else null end,
      company_signer_designation = case when decision = 'approved' then expected_designation else null end,
      company_signature_accepted = decision = 'approved' and coalesce(signature_accepted, false),
      company_signed_at = case when decision = 'approved' then now() else null end,
      company_signature_statement = case when decision = 'approved'
        then 'Authorized approver attests to this application decision; this record is not a cryptographic signature.'
        else null end
  where id = target_application;
end;
$$;

drop policy if exists "Users view own applications and staff review all"
  on public.reporter_applications;
create policy "Applicants and assigned reviewers view applications"
  on public.reporter_applications for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.chowk_user_can_review_reporter_application(id)
  );

drop policy if exists "Applicants and admins view private reporter application details"
  on public.reporter_application_private_details;
create policy "Applicants and assigned reviewers view private reporter application details"
  on public.reporter_application_private_details for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.chowk_user_can_review_reporter_application(application_id)
  );

drop policy if exists "Applicants and admins view reporter application documents"
  on public.reporter_application_documents;
create policy "Applicants and assigned reviewers view reporter application documents"
  on public.reporter_application_documents for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.chowk_user_can_review_reporter_application(application_id)
  );

drop policy if exists "Admins view reporter application documents" on storage.objects;
create policy "Assigned reviewers view application document objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chowk-reporter-applications'
    and exists (
      select 1
      from public.reporter_application_documents document
      where document.storage_path = storage.objects.name
        and public.chowk_user_can_review_reporter_application(document.application_id)
    )
  );

revoke all on function public.chowk_user_can_review_reporter_application(bigint)
  from public, anon;
revoke all on function public.chowk_reporter_review_scope_snapshot()
  from public, anon;
revoke all on function public.chowk_admin_save_reporter_review_scope(uuid, bigint, boolean)
  from public, anon;
revoke all on function public.chowk_admin_review_reporter_application_scoped(
  bigint, text, text, text, text, boolean, jsonb, bigint
) from public, anon;
grant execute on function public.chowk_reporter_review_scope_snapshot(),
  public.chowk_admin_save_reporter_review_scope(uuid, bigint, boolean),
  public.chowk_user_can_review_reporter_application(bigint),
  public.chowk_admin_review_reporter_application_scoped(
    bigint, text, text, text, text, boolean, jsonb, bigint
  ) to authenticated;

commit;
