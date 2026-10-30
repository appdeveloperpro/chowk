create or replace function public.chowk_hr_has_current_required_policy_acceptance(
  target_employee uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.hr_employee_assignments assignment
    join public.hr_policy_documents policy
      on policy.is_active and policy.requires_acceptance
      and (policy.department_id is null or policy.department_id = assignment.department_id)
      and (policy.access_role_id is null or policy.access_role_id = assignment.access_role_id)
    left join public.hr_policy_versions version
      on version.policy_id = policy.id and version.status = 'published'
    left join public.hr_policy_acceptances acceptance
      on acceptance.employee_id = assignment.employee_id
      and acceptance.policy_version_id = version.id
      and acceptance.sha256_snapshot = version.sha256
    where assignment.employee_id = coalesce(target_employee, (select auth.uid()))
      and assignment.status = 'active'
      and (version.id is null or acceptance.id is null)
  );
$$;

create or replace function public.chowk_hr_my_access_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.chowk_hr_has_current_required_policy_acceptance((select auth.uid()));
$$;

create or replace function public.chowk_org_user_has_permission(
  target_permission text,
  target_user uuid default null,
  target_department uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then false
    when not exists (
      select 1 from public.organization_permission_catalog catalog
      where catalog.permission_key = target_permission and catalog.is_active
    ) then false
    when not public.chowk_org_permission_module_enabled(target_permission) then false
    when exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role in ('admin', 'super_admin')
    ) then true
    when not public.chowk_hr_has_current_required_policy_acceptance() then false
    else exists (
      select 1
      from public.organization_people person
      join public.organization_access_roles role
        on role.id = person.access_role_id and role.is_active
      join public.organization_access_role_permissions permission
        on permission.role_id = role.id and permission.permission_key = target_permission
      join public.organization_permission_catalog catalog
        on catalog.permission_key = permission.permission_key and catalog.is_active
      where person.person_id = (select auth.uid())
        and person.status = 'active' and person.ends_at is null
        and case permission.scope
          when 'all' then true
          when 'department' then target_department is not null
            and person.department_id = target_department
          when 'assigned' then target_user = (select auth.uid())
            or exists (
              select 1 from public.hr_employee_assignments managed
              where managed.employee_id = target_user
                and managed.manager_employee_id = (select auth.uid())
                and managed.status in ('pending', 'active', 'suspended')
            )
          when 'own' then target_user = (select auth.uid())
          else false
        end
    )
  end;
$$;

create or replace function public.chowk_org_user_has_capability(target_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then false
    when not exists (
      select 1 from public.organization_permission_catalog catalog
      where catalog.permission_key = target_permission and catalog.is_active
    ) then false
    when not public.chowk_org_permission_module_enabled(target_permission) then false
    when exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role in ('admin', 'super_admin')
    ) then true
    when not public.chowk_hr_has_current_required_policy_acceptance() then false
    else exists (
      select 1
      from public.organization_people person
      join public.organization_access_roles role
        on role.id = person.access_role_id and role.is_active
      join public.organization_access_role_permissions permission
        on permission.role_id = role.id and permission.permission_key = target_permission
      join public.organization_permission_catalog catalog
        on catalog.permission_key = permission.permission_key and catalog.is_active
      where person.person_id = (select auth.uid())
        and person.status = 'active' and person.ends_at is null
    )
  end;
$$;

create or replace function public.chowk_org_my_permissions()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role in ('admin', 'super_admin')
    ) then coalesce((
      select array_agg(permission_key order by permission_key)
      from public.organization_permission_catalog
      where is_active and public.chowk_org_permission_module_enabled(permission_key)
    ), array[]::text[])
    when not public.chowk_hr_has_current_required_policy_acceptance()
      then array[]::text[]
    else coalesce((
      select array_agg(distinct permission.permission_key order by permission.permission_key)
      from public.organization_people person
      join public.organization_access_roles role
        on role.id = person.access_role_id and role.is_active
      join public.organization_access_role_permissions permission
        on permission.role_id = role.id
      join public.organization_permission_catalog catalog
        on catalog.permission_key = permission.permission_key and catalog.is_active
      where person.person_id = (select auth.uid())
        and person.status = 'active' and person.ends_at is null
        and public.chowk_org_permission_module_enabled(permission.permission_key)
    ), array[]::text[])
  end;
$$;

create or replace function public.chowk_org_can_model_action(
  target_model uuid,
  target_action text,
  target_owner uuid,
  target_department uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then false
    when exists (
      select 1 from public.profiles profile
      where profile.id = (select auth.uid()) and profile.role in ('admin', 'super_admin')
    ) then true
    when not public.chowk_hr_has_current_required_policy_acceptance() then false
    else exists (
      select 1
      from public.hr_employee_assignments assignment
      join public.organization_models model
        on model.id = target_model and model.is_active
      join public.organization_model_permissions permission
        on permission.role_id = assignment.access_role_id
      join public.organization_access_roles access_role
        on access_role.id = assignment.access_role_id and access_role.is_active
      where assignment.employee_id = (select auth.uid())
        and assignment.status = 'active'
        and permission.model_id = target_model
        and permission.action = target_action
        and case permission.scope
          when 'all' then true
          when 'department' then target_department is not null
            and assignment.department_id = target_department
          when 'assigned' then exists (
            select 1 from public.hr_employee_assignments managed
            where managed.employee_id = target_owner
              and managed.manager_employee_id = (select auth.uid())
              and managed.status in ('pending', 'active', 'suspended')
          )
          when 'own' then target_owner = (select auth.uid())
          else false
        end
    )
  end;
$$;

create or replace function public.chowk_hr_validate_assignment_start()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and new.starts_at > now() then
    raise exception 'An assignment cannot be active before its start date'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_hr_assignment_start
  on public.hr_employee_assignments;
create trigger validate_hr_assignment_start
  before insert or update of status, starts_at on public.hr_employee_assignments
  for each row execute function public.chowk_hr_validate_assignment_start();

create or replace function public.chowk_hr_delete_unused_draft(
  target_table text,
  target_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_table = 'department' then
    if not public.chowk_user_has_permission('hr.configuration.manage') then
      raise exception 'HR configuration permission required' using errcode = '42501';
    end if;
    if exists (select 1 from public.hr_positions where department_id = target_id)
        or exists (select 1 from public.hr_employee_assignments where department_id = target_id)
        or exists (select 1 from public.hr_departments where parent_id = target_id)
        or exists (select 1 from public.hr_policy_documents where department_id = target_id)
        or exists (select 1 from public.organization_records where department_id = target_id) then
      raise exception 'This department is still referenced. Remove its positions, assignments, policies, or model records first.'
        using errcode = '23503';
    end if;
    delete from public.hr_departments where id = target_id;
  elsif target_table = 'position' then
    if not public.chowk_user_has_permission('hr.configuration.manage') then
      raise exception 'HR configuration permission required' using errcode = '42501';
    end if;
    if exists (select 1 from public.hr_employee_assignments where position_id = target_id) then
      raise exception 'This position has assignment history. Delete those assignments first.'
        using errcode = '23503';
    end if;
    delete from public.hr_positions where id = target_id;
  elsif target_table = 'access_role' then
    if not public.chowk_user_has_permission('hr.configuration.manage') then
      raise exception 'HR configuration permission required' using errcode = '42501';
    end if;
    if exists (select 1 from public.organization_access_roles where id = target_id and is_system)
        or exists (select 1 from public.hr_employee_assignments where access_role_id = target_id)
        or exists (select 1 from public.hr_policy_documents where access_role_id = target_id) then
      raise exception 'This access role is protected or still referenced. Remove assignments and policies first.'
        using errcode = '23503';
    end if;
    delete from public.organization_access_roles where id = target_id;
  else
    raise exception 'Unsupported HR record type' using errcode = '22023';
  end if;
  if not found then raise exception 'HR record not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.chowk_hr_change_employee_assignment(
  target_id uuid,
  target_department_id uuid,
  target_position_id uuid,
  target_access_role_id uuid,
  target_manager_employee_id uuid,
  target_status text,
  target_is_primary boolean,
  target_starts_at timestamptz,
  target_end_reason text default '',
  target_employment_type text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare existing public.hr_employee_assignments%rowtype;
begin
  if target_starts_at is null then
    raise exception 'Choose the effective date for the new assignment' using errcode = '22023';
  end if;
  if target_starts_at > now() then
    raise exception 'Future-dated assignment changes are not supported; choose today or an earlier date'
      using errcode = '22023';
  end if;
  select * into existing from public.hr_employee_assignments
  where id = target_id for update;
  if not found or existing.status = 'ended' then
    raise exception 'An active or pending assignment is required to make a change'
      using errcode = 'P0002';
  end if;
  if existing.starts_at is not null and target_starts_at < existing.starts_at then
    raise exception 'The new assignment cannot start before the current assignment'
      using errcode = '22023';
  end if;
  if not public.chowk_user_has_permission(
    'hr.employee.manage', existing.employee_id, existing.department_id
  ) or not public.chowk_user_has_permission(
    'hr.employee.manage', existing.employee_id, target_department_id
  ) then
    raise exception 'Permission to manage the employee in both departments is required'
      using errcode = '42501';
  end if;
  update public.hr_employee_assignments
  set status = 'ended', ends_at = target_starts_at,
      end_reason = 'Superseded by a new assignment.', updated_at = now()
  where id = existing.id;
  return public.chowk_hr_save_employee_assignment(
    null, existing.employee_id, target_department_id, target_position_id,
    target_access_role_id, target_manager_employee_id, target_status,
    target_is_primary, target_starts_at, target_end_reason, target_employment_type
  );
end;
$$;

create or replace function public.chowk_hr_end_employee_assignment(
  target_id uuid,
  target_end_at timestamptz,
  target_end_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare assignment public.hr_employee_assignments%rowtype;
begin
  select * into assignment from public.hr_employee_assignments
  where id = target_id for update;
  if not found or assignment.status = 'ended' then
    raise exception 'An active or pending assignment is required to end it'
      using errcode = 'P0002';
  end if;
  if not public.chowk_user_has_permission(
    'hr.employee.manage', assignment.employee_id, assignment.department_id
  ) then
    raise exception 'Permission to end this employee assignment is required'
      using errcode = '42501';
  end if;
  if target_end_at is null or target_end_at > now()
      or length(trim(coalesce(target_end_reason, ''))) not between 2 and 1000 then
    raise exception 'Choose an end date no later than today and provide a reason'
      using errcode = '22023';
  end if;
  if assignment.starts_at is not null and target_end_at < assignment.starts_at then
    raise exception 'The assignment cannot end before its start date' using errcode = '22023';
  end if;
  update public.hr_employee_assignments
  set status = 'ended',
      starts_at = coalesce(starts_at, target_end_at),
      ends_at = target_end_at,
      end_reason = trim(target_end_reason),
      updated_at = now()
  where id = assignment.id;
  update public.hr_employees employee
  set employment_status = case
        when exists (
          select 1 from public.hr_employee_assignments item
          where item.employee_id = employee.id and item.status = 'active'
        ) then 'active'
        when exists (
          select 1 from public.hr_employee_assignments item
          where item.employee_id = employee.id and item.status = 'suspended'
        ) then 'suspended'
        when exists (
          select 1 from public.hr_employee_assignments item
          where item.employee_id = employee.id and item.status = 'pending'
        ) then 'preboarding'
        else 'terminated'
      end,
      hired_on = coalesce(employee.hired_on, (
        select min(item.starts_at)::date
        from public.hr_employee_assignments item
        where item.employee_id = employee.id
          and item.status in ('active', 'suspended', 'ended')
      )),
      terminated_on = case
        when exists (
          select 1 from public.hr_employee_assignments item
          where item.employee_id = employee.id
            and item.status in ('pending', 'active', 'suspended')
        ) then null
        else coalesce((
          select max(item.ends_at)::date
          from public.hr_employee_assignments item
          where item.employee_id = employee.id and item.status = 'ended'
        ), current_date)
      end,
      updated_at = now()
  where employee.id = assignment.employee_id;
end;
$$;

create or replace function public.chowk_hr_delete_assignment(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare assignment public.hr_employee_assignments%rowtype;
begin
  select * into assignment from public.hr_employee_assignments
  where id = target_id for update;
  if not found then raise exception 'Employee assignment not found' using errcode = 'P0002'; end if;
  if not public.chowk_user_has_permission(
    'hr.employee.manage', assignment.employee_id, assignment.department_id
  ) then
    raise exception 'Permission to delete this employee assignment is required'
      using errcode = '42501';
  end if;
  delete from public.hr_employee_assignments where id = assignment.id;
  update public.hr_employees employee
  set employment_status = case
        when exists (
          select 1 from public.hr_employee_assignments item
          where item.employee_id = employee.id and item.status = 'active'
        ) then 'active'
        when exists (
          select 1 from public.hr_employee_assignments item
          where item.employee_id = employee.id and item.status = 'suspended'
        ) then 'suspended'
        when exists (
          select 1 from public.hr_employee_assignments item
          where item.employee_id = employee.id and item.status = 'pending'
        ) then 'preboarding'
        when employee.hired_on is null and not exists (
          select 1 from public.hr_employee_assignments item
          where item.employee_id = employee.id and item.status = 'ended'
        ) then 'preboarding'
        else 'terminated'
      end,
      hired_on = coalesce(employee.hired_on, (
        select min(item.starts_at)::date
        from public.hr_employee_assignments item
        where item.employee_id = employee.id and item.status in ('active', 'suspended', 'ended')
      )),
      terminated_on = case
        when exists (
          select 1 from public.hr_employee_assignments item
          where item.employee_id = employee.id
            and item.status in ('pending', 'active', 'suspended')
        ) or (employee.hired_on is null and not exists (
          select 1 from public.hr_employee_assignments item
          where item.employee_id = employee.id and item.status = 'ended'
        )) then null
        else coalesce((
          select max(item.ends_at)::date
          from public.hr_employee_assignments item
          where item.employee_id = employee.id and item.status = 'ended'
        ), current_date)
      end,
      updated_at = now()
  where employee.id = assignment.employee_id;
end;
$$;

create or replace function public.chowk_hr_delete_employee(target_employee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_role text;
begin
  if target_employee = (select auth.uid()) then
    raise exception 'You cannot delete your own HR record' using errcode = '42501';
  end if;
  select role into target_role from public.profiles where id = target_employee;
  if not found then raise exception 'Employee account not found' using errcode = 'P0002'; end if;
  if target_role in ('admin', 'super_admin') then
    raise exception 'Administrator HR records cannot be deleted here' using errcode = '42501';
  end if;
  if not public.chowk_user_has_permission('hr.configuration.manage')
      and (
        not exists (
          select 1 from public.hr_employee_assignments assignment
          where assignment.employee_id = target_employee
        )
        or exists (
          select 1 from public.hr_employee_assignments assignment
          where assignment.employee_id = target_employee
            and not public.chowk_user_has_permission(
              'hr.employee.manage', target_employee, assignment.department_id
            )
        )
      ) then
    raise exception 'Permission to delete this employee HR record is required'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.hr_employees where id = target_employee) then
    raise exception 'Employee record not found' using errcode = 'P0002';
  end if;
  update public.hr_employee_assignments
  set manager_employee_id = null, updated_at = now()
  where manager_employee_id = target_employee;
  delete from public.hr_policy_acceptances where employee_id = target_employee;
  delete from public.hr_employee_assignments where employee_id = target_employee;
  delete from public.hr_employees where id = target_employee;
end;
$$;

create or replace function public.chowk_hr_delete_policy_record(
  target_table text,
  target_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  policy_id_value uuid;
  found_policy_id uuid;
begin
  if not public.chowk_user_has_permission('hr.policy.manage') then
    raise exception 'HR policy management permission required' using errcode = '42501';
  end if;
  if target_table = 'policy_version' then
    select policy_id into policy_id_value
    from public.hr_policy_versions where id = target_id for update;
    if not found then raise exception 'Policy version not found' using errcode = 'P0002'; end if;
    if exists (
      select 1 from public.hr_policy_documents policy
      where policy.id = policy_id_value and policy.is_active and policy.requires_acceptance
    ) and not exists (
      select 1 from public.hr_policy_versions version
      where version.policy_id = policy_id_value and version.id <> target_id
        and version.status = 'published'
    ) then
      raise exception 'Publish a replacement version or deactivate this required policy first'
        using errcode = '23514';
    end if;
    delete from public.hr_policy_acceptances where policy_version_id = target_id;
    delete from public.hr_policy_versions where id = target_id;
  elsif target_table = 'policy' then
    select id into found_policy_id from public.hr_policy_documents
    where id = target_id for update;
    if not found then raise exception 'Policy not found' using errcode = 'P0002'; end if;
    delete from public.hr_policy_acceptances acceptance
    using public.hr_policy_versions version
    where acceptance.policy_version_id = version.id and version.policy_id = target_id;
    delete from public.hr_policy_versions where policy_id = target_id;
    delete from public.hr_policy_documents where id = target_id;
  else
    raise exception 'Unsupported HR policy record type' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.chowk_org_delete_model_field(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare field_row public.organization_model_fields%rowtype; actor uuid := (select auth.uid());
begin
  if actor is null or not public.chowk_user_has_permission('hr.configuration.manage') then
    raise exception 'HR configuration permission required' using errcode = '42501';
  end if;
  select * into field_row from public.organization_model_fields
  where id = target_id for update;
  if not found then raise exception 'Model field not found' using errcode = 'P0002'; end if;
  with updated_records as (
    update public.organization_records record
    set data = record.data - field_row.field_key,
        revision = record.revision + 1,
        updated_by = actor,
        updated_at = now()
    where record.model_id = field_row.model_id and record.data ? field_row.field_key
    returning record.id, record.status, record.revision, record.data
  )
  insert into public.organization_record_events(
    record_id, actor_id, event_type, from_status, to_status, revision, data_snapshot
  )
  select id, actor, 'updated', status, status, revision, data
  from updated_records;
  delete from public.organization_model_fields where id = target_id;
end;
$$;

alter table public.organization_record_events
  drop constraint if exists organization_record_events_record_id_fkey;

create or replace function public.chowk_org_model_delete_record(target_record uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); record_row public.organization_records%rowtype;
begin
  if actor is null then raise exception 'Sign in to delete this record' using errcode = '42501'; end if;
  select * into record_row from public.organization_records
  where id = target_record for update;
  if not found then raise exception 'Record not found' using errcode = 'P0002'; end if;
  if not public.chowk_org_can_model_action(
    record_row.model_id, 'delete', record_row.owner_id, record_row.department_id
  ) then
    raise exception 'Permission to delete this record is required' using errcode = '42501';
  end if;
  if record_row.deleted_at is null then
    insert into public.organization_record_events(
      record_id, actor_id, event_type, from_status, to_status, revision, data_snapshot
    ) values (
      record_row.id, actor, 'deleted', record_row.status, record_row.status,
      record_row.revision + 1, record_row.data
    );
  end if;
  delete from public.organization_records where id = record_row.id;
end;
$$;

revoke all on function public.chowk_hr_has_current_required_policy_acceptance(uuid),
  public.chowk_hr_validate_assignment_start(),
  public.chowk_hr_my_access_ready(),
  public.chowk_hr_change_employee_assignment(uuid,uuid,uuid,uuid,uuid,text,boolean,timestamptz,text,text),
  public.chowk_hr_end_employee_assignment(uuid,timestamptz,text),
  public.chowk_hr_delete_assignment(uuid),
  public.chowk_hr_delete_employee(uuid),
  public.chowk_hr_delete_policy_record(text,uuid),
  public.chowk_org_delete_model_field(uuid)
  from public, anon, authenticated;
grant execute on function public.chowk_hr_my_access_ready(),
  public.chowk_hr_change_employee_assignment(uuid,uuid,uuid,uuid,uuid,text,boolean,timestamptz,text,text),
  public.chowk_hr_end_employee_assignment(uuid,timestamptz,text),
  public.chowk_hr_delete_assignment(uuid),
  public.chowk_hr_delete_employee(uuid),
  public.chowk_hr_delete_policy_record(text,uuid),
  public.chowk_org_delete_model_field(uuid)
  to authenticated;
