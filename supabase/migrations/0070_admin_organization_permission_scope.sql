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
      where id = (select auth.uid()) and role = 'super_admin'
    ) then true
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
      where id = (select auth.uid()) and role = 'super_admin'
    ) then true
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
      where id = (select auth.uid()) and role = 'super_admin'
    ) then coalesce((
      select array_agg(permission_key order by permission_key)
      from public.organization_permission_catalog
      where is_active and public.chowk_org_permission_module_enabled(permission_key)
    ), array[]::text[])
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

create or replace function public.chowk_user_has_permission(
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
  select public.chowk_org_user_has_permission(
    target_permission, target_user, target_department
  );
$$;

create or replace function public.chowk_org_start_workflow(
  target_workflow uuid,
  target_subject_type text,
  target_subject_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  primary_organization_id uuid;
  initial_state uuid;
  instance_id uuid;
  workflow_module text;
begin
  if actor is null or target_subject_type is null
      or target_subject_type !~ '^[a-z][a-z0-9_.-]{1,79}$'
      or length(coalesce(target_subject_id, '')) not between 1 and 200 then
    raise exception 'Enter a valid workflow subject' using errcode = '22023';
  end if;
  select id into primary_organization_id
  from public.organizations where is_primary and is_active;
  select module_key into workflow_module
  from public.organization_workflows workflow
  where workflow.id = target_workflow
    and workflow.organization_id = primary_organization_id;
  if workflow_module in ('newsroom', 'reporters', 'agreements', 'human-resources') then
    raise exception 'This module requires a domain-bound workflow adapter'
      using errcode = '0A000';
  end if;
  select state.id into initial_state
  from public.organization_workflows workflow
  join public.organization_workflow_states state
    on state.workflow_id = workflow.id and state.is_initial
  where workflow.id = target_workflow
    and workflow.organization_id = primary_organization_id
    and workflow.is_active
    and public.chowk_org_module_is_enabled(workflow.module_key);
  if initial_state is null then
    raise exception 'An active workflow with an initial state is required' using errcode = '23514';
  end if;
  if not public.chowk_org_user_has_permission(
    'organization.workflows.start', actor
  ) then
    raise exception 'Workflow start permission required' using errcode = '42501';
  end if;
  insert into public.organization_workflow_instances(
    organization_id, workflow_id, subject_type, subject_id, state_id, created_by, updated_by
  ) values (
    primary_organization_id, target_workflow, target_subject_type, target_subject_id,
    initial_state, actor, actor
  ) returning id into instance_id;
  insert into public.organization_workflow_events(
    instance_id, actor_id, event_type, to_state_id, revision
  ) values (instance_id, actor, 'started', initial_state, 1);
  return instance_id;
end;
$$;

create or replace function public.chowk_org_workflow_requires_domain_adapter(
  target_workflow uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_workflows workflow
    where workflow.id = target_workflow
      and workflow.module_key in ('newsroom', 'reporters', 'agreements', 'human-resources')
  );
$$;

create or replace function public.chowk_org_reject_unbound_workflow_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workflow uuid;
begin
  if tg_table_name = 'organization_workflow_instances' then
    target_workflow := old.workflow_id;
  else
    select instance.workflow_id into target_workflow
    from public.organization_workflow_instances instance
    where instance.id = case when tg_op = 'INSERT' then new.instance_id else old.instance_id end;
  end if;
  if public.chowk_org_workflow_requires_domain_adapter(target_workflow) then
    raise exception 'This module requires a domain-bound workflow adapter'
      using errcode = '0A000';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_unbound_workflow_instance_changes
  on public.organization_workflow_instances;
create trigger reject_unbound_workflow_instance_changes
  before update on public.organization_workflow_instances
  for each row execute function public.chowk_org_reject_unbound_workflow_change();

drop trigger if exists reject_unbound_workflow_approval_changes
  on public.organization_workflow_approvals;
create trigger reject_unbound_workflow_approval_changes
  before insert or update on public.organization_workflow_approvals
  for each row execute function public.chowk_org_reject_unbound_workflow_change();

revoke all on function public.chowk_org_workflow_requires_domain_adapter(uuid),
  public.chowk_org_reject_unbound_workflow_change() from public, anon, authenticated;