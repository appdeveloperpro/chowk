create table if not exists public.organization_workflow_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  workflow_id uuid not null references public.organization_workflows(id) on delete restrict,
  subject_type text not null check (subject_type ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  subject_id text not null check (length(subject_id) between 1 and 200),
  state_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_id, subject_type, subject_id),
  foreign key (state_id, workflow_id)
    references public.organization_workflow_states(id, workflow_id) on delete restrict
);

create table if not exists public.organization_people_access_events (
  id bigint generated always as identity primary key,
  relationship_id uuid not null references public.organization_people(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete set null,
  previous_role_id uuid references public.organization_access_roles(id) on delete set null,
  new_role_id uuid references public.organization_access_roles(id) on delete set null,
  previous_department_id uuid references public.hr_departments(id) on delete set null,
  new_department_id uuid references public.hr_departments(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_workflow_events (
  id bigint generated always as identity primary key,
  instance_id uuid not null references public.organization_workflow_instances(id) on delete restrict,
  transition_id uuid references public.organization_workflow_transitions(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('started', 'transitioned', 'approval_requested', 'approved', 'rejected')),
  from_state_id uuid references public.organization_workflow_states(id) on delete restrict,
  to_state_id uuid references public.organization_workflow_states(id) on delete restrict,
  revision integer not null check (revision > 0),
  reason text not null default '' check (length(reason) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists organization_workflow_events_instance_idx
  on public.organization_workflow_events(instance_id, created_at desc);

create table if not exists public.organization_workflow_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  instance_id uuid not null references public.organization_workflow_instances(id) on delete restrict,
  transition_id uuid not null references public.organization_workflow_transitions(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  decided_by uuid references public.profiles(id) on delete restrict,
  expected_revision integer not null check (expected_revision > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'stale')),
  request_reason text not null default '' check (length(request_reason) <= 2000),
  decision_reason text not null default '' check (length(decision_reason) <= 2000),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check ((status = 'pending') = (decided_at is null))
);

alter table public.organization_people
  add column if not exists access_role_id uuid references public.organization_access_roles(id) on delete set null,
  add column if not exists department_id uuid references public.hr_departments(id) on delete set null;

create or replace function public.chowk_org_version_module_configuration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.is_enabled is not distinct from new.is_enabled
      and old.configuration is not distinct from new.configuration then
    return new;
  end if;
  update public.organization_module_configuration_versions
  set status = 'retired'
  where organization_module_id = new.id and status = 'published';
  insert into public.organization_module_configuration_versions(
    organization_module_id, version, configuration, status, created_by, published_by, published_at
  ) values (
    new.id, new.revision, new.configuration, 'published',
    new.updated_by, new.updated_by, now()
  )
  on conflict (organization_module_id, version) do nothing;
  return new;
end;
$$;

create or replace function public.chowk_org_audit_person_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.access_role_id is distinct from new.access_role_id
      or old.department_id is distinct from new.department_id then
    insert into public.organization_people_access_events(
      relationship_id, actor_id, previous_role_id, new_role_id,
      previous_department_id, new_department_id
    ) values (
      new.id, (select auth.uid()), old.access_role_id, new.access_role_id,
      old.department_id, new.department_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists audit_organization_people_access on public.organization_people;
create trigger audit_organization_people_access
  after update of access_role_id, department_id on public.organization_people
  for each row execute function public.chowk_org_audit_person_access();

drop trigger if exists version_organization_module_configuration on public.organization_modules;
create trigger version_organization_module_configuration
  after insert or update on public.organization_modules
  for each row execute function public.chowk_org_version_module_configuration();

create unique index if not exists organization_workflow_one_pending_approval_idx
  on public.organization_workflow_approvals(instance_id)
  where status = 'pending';
create index if not exists organization_workflow_approval_inbox_idx
  on public.organization_workflow_approvals(organization_id, status, created_at desc);

alter table public.organization_settings
  add column if not exists is_active boolean not null default true;

alter table public.organization_workflow_instances enable row level security;
alter table public.organization_workflow_events enable row level security;
alter table public.organization_workflow_approvals enable row level security;
alter table public.organization_people_access_events enable row level security;

revoke all on public.organization_workflow_instances,
  public.organization_workflow_events, public.organization_workflow_approvals,
  public.organization_people_access_events
  from anon, authenticated;

create or replace function public.chowk_org_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'super_admin'
  );
$$;

create or replace function public.chowk_org_configuration_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  organization_id uuid;
begin
  if not public.chowk_org_is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  select id into organization_id from public.organizations where is_primary;
  if organization_id is null then
    raise exception 'Primary organization configuration is missing' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'organization', (
      select to_jsonb(organization) - 'created_by'
      from public.organizations organization where organization.id = organization_id
    ),
    'settings', coalesce((
      select jsonb_agg(to_jsonb(setting) - 'updated_by' order by setting.setting_key)
      from public.organization_settings setting
      where setting.organization_id = organization_id and setting.is_active
    ), '[]'::jsonb),
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'module_key', catalog.module_key,
        'name', catalog.name,
        'description', catalog.description,
        'module_type', catalog.module_type,
        'is_required', catalog.is_required,
        'is_enabled', coalesce(module.is_enabled, catalog.is_required),
        'configuration', coalesce(module.configuration, '{}'::jsonb),
        'revision', coalesce(module.revision, 0)
      ) order by catalog.sort_order, catalog.name)
      from public.organization_module_catalog catalog
      left join public.organization_modules module
        on module.module_key = catalog.module_key
       and module.organization_id = organization_id
      where catalog.is_active
    ), '[]'::jsonb),
    'workflows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', workflow.id,
        'module_key', workflow.module_key,
        'workflow_key', workflow.workflow_key,
        'name', workflow.name,
        'description', workflow.description,
        'version', workflow.version,
        'is_active', workflow.is_active,
        'states', coalesce((
          select jsonb_agg(to_jsonb(state) - 'workflow_id'
            order by state.sort_order, state.label)
          from public.organization_workflow_states state
          where state.workflow_id = workflow.id
        ), '[]'::jsonb),
        'transitions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', transition.id,
            'from_state_id', transition.from_state_id,
            'to_state_id', transition.to_state_id,
            'transition_key', transition.transition_key,
            'label', transition.label,
            'required_permission', transition.required_permission,
            'requires_reason', transition.requires_reason,
            'requires_approval', transition.requires_approval,
            'sort_order', transition.sort_order,
            'is_active', transition.is_active
          ) order by transition.sort_order, transition.label)
          from public.organization_workflow_transitions transition
          where transition.workflow_id = workflow.id
        ), '[]'::jsonb)
      ) order by workflow.module_key, workflow.name)
      from public.organization_workflows workflow
      where workflow.organization_id = organization_id
    ), '[]'::jsonb),
    'modules_catalog', coalesce((
      select jsonb_agg(to_jsonb(catalog) order by catalog.sort_order, catalog.name)
      from public.organization_module_catalog catalog where catalog.is_active
    ), '[]'::jsonb),
    'access_roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', role.id, 'role_key', role.role_key, 'name', role.name,
        'description', role.description
      ) order by role.name)
      from public.organization_access_roles role
      where role.is_active
    ), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', department.id, 'department_key', department.department_key,
        'name', department.name
      ) order by department.name)
      from public.hr_departments department where department.is_active
    ), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', person.id,
        'person_id', person.person_id,
        'full_name', profile.full_name,
        'email', profile.email,
        'relationship_type', person.relationship_type,
        'status', person.status,
        'source_type', person.source_type,
        'starts_at', person.starts_at,
        'ends_at', person.ends_at,
        'access_role_id', person.access_role_id,
        'access_role_name', role.name,
        'department_id', person.department_id,
        'department_name', department.name
      ) order by profile.full_name nulls last, profile.email, person.relationship_type)
      from public.organization_people person
      join public.profiles profile on profile.id = person.person_id
      left join public.organization_access_roles role on role.id = person.access_role_id
      left join public.hr_departments department on department.id = person.department_id
      where person.organization_id = organization_id
    ), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'permission_key', permission.permission_key,
        'area', permission.area,
        'description', permission.description
      ) order by permission.area, permission.permission_key)
      from public.organization_permission_catalog permission
      where permission.is_active
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.chowk_org_set_person_access(
  target_relationship uuid,
  target_access_role uuid,
  target_department uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  person public.organization_people%rowtype;
  actor uuid := (select auth.uid());
begin
  if actor is null or not (
    public.chowk_org_is_super_admin()
    or public.chowk_org_user_has_permission('newsroom.people.manage')
  ) then
    raise exception 'People access management permission required' using errcode = '42501';
  end if;
  select * into person from public.organization_people
  where id = target_relationship and organization_id = (
    select organization.id from public.organizations organization where organization.is_primary
  ) for update;
  if not found or person.ends_at is not null then
    raise exception 'An active organization relationship is required' using errcode = 'P0002';
  end if;
  if person.relationship_type = 'employee' then
    raise exception 'Employee access roles must be changed through the employee assignment workflow'
      using errcode = '23514';
  end if;
  if target_access_role is not null and not exists (
    select 1 from public.organization_access_roles role
    where role.id = target_access_role and role.is_active
  ) then
    raise exception 'Choose an active access role' using errcode = '23514';
  end if;
  if target_department is not null and not exists (
    select 1 from public.hr_departments department
    where department.id = target_department and department.is_active
  ) then
    raise exception 'Choose an active department' using errcode = '23514';
  end if;
  if not public.chowk_org_is_super_admin() and target_access_role is not null and exists (
    select 1 from public.organization_access_role_permissions requested
    where requested.role_id = target_access_role
      and not exists (
        select 1
        from public.organization_people actor_person
        join public.organization_access_role_permissions actor_permission
          on actor_permission.role_id = actor_person.access_role_id
        where actor_person.person_id = actor and actor_person.status = 'active'
          and actor_person.ends_at is null
          and actor_permission.permission_key = requested.permission_key
          and (
            actor_permission.scope = 'all'
            or (
              actor_permission.scope = requested.scope
              and (
                requested.scope <> 'department'
                or actor_person.department_id = target_department
              )
            )
          )
      )
  ) then
    raise exception 'You cannot delegate permissions or scopes you do not hold'
      using errcode = '42501';
  end if;
  update public.organization_people
  set access_role_id = target_access_role,
      department_id = target_department,
      updated_at = now()
  where id = person.id;
end;
$$;

create or replace function public.chowk_org_save_identity(
  target_name text,
  target_legal_name text,
  target_website_url text,
  target_contact_email text,
  target_contact_phone text,
  target_country_code text,
  target_locale text,
  target_timezone text,
  target_currency_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.chowk_org_is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  if length(trim(coalesce(target_name, ''))) not between 2 and 160
      or length(coalesce(target_legal_name, '')) > 200
      or length(coalesce(target_website_url, '')) > 500
      or length(coalesce(target_contact_email, '')) > 254
      or length(coalesce(target_contact_phone, '')) > 30
      or target_country_code !~ '^[A-Z]{2}$'
      or length(coalesce(target_locale, '')) not between 2 and 20
      or length(coalesce(target_timezone, '')) not between 1 and 80
      or target_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'Enter valid organization identity and locale settings'
      using errcode = '22023';
  end if;
  update public.organizations
  set display_name = trim(target_name),
      legal_name = trim(coalesce(target_legal_name, '')),
      website_url = trim(coalesce(target_website_url, '')),
      contact_email = lower(trim(coalesce(target_contact_email, ''))),
      contact_phone = trim(coalesce(target_contact_phone, '')),
      country_code = target_country_code,
      locale = trim(target_locale),
      timezone = trim(target_timezone),
      currency_code = target_currency_code,
      updated_at = now()
  where is_primary;
  if not found then
    raise exception 'Primary organization configuration is missing' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.chowk_org_save_setting(
  target_key text,
  target_value jsonb,
  target_description text,
  expected_revision integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  primary_org_id uuid;
  setting_id uuid;
  current_revision integer;
begin
  if not public.chowk_org_is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  if target_key is null or target_key !~ '^[a-z][a-z0-9_.-]{1,99}$'
      or target_value is null
      or length(coalesce(target_description, '')) > 1000 then
    raise exception 'Enter a valid setting key, value, and description' using errcode = '22023';
  end if;
  select id into primary_org_id from public.organizations where is_primary;
  select id, revision into setting_id, current_revision
  from public.organization_settings
  where organization_settings.organization_id = primary_org_id
    and setting_key = target_key and is_active
  for update;
  if setting_id is not null and expected_revision is distinct from current_revision then
    raise exception 'This setting changed; reload it before saving' using errcode = '40001';
  end if;
  if setting_id is null and expected_revision is not null then
    raise exception 'This setting no longer exists; reload before saving' using errcode = '40001';
  end if;
  insert into public.organization_settings(
    organization_id, setting_key, value, description, revision, updated_by, is_active
  )
  values (primary_org_id, target_key, target_value, trim(coalesce(target_description, '')), 1,
    (select auth.uid()), true)
  on conflict (organization_id, setting_key) do update
  set value = excluded.value,
      description = excluded.description,
      revision = public.organization_settings.revision + 1,
      updated_by = excluded.updated_by,
      updated_at = now(),
      is_active = true
  returning id into setting_id;
  return setting_id;
end;
$$;

create or replace function public.chowk_org_archive_setting(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.chowk_org_is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  update public.organization_settings
  set is_active = false, revision = revision + 1, updated_by = (select auth.uid()), updated_at = now()
  where id = target_id and is_active;
  if not found then
    raise exception 'Active organization setting not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.chowk_org_set_module(
  target_module text,
  target_enabled boolean,
  target_configuration jsonb,
  expected_revision integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  primary_org_id uuid;
  current_revision integer;
  is_required boolean;
begin
  if not public.chowk_org_is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  if target_module is null or target_enabled is null
      or target_configuration is null
      or jsonb_typeof(target_configuration) <> 'object' then
    raise exception 'Enter valid module settings' using errcode = '22023';
  end if;
  select catalog.is_required into is_required
  from public.organization_module_catalog catalog
  where catalog.module_key = target_module and catalog.is_active;
  if not found then raise exception 'Active module not found' using errcode = 'P0002'; end if;
  if is_required and not target_enabled then
    raise exception 'Required organization modules cannot be disabled' using errcode = '23514';
  end if;
  select id into primary_org_id from public.organizations where is_primary;
  select revision into current_revision from public.organization_modules
  where organization_modules.organization_id = primary_org_id
    and module_key = target_module for update;
  if current_revision is not null and expected_revision is distinct from current_revision then
    raise exception 'This module changed; reload it before saving' using errcode = '40001';
  end if;
  if current_revision is null and expected_revision is not null then
    raise exception 'This module configuration no longer exists' using errcode = '40001';
  end if;
  insert into public.organization_modules(
    organization_id, module_key, is_enabled, configuration, revision, updated_by
  ) values (primary_org_id, target_module, target_enabled, target_configuration, 1, (select auth.uid()))
  on conflict (organization_id, module_key) do update
  set is_enabled = excluded.is_enabled,
      configuration = excluded.configuration,
      revision = public.organization_modules.revision + 1,
      updated_by = excluded.updated_by,
      updated_at = now();
end;
$$;

create or replace function public.chowk_org_module_is_enabled(target_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select catalog.is_active
      and (catalog.is_required or coalesce(module.is_enabled, false))
    from public.organization_module_catalog catalog
    left join public.organization_modules module
      on module.module_key = catalog.module_key
     and module.organization_id = (
       select organization.id from public.organizations organization where organization.is_primary
     )
    where catalog.module_key = target_module
  ), false);
$$;

create or replace function public.chowk_org_save_workflow(
  target_id uuid,
  target_module text,
  target_key text,
  target_name text,
  target_description text,
  target_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  primary_org_id uuid;
  saved_id uuid;
begin
  if not public.chowk_org_is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  if target_module is null or target_key is null
      or target_key !~ '^[a-z][a-z0-9_-]{1,79}$'
      or length(trim(coalesce(target_name, ''))) not between 2 and 120
      or length(coalesce(target_description, '')) > 2000
      or target_active is null then
    raise exception 'Enter a valid workflow name, key, and status' using errcode = '22023';
  end if;
  if target_active and not public.chowk_org_module_is_enabled(target_module) then
    raise exception 'Enable the module before configuring its workflow' using errcode = '23514';
  end if;
  select id into primary_org_id from public.organizations where is_primary;
  if target_id is null then
    insert into public.organization_workflows(
      organization_id, module_key, workflow_key, name, description, is_active, created_by
    ) values (
      primary_org_id, target_module, target_key, trim(target_name),
      trim(coalesce(target_description, '')), target_active, (select auth.uid())
    ) returning id into saved_id;
  else
    update public.organization_workflows
    set module_key = target_module, workflow_key = target_key, name = trim(target_name),
        description = trim(coalesce(target_description, '')), is_active = target_active,
        version = version + 1, updated_at = now()
    where id = target_id and organization_workflows.organization_id = primary_org_id
    returning id into saved_id;
    if saved_id is null then raise exception 'Workflow not found' using errcode = 'P0002'; end if;
  end if;
  return saved_id;
end;
$$;

create or replace function public.chowk_org_save_workflow_state(
  target_workflow uuid,
  target_id uuid,
  target_key text,
  target_label text,
  target_initial boolean,
  target_terminal boolean,
  target_sort_order integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
begin
  if not public.chowk_org_is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  if target_key is null or target_key !~ '^[a-z][a-z0-9_-]{1,39}$'
      or length(trim(coalesce(target_label, ''))) not between 1 and 80
      or target_initial is null or target_terminal is null
      or target_sort_order not between 0 and 10000
      or not exists (
        select 1 from public.organization_workflows workflow
        where workflow.id = target_workflow and workflow.is_active
          and workflow.organization_id = (
            select organization.id from public.organizations organization where organization.is_primary
          )
      ) then
    raise exception 'Enter a valid workflow state' using errcode = '22023';
  end if;
  if target_initial then
    update public.organization_workflow_states
    set is_initial = false
    where workflow_id = target_workflow and is_initial
      and id is distinct from target_id;
  elsif target_id is not null and exists (
    select 1 from public.organization_workflow_states state
    where state.id = target_id and state.workflow_id = target_workflow and state.is_initial
  ) and not exists (
    select 1 from public.organization_workflow_states state
    where state.workflow_id = target_workflow and state.is_initial
      and state.id <> target_id
  ) then
    raise exception 'A workflow must retain one initial state' using errcode = '23514';
  end if;
  if target_id is null then
    insert into public.organization_workflow_states(
      workflow_id, state_key, label, is_initial, is_terminal, sort_order
    ) values (
      target_workflow, target_key, trim(target_label), target_initial, target_terminal, target_sort_order
    ) returning id into saved_id;
  else
    update public.organization_workflow_states
    set state_key = target_key, label = trim(target_label), is_initial = target_initial,
        is_terminal = target_terminal, sort_order = target_sort_order
    where id = target_id and workflow_id = target_workflow
    returning id into saved_id;
    if saved_id is null then raise exception 'Workflow state not found' using errcode = 'P0002'; end if;
  end if;
  return saved_id;
end;
$$;

create or replace function public.chowk_org_save_workflow_transition(
  target_workflow uuid,
  target_id uuid,
  target_from uuid,
  target_to uuid,
  target_key text,
  target_label text,
  target_permission text,
  target_requires_reason boolean,
  target_requires_approval boolean,
  target_sort_order integer,
  target_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
begin
  if not public.chowk_org_is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  if target_key is null or target_key !~ '^[a-z][a-z0-9_-]{1,79}$'
      or length(trim(coalesce(target_label, ''))) not between 2 and 80
      or target_permission is null
      or target_requires_reason is null or target_requires_approval is null
      or target_sort_order not between 0 and 10000 or target_active is null
      or target_from = target_to
      or not exists (
        select 1 from public.organization_workflow_states source
        join public.organization_workflow_states destination
          on destination.workflow_id = source.workflow_id
        join public.organization_workflows workflow on workflow.id = source.workflow_id
        where source.id = target_from and destination.id = target_to
          and source.workflow_id = target_workflow and workflow.is_active
          and workflow.organization_id = (
            select organization.id from public.organizations organization where organization.is_primary
          )
      )
      or not exists (
        select 1 from public.organization_permission_catalog permission
        where permission.permission_key = target_permission and permission.is_active
      ) then
    raise exception 'Enter a valid workflow transition and permission' using errcode = '22023';
  end if;
  if target_id is null then
    insert into public.organization_workflow_transitions(
      workflow_id, from_state_id, to_state_id, transition_key, label,
      required_permission, requires_reason, requires_approval, sort_order, is_active, created_by
    ) values (
      target_workflow, target_from, target_to, target_key, trim(target_label),
      target_permission, target_requires_reason, target_requires_approval,
      target_sort_order, target_active, (select auth.uid())
    ) returning id into saved_id;
  else
    update public.organization_workflow_transitions
    set from_state_id = target_from, to_state_id = target_to,
        transition_key = target_key, label = trim(target_label),
        required_permission = target_permission, requires_reason = target_requires_reason,
        requires_approval = target_requires_approval, sort_order = target_sort_order,
        is_active = target_active
    where id = target_id and workflow_id = target_workflow
    returning id into saved_id;
    if saved_id is null then raise exception 'Workflow transition not found' using errcode = 'P0002'; end if;
  end if;
  return saved_id;
end;
$$;

create or replace function public.chowk_org_delete_workflow(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.chowk_org_is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.organization_workflow_instances instance
    where instance.workflow_id = target_id
  ) then
    raise exception 'Workflows with execution history cannot be deleted; deactivate them instead'
      using errcode = '23503';
  end if;
  delete from public.organization_workflows workflow
  where workflow.id = target_id
    and workflow.organization_id = (
      select organization.id from public.organizations organization where organization.is_primary
    );
  if not found then raise exception 'Workflow not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.chowk_org_delete_workflow_state(
  target_workflow uuid,
  target_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.chowk_org_is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.organization_workflow_states state
    where state.id = target_id and state.workflow_id = target_workflow and state.is_initial
  ) then
    raise exception 'Choose another initial state before deleting this state'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.organization_workflow_transitions transition
    where transition.from_state_id = target_id or transition.to_state_id = target_id
  ) or exists (
    select 1 from public.organization_workflow_instances instance
    where instance.state_id = target_id
  ) then
    raise exception 'Workflow states with transition or execution history cannot be deleted'
      using errcode = '23503';
  end if;
  delete from public.organization_workflow_states
  where id = target_id and workflow_id = target_workflow;
  if not found then raise exception 'Workflow state not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.chowk_org_delete_workflow_transition(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.chowk_org_is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.organization_workflow_approvals approval
    where approval.transition_id = target_id
  ) then
    raise exception 'Workflow transitions with approval history cannot be deleted'
      using errcode = '23503';
  end if;
  delete from public.organization_workflow_transitions
  where id = target_id and workflow_id in (
    select id from public.organization_workflows
    where organization_id = (
      select organization.id from public.organizations organization where organization.is_primary
    )
  );
  if not found then raise exception 'Workflow transition not found' using errcode = 'P0002'; end if;
end;
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
  organization_id uuid;
  initial_state uuid;
  instance_id uuid;
begin
  if actor is null or target_subject_type is null
      or target_subject_type !~ '^[a-z][a-z0-9_.-]{1,79}$'
      or length(coalesce(target_subject_id, '')) not between 1 and 200 then
    raise exception 'Enter a valid workflow subject' using errcode = '22023';
  end if;
  select id into organization_id from public.organizations where is_primary and is_active;
  select state.id into initial_state
  from public.organization_workflows workflow
  join public.organization_workflow_states state on state.workflow_id = workflow.id and state.is_initial
  where workflow.id = target_workflow and workflow.organization_id = organization_id
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
    organization_id, target_workflow, target_subject_type, target_subject_id,
    initial_state, actor, actor
  ) returning id into instance_id;
  insert into public.organization_workflow_events(
    instance_id, actor_id, event_type, to_state_id, revision
  ) values (instance_id, actor, 'started', initial_state, 1);
  return instance_id;
end;
$$;

create or replace function public.chowk_org_available_workflows()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
    'id', workflow.id,
    'module_key', workflow.module_key,
    'workflow_key', workflow.workflow_key,
    'name', workflow.name,
    'description', workflow.description,
    'initial_state_id', initial_state.id,
    'initial_state_label', initial_state.label
  ) order by workflow.module_key, workflow.name), '[]'::jsonb)
  from public.organization_workflows workflow
  join public.organization_workflow_states initial_state
    on initial_state.workflow_id = workflow.id and initial_state.is_initial
  where workflow.is_active
    and workflow.organization_id = (
      select organization.id from public.organizations organization where organization.is_primary
    )
    and public.chowk_org_module_is_enabled(workflow.module_key)
    and public.chowk_org_user_has_permission(
      'organization.workflows.start', (select auth.uid())
    )
  );
end;
$$;

create or replace function public.chowk_org_workflow_instances(target_workflow uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (
    public.chowk_org_user_has_permission('organization.workflows.read', (select auth.uid()))
    or public.chowk_org_user_has_permission('organization.workflows.start', (select auth.uid()))
  ) then
    raise exception 'Workflow read permission required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', instance.id,
      'workflow_id', instance.workflow_id,
      'workflow_name', workflow.name,
      'subject_type', instance.subject_type,
      'subject_id', instance.subject_id,
      'state_id', state.id,
      'state_key', state.state_key,
      'state_label', state.label,
      'revision', instance.revision,
      'created_by', instance.created_by,
      'created_at', instance.created_at,
      'updated_at', instance.updated_at,
      'available_transitions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', transition.id,
          'transition_key', transition.transition_key,
          'label', transition.label,
          'to_state_id', transition.to_state_id,
          'requires_reason', transition.requires_reason,
          'requires_approval', transition.requires_approval
        ) order by transition.sort_order, transition.label)
        from public.organization_workflow_transitions transition
        where transition.workflow_id = instance.workflow_id
          and transition.from_state_id = instance.state_id
          and transition.is_active
          and public.chowk_org_user_has_permission(
            transition.required_permission, instance.created_by
          )
      ), '[]'::jsonb)
    ) order by instance.updated_at desc)
    from public.organization_workflow_instances instance
    join public.organization_workflows workflow on workflow.id = instance.workflow_id
    join public.organization_workflow_states state on state.id = instance.state_id
    where instance.workflow_id = target_workflow
      and (
        instance.created_by = (select auth.uid())
        or public.chowk_org_user_has_permission('organization.workflows.read', instance.created_by)
      )
  ), '[]'::jsonb);
end;
$$;

create or replace function public.chowk_org_workflow_approval_inbox()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.chowk_org_user_has_permission('organization.workflows.approve') then
    raise exception 'Workflow approval permission required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', approval.id,
      'instance_id', instance.id,
      'workflow_name', workflow.name,
      'subject_type', instance.subject_type,
      'subject_id', instance.subject_id,
      'from_state', source.label,
      'to_state', destination.label,
      'revision', instance.revision,
      'request_reason', approval.request_reason,
      'requested_by', requester.full_name,
      'created_at', approval.created_at
    ) order by approval.created_at)
    from public.organization_workflow_approvals approval
    join public.organization_workflow_instances instance on instance.id = approval.instance_id
    join public.organization_workflows workflow on workflow.id = instance.workflow_id
    join public.organization_workflow_transitions transition on transition.id = approval.transition_id
    join public.organization_workflow_states source on source.id = transition.from_state_id
    join public.organization_workflow_states destination on destination.id = transition.to_state_id
    join public.profiles requester on requester.id = approval.requested_by
    where approval.status = 'pending'
      and approval.requested_by <> (select auth.uid())
      and public.chowk_org_user_has_permission(
        transition.required_permission, instance.created_by
      )
  ), '[]'::jsonb);
end;
$$;

create or replace function public.chowk_org_transition_workflow(
  target_instance uuid,
  target_transition uuid,
  expected_revision integer,
  transition_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  instance public.organization_workflow_instances%rowtype;
  transition public.organization_workflow_transitions%rowtype;
  approval_id uuid;
begin
  if actor is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select * into instance from public.organization_workflow_instances
  where id = target_instance for update;
  if not found then raise exception 'Workflow instance not found' using errcode = 'P0002'; end if;
  if instance.revision <> expected_revision then
    raise exception 'Workflow changed; reload before retrying' using errcode = '40001';
  end if;
  select * into transition from public.organization_workflow_transitions
  where id = target_transition and workflow_id = instance.workflow_id
    and from_state_id = instance.state_id and is_active;
  if not found then raise exception 'This transition is not available from the current state' using errcode = '23514'; end if;
  if not public.chowk_org_module_is_enabled((
      select workflow.module_key from public.organization_workflows workflow
      where workflow.id = instance.workflow_id
    )) then
    raise exception 'This organization module is disabled' using errcode = '42501';
  end if;
  if not public.chowk_org_user_has_permission(
    transition.required_permission, instance.created_by
  ) then
    raise exception 'The required workflow permission is missing' using errcode = '42501';
  end if;
  if transition.requires_reason and length(trim(coalesce(transition_reason, ''))) < 2 then
    raise exception 'A reason is required for this workflow transition' using errcode = '22023';
  end if;
  if length(coalesce(transition_reason, '')) > 2000 then
    raise exception 'Workflow reason is too long' using errcode = '22023';
  end if;
  if transition.requires_approval then
    insert into public.organization_workflow_approvals(
      organization_id, instance_id, transition_id, requested_by, expected_revision, request_reason
    ) values (
      instance.organization_id, instance.id, transition.id, actor,
      instance.revision, trim(coalesce(transition_reason, ''))
    ) returning id into approval_id;
    insert into public.organization_workflow_events(
      instance_id, transition_id, actor_id, event_type, from_state_id, to_state_id,
      revision, reason
    ) values (
      instance.id, transition.id, actor, 'approval_requested', instance.state_id,
      transition.to_state_id, instance.revision, trim(coalesce(transition_reason, ''))
    );
    return jsonb_build_object('status', 'approval_pending', 'approval_id', approval_id);
  end if;
  update public.organization_workflow_instances
  set state_id = transition.to_state_id, revision = revision + 1,
      updated_by = actor, updated_at = now()
  where id = instance.id;
  insert into public.organization_workflow_events(
    instance_id, transition_id, actor_id, event_type, from_state_id, to_state_id,
    revision, reason
  ) values (
    instance.id, transition.id, actor, 'transitioned', instance.state_id,
    transition.to_state_id, instance.revision + 1, trim(coalesce(transition_reason, ''))
  );
  return jsonb_build_object('status', 'transitioned', 'revision', instance.revision + 1);
end;
$$;

create or replace function public.chowk_org_decide_workflow_approval(
  target_approval uuid,
  expected_revision integer,
  approve boolean,
  decision_reason text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  approval public.organization_workflow_approvals%rowtype;
  instance public.organization_workflow_instances%rowtype;
  transition public.organization_workflow_transitions%rowtype;
  event_type text;
begin
  if actor is null or approve is null then
    raise exception 'Sign in and provide an approval decision' using errcode = '22023';
  end if;
  if length(coalesce(decision_reason, '')) > 2000 then
    raise exception 'Decision reason is too long' using errcode = '22023';
  end if;
  select * into approval from public.organization_workflow_approvals
  where id = target_approval for update;
  if not found or approval.status <> 'pending' then
    raise exception 'Pending workflow approval not found' using errcode = 'P0002';
  end if;
  if approval.requested_by = actor then
    raise exception 'A workflow requester cannot approve their own request' using errcode = '42501';
  end if;
  select * into instance from public.organization_workflow_instances
  where id = approval.instance_id for update;
  if instance.revision <> expected_revision or instance.revision <> approval.expected_revision then
    update public.organization_workflow_approvals
    set status = 'stale', decided_by = actor, decided_at = now(),
        decision_reason = trim(coalesce(decision_reason, ''))
    where id = approval.id;
    return;
  end if;
  select * into transition from public.organization_workflow_transitions
  where id = approval.transition_id and is_active
    and from_state_id = instance.state_id;
  if not found or not public.chowk_org_user_has_permission(
    transition.required_permission, instance.created_by
  ) then
    raise exception 'The approval permission is missing or the transition is no longer available'
      using errcode = '42501';
  end if;
  if not public.chowk_org_user_has_permission('organization.workflows.approve') then
    raise exception 'Workflow approval permission required' using errcode = '42501';
  end if;
  if not public.chowk_org_module_is_enabled((
    select definition.module_key
    from public.organization_workflows definition
    where definition.id = instance.workflow_id
  )) then
    raise exception 'This organization module is disabled' using errcode = '42501';
  end if;
  event_type := case when approve then 'approved' else 'rejected' end;
  update public.organization_workflow_approvals
  set status = case when approve then 'approved' else 'rejected' end,
      decided_by = actor, decided_at = now(), decision_reason = trim(coalesce(decision_reason, ''))
  where id = approval.id;
  if approve then
    update public.organization_workflow_instances
    set state_id = transition.to_state_id, revision = revision + 1,
        updated_by = actor, updated_at = now()
    where id = instance.id;
  end if;
  insert into public.organization_workflow_events(
    instance_id, transition_id, actor_id, event_type, from_state_id, to_state_id,
    revision, reason
  ) values (
    instance.id, transition.id, actor, event_type, instance.state_id,
    case when approve then transition.to_state_id else instance.state_id end,
    case when approve then instance.revision + 1 else instance.revision end,
    trim(coalesce(decision_reason, ''))
  );
end;
$$;

create or replace function public.chowk_org_sync_staff_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  primary_organization uuid;
  mapped_role uuid;
  relationship_kind text;
  relationship_state text;
  relationship_end timestamptz;
begin
  select id into primary_organization from public.organizations where is_primary and is_active;
  if primary_organization is null then
    raise exception 'An active primary organization is required before syncing people'
      using errcode = '23514';
  end if;
  select id into mapped_role from public.organization_access_roles
  where role_key = new.role_key_snapshot and is_active;
  relationship_kind := case when new.role_key_snapshot = 'reporter'
    then 'reporter' else 'newsroom_collaborator' end;
  relationship_state := case new.status
    when 'pending' then 'invited'
    when 'ended' then 'ended'
    else 'active'
  end;
  relationship_end := case when new.status = 'ended' then new.ended_at else null end;
  insert into public.organization_people(
    organization_id, person_id, relationship_type, status, source_type, source_id,
    starts_at, ends_at, access_role_id
  ) values (
    primary_organization, new.user_id, relationship_kind, relationship_state,
    'staff_role_assignment', new.id::text, new.assigned_at, relationship_end, mapped_role
  )
  on conflict (organization_id, person_id, relationship_type)
    where ends_at is null
  do update set status = excluded.status,
    source_id = excluded.source_id,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    access_role_id = excluded.access_role_id,
    updated_at = now();
  return new;
end;
$$;

create or replace function public.chowk_org_sync_reporter_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  primary_organization uuid;
  mapped_role uuid;
begin
  select id into primary_organization from public.organizations where is_primary and is_active;
  if primary_organization is null then
    raise exception 'An active primary organization is required before syncing people'
      using errcode = '23514';
  end if;
  select id into mapped_role from public.organization_access_roles
  where role_key = 'reporter' and is_active;
  insert into public.organization_people(
    organization_id, person_id, relationship_type, status, source_type, source_id,
    starts_at, access_role_id
  ) values (
    primary_organization, new.user_id, 'reporter', 'active', 'reporter_profile',
    new.user_id::text, new.created_at, mapped_role
  )
  on conflict (organization_id, person_id, relationship_type)
    where ends_at is null
  do update set status = 'active', access_role_id = excluded.access_role_id,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists sync_organization_staff_relationship on public.staff_role_assignments;
create trigger sync_organization_staff_relationship
  after insert or update on public.staff_role_assignments
  for each row execute function public.chowk_org_sync_staff_relationship();

drop trigger if exists sync_organization_reporter_relationship on public.reporter_profiles;
create trigger sync_organization_reporter_relationship
  after insert or update on public.reporter_profiles
  for each row execute function public.chowk_org_sync_reporter_relationship();

create or replace function public.chowk_org_sync_employee_assignment_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  primary_organization uuid;
  employee public.hr_employees%rowtype;
  current_assignment public.hr_employee_assignments%rowtype;
  relationship_status text;
  relationship_end timestamptz;
begin
  primary_organization := coalesce(new.organization_id, old.organization_id);
  select * into employee from public.hr_employees
  where id = coalesce(new.employee_id, old.employee_id);
  if not found then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  select * into current_assignment from public.hr_employee_assignments assignment
  where assignment.employee_id = employee.id
    and assignment.status in ('pending', 'active', 'suspended')
  order by assignment.is_primary desc, assignment.starts_at desc nulls last,
    assignment.created_at desc
  limit 1;
  relationship_status := case employee.employment_status
    when 'preboarding' then 'invited'
    when 'terminated' then 'ended'
    else employee.employment_status
  end;
  relationship_end := case when employee.terminated_on is not null
    then employee.terminated_on::timestamptz else null end;
  insert into public.organization_people(
    organization_id, person_id, relationship_type, status, source_type,
    source_id, starts_at, ends_at, access_role_id, department_id, created_by
  ) values (
    primary_organization, employee.id, 'employee', relationship_status,
    'hr_assignment', current_assignment.id::text,
    coalesce(employee.hired_on::timestamptz, current_assignment.starts_at, employee.created_at),
    relationship_end, current_assignment.access_role_id, current_assignment.department_id,
    employee.created_by
  )
  on conflict (organization_id, person_id, relationship_type)
    where ends_at is null
  do update set status = excluded.status,
    source_id = excluded.source_id,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    access_role_id = excluded.access_role_id,
    department_id = excluded.department_id,
    updated_at = now();
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists sync_organization_employee_assignment_relationship
  on public.hr_employee_assignments;
create trigger sync_organization_employee_assignment_relationship
  after insert or update or delete on public.hr_employee_assignments
  for each row execute function public.chowk_org_sync_employee_assignment_relationship();

create or replace function public.chowk_org_sync_employee_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  primary_organization uuid;
  assignment public.hr_employee_assignments%rowtype;
  relationship_status text;
begin
  select id into primary_organization
  from public.organizations where is_primary and is_active;
  if primary_organization is null then
    raise exception 'An active primary organization is required before assigning employees'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    update public.organization_people
    set status = 'ended', ends_at = coalesce(ends_at, now()), updated_at = now()
    where organization_id = primary_organization
      and person_id = old.id
      and relationship_type = 'employee'
      and ends_at is null;
    return old;
  end if;
  select * into assignment from public.hr_employee_assignments current_assignment
  where current_assignment.employee_id = new.id
    and current_assignment.status in ('pending', 'active', 'suspended')
  order by current_assignment.is_primary desc, current_assignment.starts_at desc nulls last,
    current_assignment.created_at desc
  limit 1;
  relationship_status := case new.employment_status
    when 'preboarding' then 'invited'
    when 'terminated' then 'ended'
    else new.employment_status
  end;
  insert into public.organization_people(
    organization_id, person_id, relationship_type, status, source_type,
    source_id, starts_at, ends_at, access_role_id, department_id, created_by
  ) values (
    primary_organization, new.id, 'employee', relationship_status,
    'hr_assignment', assignment.id::text,
    coalesce(new.hired_on::timestamptz, assignment.starts_at, new.created_at),
    case when new.terminated_on is not null then new.terminated_on::timestamptz else null end,
    assignment.access_role_id, assignment.department_id, new.created_by
  )
  on conflict (organization_id, person_id, relationship_type)
    where ends_at is null
  do update set status = excluded.status,
    source_id = excluded.source_id,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    access_role_id = excluded.access_role_id,
    department_id = excluded.department_id,
    updated_at = now();
  return new;
end;
$$;

update public.organization_people person
set access_role_id = case
      when person.relationship_type = 'employee' then (
        select assignment.access_role_id
        from public.hr_employee_assignments assignment
        where assignment.employee_id = person.person_id
          and assignment.status in ('pending', 'active', 'suspended')
        order by assignment.is_primary desc, assignment.starts_at desc nulls last,
          assignment.created_at desc limit 1
      )
      else (
        select role.id from public.organization_access_roles role
        where role.role_key = (
          select assignment.role_key_snapshot
          from public.staff_role_assignments assignment
          where assignment.user_id = person.person_id
            and assignment.status in ('pending', 'active')
          order by assignment.assigned_at desc limit 1
        )
      )
    end,
    department_id = case when person.relationship_type = 'employee' then (
      select assignment.department_id
      from public.hr_employee_assignments assignment
      where assignment.employee_id = person.person_id
        and assignment.status in ('pending', 'active', 'suspended')
      order by assignment.is_primary desc, assignment.starts_at desc nulls last,
        assignment.created_at desc limit 1
    ) else null end
where person.ends_at is null;

insert into public.organization_access_roles(role_key, name, description, is_system, is_active)
values
  ('reporter', 'Reporter', 'Newsroom access for approved reporters.', true, true),
  ('moderator', 'Moderator', 'Newsroom review and moderation access.', true, true),
  ('editor', 'Editor', 'Editorial management and publishing access.', true, true),
  ('publisher', 'Publisher', 'Publishing access.', true, true)
on conflict (role_key) do update
set name = excluded.name, is_system = true, is_active = true;

insert into public.organization_people(
  organization_id, person_id, relationship_type, status, source_type, source_id,
  starts_at, ends_at, created_by
)
select organization.id, assignment.user_id,
  case when assignment.role_key_snapshot = 'reporter' then 'reporter'
    else 'newsroom_collaborator' end,
  case assignment.status when 'ended' then 'ended'
    when 'pending' then 'invited' else 'active' end,
  'staff_role_assignment', assignment.id::text,
  assignment.assigned_at, assignment.ended_at, assignment.assigned_by
from public.organizations organization
cross join public.staff_role_assignments assignment
where organization.is_primary
  and assignment.status in ('pending', 'active', 'ended')
on conflict (organization_id, person_id, relationship_type)
  where ends_at is null do nothing;

insert into public.organization_permission_catalog(permission_key, area, description, is_active)
values
  ('newsroom.articles.delete', 'Newsroom', 'Permanently remove newsroom articles where retention rules permit.', true),
  ('newsroom.articles.reopen', 'Newsroom', 'Reopen rejected articles for another review cycle.', true),
  ('newsroom.categories.manage', 'Newsroom', 'Create and manage article categories.', true),
  ('newsroom.locations.manage', 'Newsroom', 'Manage newsroom location configuration.', true),
  ('reporters.manage', 'People', 'Manage reporter applications, assignments, agreements, and credentials.', true),
  ('people.directory.read', 'People', 'Read organization and newsroom people directories.', true),
  ('organization.workflows.approve', 'Workflows', 'Approve organization workflow transitions.', true),
  ('organization.workflows.start', 'Workflows', 'Start organization workflow instances.', true),
  ('organization.workflows.read', 'Workflows', 'Read organization workflow definitions and history.', true),
  ('organization.audit.read', 'Organization', 'Read organization configuration and activity history.', true),
  ('organization.accounts.manage', 'Organization', 'Manage user accounts and account permissions.', true)
on conflict (permission_key) do update
set area = excluded.area, description = excluded.description, is_active = true;

insert into public.organization_access_role_permissions(role_id, permission_key, scope)
select role.id, permission.permission_key, permission.scope
from (
  values
    ('reporter', 'newsroom.articles.read', 'own'),
    ('reporter', 'newsroom.articles.create', 'own'),
    ('reporter', 'newsroom.articles.edit', 'own'),
    ('reporter', 'organization.workflows.start', 'own'),
    ('reporter', 'organization.workflows.read', 'own'),
    ('moderator', 'newsroom.articles.read', 'assigned'),
    ('moderator', 'newsroom.articles.edit', 'assigned'),
    ('moderator', 'newsroom.articles.review', 'assigned'),
    ('moderator', 'newsroom.comments.moderate', 'all'),
    ('moderator', 'newsroom.reports.manage', 'all'),
    ('moderator', 'organization.workflows.start', 'all'),
    ('moderator', 'organization.workflows.read', 'all'),
    ('editor', 'newsroom.articles.read', 'all'),
    ('editor', 'newsroom.articles.create', 'own'),
    ('editor', 'newsroom.articles.edit', 'all'),
    ('editor', 'newsroom.articles.review', 'all'),
    ('editor', 'newsroom.articles.publish', 'all'),
    ('editor', 'newsroom.categories.manage', 'all'),
    ('editor', 'newsroom.media.manage', 'all'),
    ('editor', 'organization.workflows.start', 'all'),
    ('editor', 'organization.workflows.read', 'all'),
    ('publisher', 'newsroom.articles.read', 'all'),
    ('publisher', 'newsroom.articles.edit', 'all'),
    ('publisher', 'newsroom.articles.publish', 'all'),
    ('publisher', 'newsroom.media.manage', 'all')
    ,('publisher', 'organization.workflows.start', 'all')
    ,('publisher', 'organization.workflows.read', 'all')
) as permission(role_key, permission_key, scope)
join public.organization_access_roles role on role.role_key = permission.role_key
on conflict (role_id, permission_key) do nothing;

update public.organization_people person
set access_role_id = case
      when person.relationship_type = 'employee' then (
        select assignment.access_role_id
        from public.hr_employee_assignments assignment
        where assignment.employee_id = person.person_id
          and assignment.status in ('pending', 'active', 'suspended')
        order by assignment.is_primary desc, assignment.starts_at desc nulls last,
          assignment.created_at desc limit 1
      )
      else (
        select role.id from public.organization_access_roles role
        where role.role_key = (
          select assignment.role_key_snapshot
          from public.staff_role_assignments assignment
          where assignment.user_id = person.person_id
            and assignment.status in ('pending', 'active')
          order by assignment.assigned_at desc limit 1
        )
      )
    end,
    department_id = case when person.relationship_type = 'employee' then (
      select assignment.department_id
      from public.hr_employee_assignments assignment
      where assignment.employee_id = person.person_id
        and assignment.status in ('pending', 'active', 'suspended')
      order by assignment.is_primary desc, assignment.starts_at desc nulls last,
        assignment.created_at desc limit 1
    ) else null end
where person.ends_at is null;

insert into public.organization_access_role_permissions(role_id, permission_key, scope)
select role.id, permission.permission_key, 'all'
from public.organization_access_roles role
cross join (values
  ('organization.workflows.start'),
  ('organization.workflows.read'),
  ('organization.workflows.approve'),
  ('organization.audit.read')
) permission(permission_key)
where role.role_key = 'hr_administrator'
on conflict (role_id, permission_key) do nothing;

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
    when target_permission = 'reporters.manage'
      then public.chowk_org_module_is_enabled('reporters')
    else true
  end;
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

create or replace function public.chowk_org_user_has_any_permission(target_permissions text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    cardinality(target_permissions) > 0
    and exists (
      select 1 from unnest(target_permissions) permission_key
      where public.chowk_org_user_has_permission(permission_key)
    ),
    false
  );
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

create or replace function public.chowk_org_article_permission(target_action text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case target_action
    when 'submit' then 'newsroom.articles.create'
    when 'withdraw' then 'newsroom.articles.edit'
    when 'restore_withdrawn' then 'newsroom.articles.edit'
    when 'delete_withdrawn' then 'newsroom.articles.edit'
    when 'start_review' then 'newsroom.articles.review'
    when 'send_to_editor' then 'newsroom.articles.review'
    when 'request_changes' then 'newsroom.articles.review'
    when 'reject' then 'newsroom.articles.review'
    when 'reopen_rejected' then 'newsroom.articles.reopen'
    when 'publish' then 'newsroom.articles.publish'
    when 'schedule' then 'newsroom.articles.publish'
    when 'unschedule' then 'newsroom.articles.publish'
    when 'archive' then 'newsroom.articles.publish'
    else null
  end;
$$;

create or replace function public.chowk_org_can_access_article(
  target_permission text,
  target_author uuid,
  target_assignee uuid,
  target_status text,
  target_location bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then false
    when not public.chowk_org_permission_module_enabled(target_permission) then false
    when not exists (
      select 1 from public.organization_permission_catalog catalog
      where catalog.permission_key = target_permission and catalog.is_active
    ) then false
    when exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role in ('admin', 'super_admin')
    ) then true
    else exists (
      select 1
      from public.organization_people person
      join public.organization_access_roles role
        on role.id = person.access_role_id and role.is_active
      join public.organization_access_role_permissions permission
        on permission.role_id = role.id and permission.permission_key = target_permission
      where person.person_id = (select auth.uid())
        and person.status = 'active' and person.ends_at is null
        and case permission.scope
          when 'all' then true
          when 'own' then target_author = (select auth.uid())
          when 'assigned' then target_assignee = (select auth.uid())
            or (
              target_assignee is null
              and target_status in ('submitted', 'moderator_review', 'editor_review')
              and target_location is not null
              and public.chowk_user_covers_location((select auth.uid()), target_location)
            )
          else false
        end
    )
  end;
$$;

create or replace function public.chowk_org_patch_newsroom_function(
  target_function regprocedure,
  original_text text,
  replacement_text text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  definition text;
  patched_definition text;
begin
  definition := pg_get_functiondef(target_function);
  patched_definition := replace(definition, original_text, replacement_text);
  if patched_definition = definition then
    raise exception 'Expected newsroom authorization check was not found in %', target_function;
  end if;
  execute patched_definition;
end;
$$;
revoke all on function public.chowk_org_patch_newsroom_function(regprocedure,text,text)
  from public, anon, authenticated;

select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_create_article(text,text,text,text,bigint,text,text,text,bigint)'::regprocedure,
  'if actor is null or actor_role not in (''reporter'', ''editor'', ''admin'', ''super_admin'') then',
  'if actor is null or not public.chowk_org_can_access_article(
    ''newsroom.articles.create'', actor, null, null, null
  ) then'
);

select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_update_article(bigint,text,text,text,text,bigint,text,text,text,bigint,text)'::regprocedure,
  'if not found then raise exception ''Story not found'' using errcode=''P0002''; end if;',
  'if not found then raise exception ''Story not found'' using errcode=''P0002''; end if;
  if not public.chowk_org_can_access_article(
    ''newsroom.articles.edit'', article_row.author_id, article_row.assigned_to,
    article_row.workflow_status, article_row.reporting_location_id
  ) then raise exception ''Story edit permission required'' using errcode=''42501''; end if;'
);

select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_update_article(bigint,text,text,text,text,bigint,text,text,text,bigint,text)'::regprocedure,
  'if actor_role is null or actor_role not in (''reporter'',''moderator'',''editor'',''publisher'',''admin'',''super_admin'') then',
  'if actor_role is null then'
);

select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_transition_article(bigint,text,text,timestamp with time zone)'::regprocedure,
  'if not found then raise exception ''Story not found'' using errcode=''P0002''; end if;',
  'if not found then raise exception ''Story not found'' using errcode=''P0002''; end if;
  if not public.chowk_org_can_access_article(
    public.chowk_org_article_permission(requested_action),
    article_row.author_id, article_row.assigned_to,
    article_row.workflow_status, article_row.reporting_location_id
  ) then raise exception ''Story workflow permission required'' using errcode=''42501''; end if;'
);

select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_transition_article(bigint,text,text,timestamp with time zone)'::regprocedure,
  'if requested_action=''submit'' and actor_role in (''reporter'',''editor'')',
  'if requested_action=''submit'''
);
select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_transition_article(bigint,text,text,timestamp with time zone)'::regprocedure,
  'elsif requested_action=''withdraw'' and actor_role=''reporter''',
  'elsif requested_action=''withdraw'''
);
select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_transition_article(bigint,text,text,timestamp with time zone)'::regprocedure,
  'elsif requested_action=''restore_withdrawn'' and actor_role=''reporter''',
  'elsif requested_action=''restore_withdrawn'''
);
select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_transition_article(bigint,text,text,timestamp with time zone)'::regprocedure,
  'elsif requested_action=''delete_withdrawn'' and actor_role=''reporter''',
  'elsif requested_action=''delete_withdrawn'''
);
select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_transition_article(bigint,text,text,timestamp with time zone)'::regprocedure,
  'elsif requested_action=''start_review'' and actor_role=''moderator''',
  'elsif requested_action=''start_review'''
);
select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_transition_article(bigint,text,text,timestamp with time zone)'::regprocedure,
  'elsif requested_action=''send_to_editor'' and actor_role=''moderator''',
  'elsif requested_action=''send_to_editor'''
);
select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_transition_article(bigint,text,text,timestamp with time zone)'::regprocedure,
  'elsif requested_action=''request_changes'' and actor_role in (''moderator'',''editor'')
     and ((actor_role=''moderator'' and article_row.workflow_status=''moderator_review'')
       or (actor_role=''editor'' and article_row.workflow_status=''editor_review'')) then',
  'elsif requested_action=''request_changes''
     and article_row.workflow_status in (''moderator_review'', ''editor_review'') then'
);
select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_transition_article(bigint,text,text,timestamp with time zone)'::regprocedure,
  'elsif requested_action=''reject'' and actor_role in (''moderator'',''editor'')
     and ((actor_role=''moderator'' and article_row.workflow_status=''moderator_review'')
       or (actor_role=''editor'' and article_row.workflow_status=''editor_review'')) then',
  'elsif requested_action=''reject''
     and article_row.workflow_status in (''moderator_review'', ''editor_review'') then'
);
select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_transition_article(bigint,text,text,timestamp with time zone)'::regprocedure,
  'elsif requested_action=''publish'' and actor_role in (''editor'',''publisher'')',
  'elsif requested_action=''publish'''
);
select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_transition_article(bigint,text,text,timestamp with time zone)'::regprocedure,
  'elsif requested_action=''schedule'' and actor_role in (''editor'',''publisher'')',
  'elsif requested_action=''schedule'''
);
select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_transition_article(bigint,text,text,timestamp with time zone)'::regprocedure,
  'elsif requested_action=''unschedule'' and actor_role in (''editor'',''publisher'')',
  'elsif requested_action=''unschedule'''
);
select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_transition_article(bigint,text,text,timestamp with time zone)'::regprocedure,
  'elsif requested_action=''reopen_rejected'' and actor_role in (''admin'',''super_admin'')',
  'elsif requested_action=''reopen_rejected'''
);
select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_transition_article(bigint,text,text,timestamp with time zone)'::regprocedure,
  'elsif requested_action=''archive'' and actor_role in (''editor'',''publisher'',''admin'',''super_admin'')',
  'elsif requested_action=''archive'''
);

select public.chowk_org_patch_newsroom_function(
  'public.chowk_workspace_transition_article(bigint,text,text,timestamp with time zone)'::regprocedure,
  '  else
    raise exception ''This role cannot perform that action in the current story state'' using errcode=''42501'';
  end if;',
  '  elsif actor_role not in (''reporter'',''moderator'',''editor'',''publisher'',''admin'',''super_admin'') then
    if requested_action = ''submit'' and article_row.author_id = actor
        and article_row.workflow_status in (''draft'', ''changes_requested'') then
      next_status := ''submitted'';
    elsif requested_action = ''withdraw'' and article_row.author_id = actor
        and article_row.workflow_status in (''submitted'', ''moderator_review'', ''changes_requested'') then
      next_status := ''withdrawn'';
    elsif requested_action = ''restore_withdrawn'' and article_row.author_id = actor
        and article_row.workflow_status = ''withdrawn'' then
      next_status := ''draft'';
    elsif requested_action = ''delete_withdrawn'' and article_row.author_id = actor
        and article_row.workflow_status = ''withdrawn'' then
      next_status := ''archived'';
    elsif requested_action = ''start_review'' and article_row.workflow_status = ''submitted'' then
      next_status := ''moderator_review'';
    elsif requested_action = ''send_to_editor'' and article_row.workflow_status = ''moderator_review'' then
      next_status := ''editor_review'';
    elsif requested_action in (''request_changes'', ''reject'')
        and article_row.workflow_status in (''moderator_review'', ''editor_review'') then
      next_status := case requested_action when ''reject'' then ''rejected'' else ''changes_requested'' end;
    elsif requested_action = ''publish'' and article_row.workflow_status in (''editor_review'', ''scheduled'') then
      next_status := ''published'';
    elsif requested_action = ''schedule'' and article_row.workflow_status in (''editor_review'', ''scheduled'')
        and scheduled_for is not null and scheduled_for > now() then
      next_status := ''scheduled'';
    elsif requested_action = ''unschedule'' and article_row.workflow_status = ''scheduled'' then
      next_status := ''editor_review'';
    elsif requested_action = ''reopen_rejected'' and article_row.workflow_status = ''rejected'' then
      next_status := ''submitted'';
    elsif requested_action = ''archive'' and article_row.workflow_status in (''published'', ''scheduled'', ''rejected'') then
      next_status := ''archived'';
    else
      raise exception ''This organization role cannot perform that action in the current story state''
        using errcode=''42501'';
    end if;
  else
    raise exception ''This role cannot perform that action in the current story state'' using errcode=''42501'';
  end if;'
);

drop policy if exists "Articles visible to public or authorized newsroom roles" on public.articles;
create policy "Articles visible to public or authorized newsroom roles"
on public.articles for select to anon, authenticated
using (
  (
    status = 'published' and published_at is not null and published_at <= now()
    and public.chowk_org_module_is_enabled('newsroom')
  )
  or (
    (select auth.uid()) is not null
    and public.chowk_org_can_access_article(
      'newsroom.articles.read', author_id, assigned_to, workflow_status, reporting_location_id
    )
  )
);

drop policy if exists "Authors view own revisions and staff view assigned queues" on public.article_revisions;
create policy "Authors view own revisions and staff view assigned queues"
on public.article_revisions for select to authenticated
using (
  exists (
    select 1 from public.articles article
    where article.id = article_revisions.article_id
      and public.chowk_org_can_access_article(
        'newsroom.articles.read', article.author_id, article.assigned_to,
        article.workflow_status, article.reporting_location_id
      )
  )
);

drop policy if exists "Authors view own workflow history and staff view assigned queues" on public.article_workflow_events;
create policy "Authors view own workflow history and staff view assigned queues"
on public.article_workflow_events for select to authenticated
using (
  exists (
    select 1 from public.articles article
    where article.id = article_workflow_events.article_id
      and public.chowk_org_can_access_article(
        'newsroom.articles.read', article.author_id, article.assigned_to,
        article.workflow_status, article.reporting_location_id
      )
  )
);

create or replace function public.chowk_org_write_configuration_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'organization_settings' then
    insert into public.organization_setting_events(
      setting_id, actor_id, revision, before_value, after_value
    ) values (
      coalesce(new.id, old.id), (select auth.uid()),
      coalesce(new.revision, old.revision),
      case when tg_op = 'INSERT' then null else old.value end,
      case when tg_op = 'DELETE' then null else new.value end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists audit_organization_settings on public.organization_settings;
create trigger audit_organization_settings
  after insert or update on public.organization_settings
  for each row execute function public.chowk_org_write_configuration_event();

grant execute on function public.chowk_org_is_super_admin() to authenticated;
grant execute on function public.chowk_org_configuration_snapshot() to authenticated;
grant execute on function public.chowk_org_save_identity(text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.chowk_org_set_person_access(uuid,uuid,uuid) to authenticated;
grant execute on function public.chowk_org_save_setting(text,jsonb,text,integer) to authenticated;
grant execute on function public.chowk_org_archive_setting(uuid) to authenticated;
grant execute on function public.chowk_org_set_module(text,boolean,jsonb,integer) to authenticated;
grant execute on function public.chowk_org_module_is_enabled(text) to anon, authenticated;
grant execute on function public.chowk_org_save_workflow(uuid,text,text,text,text,boolean) to authenticated;
grant execute on function public.chowk_org_save_workflow_state(uuid,uuid,text,text,boolean,boolean,integer) to authenticated;
grant execute on function public.chowk_org_save_workflow_transition(uuid,uuid,uuid,uuid,text,text,text,boolean,boolean,integer,boolean) to authenticated;
grant execute on function public.chowk_org_delete_workflow(uuid) to authenticated;
grant execute on function public.chowk_org_delete_workflow_state(uuid,uuid) to authenticated;
grant execute on function public.chowk_org_delete_workflow_transition(uuid) to authenticated;
grant execute on function public.chowk_org_start_workflow(uuid,text,text) to authenticated;
grant execute on function public.chowk_org_available_workflows() to authenticated;
grant execute on function public.chowk_org_workflow_instances(uuid) to authenticated;
grant execute on function public.chowk_org_workflow_approval_inbox() to authenticated;
grant execute on function public.chowk_org_transition_workflow(uuid,uuid,integer,text) to authenticated;
grant execute on function public.chowk_org_decide_workflow_approval(uuid,integer,boolean,text) to authenticated;
grant execute on function public.chowk_org_user_has_permission(text,uuid,uuid) to authenticated;
grant execute on function public.chowk_org_user_has_any_permission(text[]) to authenticated;
grant execute on function public.chowk_org_user_has_capability(text) to authenticated;
grant execute on function public.chowk_org_my_permissions() to authenticated;
grant execute on function public.chowk_user_has_permission(text,uuid,uuid) to authenticated;
grant execute on function public.chowk_org_article_permission(text) to authenticated;
grant execute on function public.chowk_org_can_access_article(text,uuid,uuid,text,bigint) to anon, authenticated;

revoke all on function public.chowk_org_write_configuration_event() from public, anon, authenticated;
revoke all on function public.chowk_org_audit_person_access() from public, anon, authenticated;
revoke all on function public.chowk_org_version_module_configuration() from public, anon, authenticated;
revoke all on function public.chowk_org_sync_staff_relationship() from public, anon, authenticated;
revoke all on function public.chowk_org_sync_reporter_relationship() from public, anon, authenticated;
revoke all on function public.chowk_org_is_super_admin() from public, anon;
revoke all on function public.chowk_org_configuration_snapshot() from public, anon;
revoke all on function public.chowk_org_save_identity(text,text,text,text,text,text,text,text,text) from public, anon;
revoke all on function public.chowk_org_set_person_access(uuid,uuid,uuid) from public, anon;
revoke all on function public.chowk_org_save_setting(text,jsonb,text,integer) from public, anon;
revoke all on function public.chowk_org_archive_setting(uuid) from public, anon;
revoke all on function public.chowk_org_set_module(text,boolean,jsonb,integer) from public, anon;
revoke all on function public.chowk_org_module_is_enabled(text) from public;
revoke all on function public.chowk_org_save_workflow(uuid,text,text,text,text,boolean) from public, anon;
revoke all on function public.chowk_org_save_workflow_state(uuid,uuid,text,text,boolean,boolean,integer) from public, anon;
revoke all on function public.chowk_org_save_workflow_transition(uuid,uuid,uuid,uuid,text,text,text,boolean,boolean,integer,boolean) from public, anon;
revoke all on function public.chowk_org_delete_workflow(uuid) from public, anon;
revoke all on function public.chowk_org_delete_workflow_state(uuid,uuid) from public, anon;
revoke all on function public.chowk_org_delete_workflow_transition(uuid) from public, anon;
revoke all on function public.chowk_org_start_workflow(uuid,text,text) from public, anon;
revoke all on function public.chowk_org_available_workflows() from public, anon;
revoke all on function public.chowk_org_workflow_instances(uuid) from public, anon;
revoke all on function public.chowk_org_workflow_approval_inbox() from public, anon;
revoke all on function public.chowk_org_transition_workflow(uuid,uuid,integer,text) from public, anon;
revoke all on function public.chowk_org_decide_workflow_approval(uuid,integer,boolean,text) from public, anon;
revoke all on function public.chowk_org_user_has_permission(text,uuid,uuid) from public, anon;
revoke all on function public.chowk_org_user_has_any_permission(text[]) from public, anon;
revoke all on function public.chowk_org_user_has_capability(text) from public, anon;
revoke all on function public.chowk_org_my_permissions() from public, anon;
revoke all on function public.chowk_user_has_permission(text,uuid,uuid) from public, anon;
revoke all on function public.chowk_org_permission_module_enabled(text) from public, anon, authenticated;
revoke all on function public.chowk_org_article_permission(text) from public, anon;
revoke all on function public.chowk_org_can_access_article(text,uuid,uuid,text,bigint) from public, anon;
revoke all on function public.chowk_org_patch_newsroom_function(regprocedure,text,text) from public, anon, authenticated;
