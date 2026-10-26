create or replace function public.chowk_admin_set_reporter_designation(
  target_application bigint,
  target_designation bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  application_row public.reporter_applications%rowtype;
  assignment_row public.reporter_assignments%rowtype;
begin
  if actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select * into application_row
  from public.reporter_applications
  where id = target_application
  for update;
  if not found or application_row.status not in ('pending', 'needs_information', 'approved', 'active') then
    raise exception 'Designation can only be assigned to an application awaiting review or an approved reporter'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.reporter_designations
    where id = target_designation and is_active
  ) then
    raise exception 'Choose an active reporter designation' using errcode = '22023';
  end if;

  update public.reporter_applications
  set reporter_designation_id = target_designation
  where id = application_row.id
    and reporter_designation_id is distinct from target_designation;

  if application_row.status not in ('approved', 'active') then
    return;
  end if;

  select * into assignment_row
  from public.reporter_assignments
  where user_id = application_row.user_id and effective_to is null
  for update;
  if not found then
    raise exception 'The approved reporter has no current assignment to update'
      using errcode = '23514';
  end if;
  if assignment_row.reporter_designation_id is not distinct from target_designation then
    return;
  end if;

  update public.reporter_assignments
  set effective_to = clock_timestamp()
  where id = assignment_row.id;

  insert into public.reporter_assignments(
    user_id, rto_office_id, reporter_type_id, reporter_designation_id,
    effective_from, assigned_by
  )
  values (
    assignment_row.user_id,
    assignment_row.rto_office_id,
    assignment_row.reporter_type_id,
    target_designation,
    clock_timestamp(),
    actor
  );
end;
$$;

revoke all on function public.chowk_admin_set_reporter_designation(bigint, bigint) from public, anon;
grant execute on function public.chowk_admin_set_reporter_designation(bigint, bigint) to authenticated;

create or replace function public.chowk_admin_set_reporter_designation_for_user(
  target_user uuid,
  target_designation bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  application_row public.reporter_applications%rowtype;
  assignment_row public.reporter_assignments%rowtype;
begin
  if actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.reporter_profiles where user_id = target_user
  ) then
    raise exception 'Reporter account not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.reporter_designations
    where id = target_designation and is_active
  ) then
    raise exception 'Choose an active reporter designation' using errcode = '22023';
  end if;

  select * into application_row
  from public.reporter_applications
  where user_id = target_user and status in ('approved', 'active')
  order by created_at desc
  limit 1
  for update;

  if found then
    perform public.chowk_admin_set_reporter_designation(application_row.id, target_designation);
    return;
  end if;

  select * into assignment_row
  from public.reporter_assignments
  where user_id = target_user and effective_to is null
  for update;
  if not found then
    raise exception 'The reporter has no current assignment to update'
      using errcode = '23514';
  end if;
  if assignment_row.reporter_designation_id is not distinct from target_designation then
    return;
  end if;

  update public.reporter_assignments
  set effective_to = clock_timestamp()
  where id = assignment_row.id;

  insert into public.reporter_assignments(
    user_id, rto_office_id, reporter_type_id, reporter_designation_id,
    effective_from, assigned_by
  )
  values (
    assignment_row.user_id,
    assignment_row.rto_office_id,
    assignment_row.reporter_type_id,
    target_designation,
    clock_timestamp(),
    actor
  );
end;
$$;

revoke all on function public.chowk_admin_set_reporter_designation_for_user(uuid, bigint) from public, anon;
grant execute on function public.chowk_admin_set_reporter_designation_for_user(uuid, bigint) to authenticated;

create or replace function public.chowk_guard_issued_reporter_designation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  application_designation bigint;
begin
  if tg_table_name = 'reporter_applications' then
    return new;
  end if;

  select application.reporter_designation_id
  into application_designation
  from public.reporter_applications application
  where application.user_id = new.user_id
  order by application.created_at desc
  limit 1;

  if new.reporter_designation_id is null then
    new.reporter_designation_id := application_designation;
  end if;
  return new;
end;
$$;
