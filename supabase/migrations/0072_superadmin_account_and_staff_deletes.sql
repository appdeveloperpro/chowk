do $$
begin
  if (select count(*) from public.profiles where role = 'super_admin') > 1 then
    raise exception 'More than one super-admin exists. Keep one super-admin account before applying migration 0072.';
  end if;
end;
$$;

create unique index if not exists profiles_single_super_admin_idx
  on public.profiles(role)
  where role = 'super_admin';

alter table public.hr_employees
  drop constraint if exists hr_employees_id_fkey;
alter table public.hr_employees
  add constraint hr_employees_id_fkey
  foreign key (id) references public.profiles(id) on delete cascade;

alter table public.hr_employee_assignments
  drop constraint if exists hr_employee_assignments_employee_id_fkey,
  drop constraint if exists hr_employee_assignments_manager_employee_id_fkey;
alter table public.hr_employee_assignments
  add constraint hr_employee_assignments_employee_id_fkey
    foreign key (employee_id) references public.hr_employees(id) on delete cascade,
  add constraint hr_employee_assignments_manager_employee_id_fkey
    foreign key (manager_employee_id) references public.hr_employees(id) on delete set null;

alter table public.hr_policy_acceptances
  drop constraint if exists hr_policy_acceptances_employee_id_fkey;
alter table public.hr_policy_acceptances
  add constraint hr_policy_acceptances_employee_id_fkey
  foreign key (employee_id) references public.hr_employees(id) on delete cascade;

alter table public.organization_people
  drop constraint if exists organization_people_person_id_fkey;
alter table public.organization_people
  add constraint organization_people_person_id_fkey
  foreign key (person_id) references public.profiles(id) on delete cascade;

alter table public.organization_people_access_events
  alter column relationship_id drop not null;
alter table public.organization_people_access_events
  drop constraint if exists organization_people_access_events_relationship_id_fkey;
alter table public.organization_people_access_events
  add constraint organization_people_access_events_relationship_id_fkey
  foreign key (relationship_id) references public.organization_people(id) on delete set null;

alter table public.organization_records
  alter column created_by drop not null,
  alter column updated_by drop not null;
alter table public.organization_records
  drop constraint if exists organization_records_owner_id_fkey,
  drop constraint if exists organization_records_created_by_fkey,
  drop constraint if exists organization_records_updated_by_fkey;
alter table public.organization_records
  add constraint organization_records_owner_id_fkey
    foreign key (owner_id) references public.profiles(id) on delete cascade,
  add constraint organization_records_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null,
  add constraint organization_records_updated_by_fkey
    foreign key (updated_by) references public.profiles(id) on delete set null;

alter table public.organization_workflow_instances
  alter column created_by drop not null,
  alter column updated_by drop not null;
alter table public.organization_workflow_instances
  drop constraint if exists organization_workflow_instances_created_by_fkey,
  drop constraint if exists organization_workflow_instances_updated_by_fkey;
alter table public.organization_workflow_instances
  add constraint organization_workflow_instances_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null,
  add constraint organization_workflow_instances_updated_by_fkey
    foreign key (updated_by) references public.profiles(id) on delete set null;

alter table public.organization_workflow_approvals
  alter column requested_by drop not null;
alter table public.organization_workflow_approvals
  drop constraint if exists organization_workflow_approvals_requested_by_fkey,
  drop constraint if exists organization_workflow_approvals_decided_by_fkey;
alter table public.organization_workflow_approvals
  add constraint organization_workflow_approvals_requested_by_fkey
    foreign key (requested_by) references public.profiles(id) on delete set null,
  add constraint organization_workflow_approvals_decided_by_fkey
    foreign key (decided_by) references public.profiles(id) on delete set null;

alter table public.reporter_profiles
  drop constraint if exists reporter_profiles_user_id_fkey;
alter table public.reporter_profiles
  add constraint reporter_profiles_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.reporter_assignments
  drop constraint if exists reporter_assignments_user_id_fkey;
alter table public.reporter_assignments
  add constraint reporter_assignments_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.user_coverage_assignments
  drop constraint if exists user_coverage_assignments_user_id_fkey;
alter table public.user_coverage_assignments
  add constraint user_coverage_assignments_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

create or replace function public.chowk_admin_user_deletion_assets(target_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_role text;
  target_role text;
  application_paths text[];
  agreement_paths text[];
  staff_profile_path text;
begin
  select role into actor_role
  from public.profiles
  where id = actor;
  if actor is null or actor_role <> 'super_admin' then
    raise exception 'Only the super-admin can permanently delete user accounts'
      using errcode = '42501';
  end if;
  if target_user is null or target_user = actor then
    raise exception 'You cannot delete your own account' using errcode = '22023';
  end if;

  select role into target_role
  from public.profiles
  where id = target_user
  for update;
  if target_role is null then
    raise exception 'User account not found' using errcode = 'P0002';
  end if;
  if target_role = 'super_admin' then
    raise exception 'The single super-admin account cannot be deleted here'
      using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct storage_path), array[]::text[])
  into application_paths
  from public.reporter_application_documents
  where user_id = target_user;

  select coalesce(array_agg(distinct document_path), array[]::text[])
  into agreement_paths
  from (
    select document_storage_path as document_path
    from public.reporter_agreement_acceptances
    where user_id = target_user
      and document_storage_path like 'acceptance/' || target_user::text || '/%'
    union
    select document_storage_path
    from public.reporter_service_agreement_acceptances
    where user_id = target_user
      and document_storage_path like 'acceptance/' || target_user::text || '/%'
    union
    select document_storage_path
    from public.reporter_service_agreement_issues
    where user_id = target_user
  ) user_documents;

  select profile_photo_path into staff_profile_path
  from public.staff_onboarding
  where user_id = target_user;

  return jsonb_build_object(
    'user_id', target_user,
    'role', target_role,
    'application_document_paths', to_jsonb(application_paths),
    'agreement_document_paths', to_jsonb(agreement_paths),
    'staff_profile_photo_path', staff_profile_path
  );
end;
$$;

create or replace function public.chowk_admin_staff_onboarding_assets(target_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_role text;
  onboarding public.staff_onboarding%rowtype;
begin
  select role into actor_role from public.profiles where id = actor;
  if actor is null or actor_role <> 'super_admin' then
    raise exception 'Only the super-admin can permanently delete staff applications'
      using errcode = '42501';
  end if;
  select * into onboarding
  from public.staff_onboarding
  where user_id = target_user
  for update;
  if not found then
    raise exception 'Staff application not found' using errcode = 'P0002';
  end if;
  if onboarding.status in ('invited', 'active') then
    raise exception 'Delete an invitation with its account, or permanently delete the active account'
      using errcode = '23514';
  end if;
  return jsonb_build_object(
    'user_id', target_user,
    'status', onboarding.status,
    'profile_photo_path', onboarding.profile_photo_path
  );
end;
$$;

create or replace function public.chowk_record_admin_event(
  event_action text,
  target_table text,
  target_record_id text,
  event_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor uuid := (select auth.uid());
  current_actor_name text;
  current_actor_email text;
  request_headers jsonb := coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb,
    '{}'::jsonb
  );
begin
  if current_actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if not coalesce(
    (event_action in ('USER_CREATED', 'PASSWORD_CHANGED') and target_table = 'profiles')
    or (
      event_action in (
        'STAFF_ONBOARDING_INVITED',
        'STAFF_ONBOARDING_APPROVED',
        'STAFF_ONBOARDING_CHANGES_REQUESTED',
        'STAFF_ONBOARDING_REJECTED',
        'STAFF_ONBOARDING_DELETED'
      ) and target_table = 'staff_onboarding'
    )
    or (event_action in ('STAFF_JOB_ROLE_CREATED', 'STAFF_JOB_ROLE_UPDATED',
        'STAFF_JOB_ROLE_DELETED') and target_table = 'staff_role_definitions'),
    false
  ) then
    raise exception 'Unsupported admin audit event' using errcode = '22023';
  end if;
  select full_name, email
  into current_actor_name, current_actor_email
  from public.profiles
  where id = current_actor;

  insert into public.audit_logs (
    actor_id, actor_name, actor_email, actor_ip, request_id, user_agent,
    action, table_name, record_id, after_data, changed_fields, outcome
  )
  values (
    current_actor, current_actor_name, current_actor_email,
    nullif(request_headers ->> 'x-chowk-client-ip', ''),
    nullif(request_headers ->> 'x-chowk-request-id', ''),
    nullif(request_headers ->> 'x-chowk-user-agent', ''),
    event_action, target_table, target_record_id,
    coalesce(event_data, '{}'::jsonb),
    case
      when jsonb_typeof(event_data -> 'changed_fields') = 'array'
        then event_data -> 'changed_fields'
      else '[]'::jsonb
    end,
    'success'
  );
end;
$$;

create or replace function public.chowk_admin_delete_staff_application(target_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_role text;
  onboarding public.staff_onboarding%rowtype;
begin
  select role into actor_role from public.profiles where id = actor;
  if actor is null or actor_role <> 'super_admin' then
    raise exception 'Only the super-admin can permanently delete staff applications'
      using errcode = '42501';
  end if;
  select * into onboarding
  from public.staff_onboarding
  where user_id = target_user
  for update;
  if not found then
    raise exception 'Staff application not found' using errcode = 'P0002';
  end if;
  if onboarding.status in ('invited', 'active') then
    raise exception 'Delete an invitation with its account, or permanently delete the active account'
      using errcode = '23514';
  end if;

  perform public.chowk_record_admin_event(
    'STAFF_ONBOARDING_DELETED',
    'staff_onboarding',
    target_user::text,
    jsonb_build_object('status', onboarding.status, 'requested_role', onboarding.requested_role)
  );
  delete from public.staff_role_assignments
  where user_id = target_user and status = 'pending';
  delete from public.staff_onboarding where user_id = target_user;
end;
$$;

alter table public.staff_onboarding
  drop constraint if exists staff_onboarding_staff_role_id_fkey;
alter table public.staff_onboarding
  add constraint staff_onboarding_staff_role_id_fkey
  foreign key (staff_role_id) references public.staff_role_definitions(id) on delete set null;

alter table public.staff_role_assignments
  alter column staff_role_id drop not null;
alter table public.staff_role_assignments
  drop constraint if exists staff_role_assignments_staff_role_id_fkey;
alter table public.staff_role_assignments
  add constraint staff_role_assignments_staff_role_id_fkey
  foreign key (staff_role_id) references public.staff_role_definitions(id) on delete set null;

create or replace function public.chowk_admin_delete_staff_role_definition(target_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_role text;
  role_row public.staff_role_definitions%rowtype;
begin
  select role into actor_role from public.profiles where id = actor;
  if actor is null or actor_role <> 'super_admin' then
    raise exception 'Only the super-admin can permanently delete newsroom job titles'
      using errcode = '42501';
  end if;
  select * into role_row
  from public.staff_role_definitions
  where id = target_role_id
  for update;
  if not found then
    raise exception 'Newsroom job title not found' using errcode = 'P0002';
  end if;
  if role_row.is_builtin then
    raise exception 'Built-in newsroom job titles cannot be deleted'
      using errcode = '23514';
  end if;

  perform public.chowk_record_admin_event(
    'STAFF_JOB_ROLE_DELETED',
    'staff_role_definitions',
    target_role_id::text,
    jsonb_build_object(
      'role_key', role_row.role_key,
      'display_name', role_row.display_name,
      'access_profile', role_row.access_profile
    )
  );
  delete from public.staff_role_definitions where id = target_role_id;
end;
$$;

revoke all on function public.chowk_admin_user_deletion_assets(uuid),
  public.chowk_admin_staff_onboarding_assets(uuid),
  public.chowk_admin_delete_staff_application(uuid),
  public.chowk_admin_delete_staff_role_definition(uuid)
  from public, anon;
grant execute on function public.chowk_admin_user_deletion_assets(uuid),
  public.chowk_admin_staff_onboarding_assets(uuid),
  public.chowk_admin_delete_staff_application(uuid),
  public.chowk_admin_delete_staff_role_definition(uuid)
  to authenticated;
