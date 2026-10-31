begin;

create or replace function public.chowk_reporter_review_scope_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
      or not (
        (select public.chowk_has_any_role(array['admin', 'super_admin']))
        or (select public.chowk_org_user_has_capability('reporters.manage'))
        or (select public.chowk_org_user_has_capability('newsroom.people.manage'))
      ) then
    raise exception 'Reporter or people manager access required' using errcode = '42501';
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
      or not (
        (select public.chowk_has_any_role(array['admin', 'super_admin']))
        or (select public.chowk_org_user_has_capability('reporters.manage'))
        or (select public.chowk_org_user_has_capability('newsroom.people.manage'))
      ) then
    raise exception 'Reporter or people manager access required' using errcode = '42501';
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
  ) values (target_user, target_location, true, (select auth.uid()))
  on conflict (user_id, location_id) do update
    set is_active = excluded.is_active, assigned_by = excluded.assigned_by
  returning id into saved_id;
  return saved_id;
end;
$$;

create or replace function public.chowk_reporter_territory_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  reporter_total bigint;
  pending_total bigint;
  needs_information_total bigint;
  reporter_rows jsonb;
  application_rows jsonb;
  scope_rows jsonb;
begin
  if actor is null
      or not (
        (select public.chowk_has_any_role(array['admin', 'super_admin']))
        or (select public.chowk_org_user_has_capability('reporters.applications.review'))
      ) then
    raise exception 'Reporter application reviewer access required' using errcode = '42501';
  end if;

  select count(*), coalesce(jsonb_agg(jsonb_build_object(
    'reporter_code', reporter.reporter_code,
    'full_name', profile.full_name,
    'email', profile.email,
    'reporter_type', reporter_type.name,
    'designation', designation.name,
    'location_name', coalesce(location.name, nullif(office.city_name, ''), 'Unassigned')
  ) order by profile.full_name, reporter.reporter_code), '[]'::jsonb)
  into reporter_total, reporter_rows
  from public.reporter_profiles reporter
  join public.profiles profile on profile.id = reporter.user_id
  join public.reporter_assignments assignment
    on assignment.user_id = reporter.user_id and assignment.effective_to is null
  join public.rto_offices office on office.id = assignment.rto_office_id
  left join public.locations location on location.id = office.location_id
  left join public.reporter_types reporter_type on reporter_type.id = assignment.reporter_type_id
  left join public.reporter_designations designation
    on designation.id = assignment.reporter_designation_id
  where exists (
    select 1
    from public.reporter_applications application
    where application.user_id = reporter.user_id
      and application.status in ('approved', 'active')
      and public.chowk_user_can_review_reporter_application(application.id)
  );

  select count(*) filter (where application.status = 'pending'),
         count(*) filter (where application.status = 'needs_information')
  into pending_total, needs_information_total
  from public.reporter_applications application
  where application.status in ('pending', 'needs_information')
    and public.chowk_user_can_review_reporter_application(application.id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', application.id,
           'status', application.status,
           'full_name', profile.full_name,
           'email', profile.email,
           'location_name', coalesce(coverage.name, location.name, nullif(office.city_name, ''), 'Unassigned')
         ) order by application.created_at desc), '[]'::jsonb)
  into application_rows
  from (
    select visible_application.*
    from public.reporter_applications visible_application
    where visible_application.status in ('pending', 'needs_information')
      and public.chowk_user_can_review_reporter_application(visible_application.id)
    order by visible_application.created_at desc
    limit 25
  ) application
  join public.profiles profile on profile.id = application.user_id
  left join public.rto_offices office on office.id = application.rto_office_id
  left join public.locations location on location.id = office.location_id
  left join public.reporter_application_private_details details
    on details.application_id = application.id
  left join public.locations coverage on coverage.id = details.coverage_area_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', location.id,
    'name', location.name,
    'location_type', location.location_type
  ) order by location.location_type, location.name), '[]'::jsonb)
  into scope_rows
  from public.reporter_application_review_scopes scope
  join public.locations location
    on location.id = scope.location_id and location.is_active
  where scope.user_id = actor and scope.is_active;

  return jsonb_build_object(
    'is_admin', (select public.chowk_has_any_role(array['admin', 'super_admin'])),
    'counts', jsonb_build_object(
      'active_reporters', reporter_total,
      'pending_applications', pending_total,
      'needs_information', needs_information_total
    ),
    'scopes', coalesce(scope_rows, '[]'::jsonb),
    'reporters', coalesce(reporter_rows, '[]'::jsonb),
    'pending_applications', coalesce(application_rows, '[]'::jsonb)
  );
end;
$$;

drop policy if exists "Staff and admins read staff role change requests"
  on public.staff_role_change_requests;
create policy "Staff and authorized people managers read staff role change requests"
  on public.staff_role_change_requests for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.chowk_has_any_role(array['admin', 'super_admin']))
    or (select public.chowk_org_user_has_capability('reporters.manage'))
    or (select public.chowk_org_user_has_capability('newsroom.people.manage'))
  );

drop policy if exists "Staff onboarding is visible to the member and authorized reviewers"
  on public.staff_onboarding;
create policy "Staff onboarding is visible to members and people managers"
  on public.staff_onboarding for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.chowk_has_any_role(array['admin', 'super_admin']))
    or (select public.chowk_org_user_has_capability('reporters.manage'))
    or (select public.chowk_org_user_has_capability('newsroom.people.manage'))
  );

drop policy if exists "Admins and authorized reviewers read staff role definitions"
  on public.staff_role_definitions;
create policy "Admins and authorized people managers read staff role definitions"
  on public.staff_role_definitions for select to authenticated
  using (
    (select public.chowk_has_any_role(array['admin', 'super_admin']))
    or exists (
      select 1 from public.staff_onboarding onboarding
      where onboarding.user_id = (select auth.uid())
        and onboarding.staff_role_id = staff_role_definitions.id
    )
    or exists (
      select 1 from public.staff_role_change_requests request
      where request.user_id = (select auth.uid())
        and request.target_staff_role_id = staff_role_definitions.id
        and request.status = 'pending'
    )
    or (select public.chowk_org_user_has_capability('reporters.manage'))
    or (select public.chowk_org_user_has_capability('newsroom.people.manage'))
  );

drop policy if exists "Staff and authorized reviewers read staff role assignments"
  on public.staff_role_assignments;
create policy "Staff and authorized people managers read staff role assignments"
  on public.staff_role_assignments for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.chowk_has_any_role(array['admin', 'super_admin']))
    or (select public.chowk_org_user_has_capability('reporters.manage'))
    or (select public.chowk_org_user_has_capability('newsroom.people.manage'))
  );

drop policy if exists "Profiles are visible to their owner, staff, and authorized reviewers"
  on public.profiles;
create policy "Profiles are visible to owners, managers, and assigned reporter reviewers"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.chowk_has_any_role(array['admin', 'super_admin']))
    or (select public.chowk_org_user_has_capability('reporters.manage'))
    or (select public.chowk_org_user_has_capability('newsroom.people.manage'))
    or exists (
      select 1
      from public.reporter_applications application
      where application.user_id = profiles.id
        and public.chowk_user_can_review_reporter_application(application.id)
    )
  );

revoke all on function public.chowk_reporter_territory_dashboard()
  from public, anon;
grant execute on function public.chowk_reporter_territory_dashboard()
  to authenticated;

commit;
