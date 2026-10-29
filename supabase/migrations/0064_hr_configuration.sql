create table if not exists public.hr_departments (
  id uuid primary key default gen_random_uuid(),
  department_key text not null unique check (department_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  name text not null check (length(trim(name)) between 2 and 100),
  description text not null default '' check (length(description) <= 2000),
  parent_id uuid references public.hr_departments(id) on delete restrict,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);

create table if not exists public.hr_positions (
  id uuid primary key default gen_random_uuid(),
  position_key text not null unique check (position_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  title text not null check (length(trim(title)) between 2 and 100),
  description text not null default '' check (length(description) <= 5000),
  department_id uuid references public.hr_departments(id) on delete restrict,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_permission_catalog (
  permission_key text primary key check (permission_key ~ '^[a-z][a-z0-9_.-]{2,99}$'),
  area text not null check (length(trim(area)) between 2 and 80),
  description text not null check (length(trim(description)) between 5 and 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.organization_permission_catalog(permission_key, area, description)
values
  ('hr.console.access', 'HR', 'Access the HR administration workspace.'),
  ('hr.configuration.manage', 'HR', 'Create and manage departments, positions, access roles, and role permissions.'),
  ('hr.employee.read', 'HR', 'View employee assignment and lifecycle records.'),
  ('hr.employee.manage', 'HR', 'Create, change, suspend, and end employee assignments.'),
  ('hr.policy.manage', 'HR', 'Create, publish, retire, and remove unused HR policy drafts.'),
  ('newsroom.articles.read', 'Newsroom', 'View newsroom article records.'),
  ('newsroom.articles.create', 'Newsroom', 'Create newsroom article records.'),
  ('newsroom.articles.edit', 'Newsroom', 'Edit newsroom article records.'),
  ('newsroom.articles.review', 'Newsroom', 'Review submitted newsroom articles.'),
  ('newsroom.articles.publish', 'Newsroom', 'Publish and schedule newsroom articles.'),
  ('newsroom.comments.moderate', 'Newsroom', 'Moderate reader comments.'),
  ('newsroom.reports.manage', 'Newsroom', 'Manage reports submitted against articles.'),
  ('newsroom.media.manage', 'Newsroom', 'Manage newsroom media catalog and streams.'),
  ('newsroom.locations.manage', 'Newsroom', 'Manage newsroom location configuration.'),
  ('newsroom.people.manage', 'Newsroom', 'Manage newsroom people access and credentials.')
on conflict (permission_key) do update
set area = excluded.area,
    description = excluded.description,
    is_active = true;

create table if not exists public.organization_access_roles (
  id uuid primary key default gen_random_uuid(),
  role_key text not null unique check (role_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  name text not null check (length(trim(name)) between 2 and 100),
  description text not null default '' check (length(description) <= 2000),
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_access_role_permissions (
  role_id uuid not null references public.organization_access_roles(id) on delete cascade,
  permission_key text not null references public.organization_permission_catalog(permission_key) on delete restrict,
  scope text not null check (scope in ('all', 'department', 'assigned', 'own')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_key)
);

create sequence if not exists public.hr_employee_number_seq;

create table if not exists public.hr_employees (
  id uuid primary key references public.profiles(id) on delete restrict,
  employee_number text not null unique default (
    'EMP-' || to_char(nextval('public.hr_employee_number_seq'), '000000')
  ),
  employment_type text not null default 'other'
    check (employment_type in ('full_time', 'part_time', 'fixed_term', 'temporary', 'intern', 'other')),
  employment_status text not null default 'preboarding'
    check (employment_status in ('preboarding', 'active', 'suspended', 'terminated')),
  hired_on date,
  terminated_on date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((employment_status = 'terminated') = (terminated_on is not null)),
  check (employment_status = 'preboarding' or hired_on is not null)
);

create table if not exists public.hr_employee_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete restrict,
  department_id uuid references public.hr_departments(id) on delete restrict,
  position_id uuid references public.hr_positions(id) on delete restrict,
  access_role_id uuid not null references public.organization_access_roles(id) on delete restrict,
  manager_employee_id uuid references public.hr_employees(id) on delete restrict,
  status text not null check (status in ('pending', 'active', 'suspended', 'ended')),
  is_primary boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  end_reason text not null default '' check (length(end_reason) <= 1000),
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (manager_employee_id is null or manager_employee_id <> employee_id),
  check ((status = 'ended') = (ends_at is not null)),
  check (status not in ('active', 'suspended', 'ended') or starts_at is not null),
  check (status <> 'ended' or length(trim(end_reason)) >= 2)
);

create unique index if not exists hr_employee_one_current_primary_assignment_idx
  on public.hr_employee_assignments(employee_id)
  where is_primary and status in ('pending', 'active', 'suspended');
create index if not exists hr_employee_assignments_employee_history_idx
  on public.hr_employee_assignments(employee_id, created_at desc);
create index if not exists hr_employee_assignments_department_idx
  on public.hr_employee_assignments(department_id, status);
create index if not exists hr_employee_assignments_manager_idx
  on public.hr_employee_assignments(manager_employee_id, status);

create table if not exists public.hr_policy_documents (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null unique check (policy_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  title text not null check (length(trim(title)) between 2 and 160),
  description text not null default '' check (length(description) <= 2000),
  department_id uuid references public.hr_departments(id) on delete restrict,
  access_role_id uuid references public.organization_access_roles(id) on delete restrict,
  requires_acceptance boolean not null default true,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hr_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.hr_policy_documents(id) on delete restrict,
  version text not null check (version ~ '^[A-Za-z0-9._-]{1,40}$'),
  content text not null check (length(trim(content)) between 1 and 100000),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('draft', 'published', 'retired')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  unique (policy_id, version),
  check ((status = 'draft') = (published_at is null))
);

create unique index if not exists hr_policy_one_published_version_idx
  on public.hr_policy_versions(policy_id)
  where status = 'published';

create table if not exists public.hr_policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete restrict,
  policy_version_id uuid not null references public.hr_policy_versions(id) on delete restrict,
  policy_key_snapshot text not null,
  version_snapshot text not null,
  sha256_snapshot text not null,
  accepted_at timestamptz not null default now(),
  unique (employee_id, policy_version_id)
);

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
  select case
    when (select auth.uid()) is null then false
    when exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'super_admin'
    ) then true
    when exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'admin'
    ) then true
    else exists (
      select 1
      from public.hr_employee_assignments assignment
      join public.organization_access_roles access_role on access_role.id = assignment.access_role_id
      join public.organization_access_role_permissions permission
        on permission.role_id = access_role.id
      where assignment.employee_id = (select auth.uid())
        and assignment.status = 'active'
        and access_role.is_active
        and permission.permission_key = target_permission
        and case permission.scope
          when 'all' then true
          when 'department' then target_department is not null
            and assignment.department_id = target_department
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

create or replace function public.chowk_hr_save_department(
  target_id uuid,
  target_key text,
  target_name text,
  target_description text,
  target_parent_id uuid,
  target_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  saved_id uuid;
begin
  if actor is null or not public.chowk_user_has_permission('hr.configuration.manage') then
    raise exception 'HR configuration permission required' using errcode = '42501';
  end if;
  if target_key is null
      or target_key !~ '^[a-z][a-z0-9_]{1,49}$'
      or target_name is null or length(trim(target_name)) not between 2 and 100
      or length(coalesce(target_description, '')) > 2000
      or target_is_active is null
      or (target_parent_id is not null and target_parent_id = target_id) then
    raise exception 'Enter a valid department key, name, description, and status'
      using errcode = '22023';
  end if;
  if target_parent_id is not null and not exists (
    select 1 from public.hr_departments where id = target_parent_id and is_active
  ) then
    raise exception 'Choose an active parent department' using errcode = '23514';
  end if;
  if target_id is not null and target_parent_id is not null and exists (
    with recursive descendants(id) as (
      select target_id
      union all
      select department.id
      from public.hr_departments department
      join descendants on department.parent_id = descendants.id
    )
    select 1 from descendants where id = target_parent_id
  ) then
    raise exception 'A department cannot be moved beneath itself or one of its descendants'
      using errcode = '23514';
  end if;
  if target_id is null then
    insert into public.hr_departments(department_key, name, description, parent_id, is_active, created_by)
    values (target_key, trim(target_name), trim(coalesce(target_description, '')),
      target_parent_id, target_is_active, actor)
    returning id into saved_id;
  else
    update public.hr_departments
    set department_key = target_key, name = trim(target_name),
        description = trim(coalesce(target_description, '')), parent_id = target_parent_id,
        is_active = target_is_active, updated_at = now()
    where id = target_id returning id into saved_id;
    if saved_id is null then
      raise exception 'Department not found' using errcode = 'P0002';
    end if;
  end if;
  return saved_id;
end;
$$;

create or replace function public.chowk_hr_delete_department(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.chowk_user_has_permission('hr.configuration.manage') then
    raise exception 'HR configuration permission required' using errcode = '42501';
  end if;
  if exists (select 1 from public.hr_positions where department_id = target_id)
      or exists (select 1 from public.hr_employee_assignments where department_id = target_id)
      or exists (select 1 from public.hr_departments where parent_id = target_id)
      or exists (select 1 from public.hr_policy_documents where department_id = target_id) then
    raise exception 'This department is in use; deactivate it to preserve employee and organization history'
      using errcode = '23503';
  end if;
  delete from public.hr_departments where id = target_id;
  if not found then raise exception 'Department not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.chowk_hr_save_position(
  target_id uuid,
  target_key text,
  target_title text,
  target_description text,
  target_department_id uuid,
  target_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  saved_id uuid;
begin
  if actor is null or not public.chowk_user_has_permission('hr.configuration.manage') then
    raise exception 'HR configuration permission required' using errcode = '42501';
  end if;
  if target_key is null
      or target_key !~ '^[a-z][a-z0-9_]{1,49}$'
      or target_title is null or length(trim(target_title)) not between 2 and 100
      or length(coalesce(target_description, '')) > 5000
      or target_is_active is null then
    raise exception 'Enter a valid position key, title, description, and status'
      using errcode = '22023';
  end if;
  if target_department_id is not null and not exists (
    select 1 from public.hr_departments where id = target_department_id and is_active
  ) then
    raise exception 'Choose an active department' using errcode = '23514';
  end if;
  if target_id is null then
    insert into public.hr_positions(position_key, title, description, department_id, is_active, created_by)
    values (target_key, trim(target_title), trim(coalesce(target_description, '')),
      target_department_id, target_is_active, actor)
    returning id into saved_id;
  else
    update public.hr_positions
    set position_key = target_key, title = trim(target_title),
        description = trim(coalesce(target_description, '')), department_id = target_department_id,
        is_active = target_is_active, updated_at = now()
    where id = target_id returning id into saved_id;
    if saved_id is null then raise exception 'Position not found' using errcode = 'P0002'; end if;
  end if;
  return saved_id;
end;
$$;

create or replace function public.chowk_hr_delete_position(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.chowk_user_has_permission('hr.configuration.manage') then
    raise exception 'HR configuration permission required' using errcode = '42501';
  end if;
  if exists (select 1 from public.hr_employee_assignments where position_id = target_id) then
    raise exception 'This position has assignment history; deactivate it instead of deleting it'
      using errcode = '23503';
  end if;
  delete from public.hr_positions where id = target_id;
  if not found then raise exception 'Position not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.chowk_hr_save_access_role(
  target_id uuid,
  target_key text,
  target_name text,
  target_description text,
  target_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  existing public.organization_access_roles%rowtype;
  saved_id uuid;
begin
  if actor is null or not public.chowk_user_has_permission('hr.configuration.manage') then
    raise exception 'HR configuration permission required' using errcode = '42501';
  end if;
  if target_key is null
      or target_key !~ '^[a-z][a-z0-9_]{1,49}$'
      or target_name is null or length(trim(target_name)) not between 2 and 100
      or length(coalesce(target_description, '')) > 2000
      or target_is_active is null then
    raise exception 'Enter a valid access role key, name, description, and status'
      using errcode = '22023';
  end if;
  if target_id is null then
    insert into public.organization_access_roles(role_key, name, description, is_active, created_by)
    values (target_key, trim(target_name), trim(coalesce(target_description, '')),
      target_is_active, actor)
    returning id into saved_id;
  else
    select * into existing from public.organization_access_roles where id = target_id for update;
    if not found then raise exception 'Access role not found' using errcode = 'P0002'; end if;
    if existing.is_system and not target_is_active then
      raise exception 'Built-in HR access roles cannot be deactivated' using errcode = '23514';
    end if;
    update public.organization_access_roles
    set role_key = target_key, name = trim(target_name),
        description = trim(coalesce(target_description, '')),
        is_active = target_is_active, updated_at = now()
    where id = target_id returning id into saved_id;
  end if;
  return saved_id;
end;
$$;

create or replace function public.chowk_hr_delete_access_role(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare existing public.organization_access_roles%rowtype;
begin
  if not public.chowk_user_has_permission('hr.configuration.manage') then
    raise exception 'HR configuration permission required' using errcode = '42501';
  end if;
  select * into existing from public.organization_access_roles where id = target_id for update;
  if not found then raise exception 'Access role not found' using errcode = 'P0002'; end if;
  if existing.is_system or exists (
    select 1 from public.hr_employee_assignments where access_role_id = target_id
  ) or exists (
    select 1 from public.hr_policy_documents where access_role_id = target_id
  ) then
    raise exception 'This access role is in use or protected; deactivate it to preserve history'
      using errcode = '23503';
  end if;
  delete from public.organization_access_roles where id = target_id;
end;
$$;

create or replace function public.chowk_hr_set_role_permissions(
  target_role_id uuid,
  target_permissions jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  actor uuid := (select auth.uid());
begin
  if not public.chowk_user_has_permission('hr.configuration.manage') then
    raise exception 'HR configuration permission required' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.organization_access_roles where id = target_role_id and is_system
  ) and not exists (
    select 1 from public.profiles where id = actor and role in ('admin', 'super_admin')
  ) then
    raise exception 'Only existing admins can change protected HR role permissions'
      using errcode = '42501';
  end if;
  if jsonb_typeof(target_permissions) is distinct from 'array'
      or jsonb_array_length(target_permissions) > 200
      or jsonb_array_length(target_permissions) <> (
        select count(distinct value ->> 'permission_key')
        from jsonb_array_elements(target_permissions)
      )
      or not exists (select 1 from public.organization_access_roles where id = target_role_id and is_active) then
    raise exception 'Choose an active access role and provide a valid permission list'
      using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(target_permissions)
  loop
    if jsonb_typeof(item) is distinct from 'object'
        or item ->> 'permission_key' is null
        or item ->> 'scope' is null
        or item ->> 'scope' not in ('all', 'department', 'assigned', 'own')
        or (
          item ->> 'permission_key' in (
            'hr.console.access', 'hr.configuration.manage', 'hr.policy.manage'
          )
          and item ->> 'scope' <> 'all'
        )
        or not exists (
          select 1 from public.organization_permission_catalog
          where permission_key = item ->> 'permission_key' and is_active
        ) then
      raise exception 'Each permission must be supported and have a valid scope'
        using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.profiles
      where id = actor and role in ('admin', 'super_admin')
    ) and not exists (
      select 1
      from public.hr_employee_assignments actor_assignment
      join public.organization_access_role_permissions actor_permission
        on actor_permission.role_id = actor_assignment.access_role_id
      where actor_assignment.employee_id = actor
        and actor_assignment.status = 'active'
        and actor_permission.permission_key = item ->> 'permission_key'
        and (
          actor_permission.scope = 'all'
          or (
            actor_permission.scope = item ->> 'scope'
            and (item ->> 'scope' <> 'department' or actor_assignment.department_id is not null)
          )
        )
    ) then
      raise exception 'You cannot delegate a permission or scope you do not hold yourself'
        using errcode = '42501';
    end if;
  end loop;
  delete from public.organization_access_role_permissions where role_id = target_role_id;
  insert into public.organization_access_role_permissions(role_id, permission_key, scope, created_by)
  select target_role_id, item ->> 'permission_key', item ->> 'scope', (select auth.uid())
  from jsonb_array_elements(target_permissions) item
  on conflict (role_id, permission_key) do update
  set scope = excluded.scope, created_by = excluded.created_by, created_at = now();
end;
$$;

create or replace function public.chowk_hr_save_employee_assignment(
  target_id uuid,
  target_employee_id uuid,
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
declare
  actor uuid := (select auth.uid());
  existing public.hr_employee_assignments%rowtype;
  saved_id uuid;
begin
  if actor is null or not public.chowk_user_has_permission('hr.employee.manage', target_employee_id, target_department_id) then
    raise exception 'Permission to manage this employee assignment is required' using errcode = '42501';
  end if;
  if target_status is null or target_status not in ('pending', 'active', 'suspended', 'ended')
      or target_is_primary is null
      or (target_status in ('active', 'suspended', 'ended') and target_starts_at is null)
      or (target_status = 'ended' and length(trim(coalesce(target_end_reason, ''))) < 2)
      or (target_status <> 'ended' and length(coalesce(target_end_reason, '')) > 1000)
      or (target_employment_type is not null and target_employment_type not in (
        'full_time', 'part_time', 'fixed_term', 'temporary', 'intern', 'other'
      )) then
    raise exception 'Enter a valid assignment status, start date, and end reason'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = target_employee_id) then
    raise exception 'Employee account not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.organization_access_roles where id = target_access_role_id and is_active) then
    raise exception 'Choose an active access role' using errcode = '23514';
  end if;
  if target_department_id is not null and not exists (
    select 1 from public.hr_departments where id = target_department_id and is_active
  ) then raise exception 'Choose an active department' using errcode = '23514'; end if;
  if target_position_id is not null and not exists (
    select 1 from public.hr_positions
    where id = target_position_id and is_active
      and (department_id is null or department_id is not distinct from target_department_id)
  ) then raise exception 'Choose an active position in the selected department' using errcode = '23514'; end if;
  if target_manager_employee_id is not null and not exists (
    select 1 from public.hr_employees
    where id = target_manager_employee_id and employment_status = 'active'
  ) then raise exception 'Manager account not found' using errcode = 'P0002'; end if;

  if target_id is not null then
    select * into existing from public.hr_employee_assignments where id = target_id for update;
    if not found then raise exception 'Employee assignment not found' using errcode = 'P0002'; end if;
    if existing.employee_id <> target_employee_id then
      raise exception 'An assignment cannot be moved to another employee' using errcode = '23514';
    end if;
    if not public.chowk_user_has_permission(
      'hr.employee.manage', target_employee_id, existing.department_id
    ) then
      raise exception 'Permission to manage the employee in their current department is required'
        using errcode = '42501';
    end if;
    if existing.status = 'ended' then
      raise exception 'Ended assignments are immutable; create a new assignment for a return to work'
        using errcode = '23514';
    end if;
  end if;
  if exists (
    select 1
    from public.organization_access_role_permissions requested
    where requested.role_id = target_access_role_id
      and not exists (
        select 1
        from public.hr_employee_assignments actor_assignment
        join public.organization_access_role_permissions actor_permission
          on actor_permission.role_id = actor_assignment.access_role_id
        where actor_assignment.employee_id = actor
          and actor_assignment.status = 'active'
          and actor_permission.permission_key = requested.permission_key
          and (
            actor_permission.scope = 'all'
            or (
              actor_permission.scope = requested.scope
              and (
                requested.scope <> 'department'
                or actor_assignment.department_id = target_department_id
              )
            )
          )
      )
  ) and not exists (
    select 1 from public.profiles
    where id = actor and role in ('admin', 'super_admin')
  ) then
    raise exception 'You cannot assign permissions or scopes you do not hold yourself'
      using errcode = '42501';
  end if;

  insert into public.hr_employees(
    id, employment_type, employment_status, hired_on, terminated_on, created_by
  )
  values (
    target_employee_id,
    coalesce(target_employment_type, 'other'),
    case target_status
      when 'pending' then 'preboarding'
      when 'ended' then 'terminated'
      else target_status
    end,
    case when target_status in ('active', 'suspended', 'ended') then target_starts_at::date else null end,
    case when target_status = 'ended' then coalesce(target_starts_at::date, current_date) else null end,
    actor
  )
  on conflict (id) do update
  set employment_type = coalesce(target_employment_type, hr_employees.employment_type),
      updated_at = now();

  if target_id is null then
    insert into public.hr_employee_assignments(
      employee_id, department_id, position_id, access_role_id, manager_employee_id, status,
      is_primary, starts_at, ends_at, end_reason, assigned_by
    )
    values (
      target_employee_id, target_department_id, target_position_id, target_access_role_id,
      target_manager_employee_id, target_status, target_is_primary, target_starts_at,
      case when target_status = 'ended' then now() else null end,
      trim(coalesce(target_end_reason, '')), actor
    ) returning id into saved_id;
  else
    update public.hr_employee_assignments
    set department_id = target_department_id, position_id = target_position_id,
        access_role_id = target_access_role_id, manager_employee_id = target_manager_employee_id,
        status = target_status, is_primary = target_is_primary, starts_at = target_starts_at,
        ends_at = case when target_status = 'ended' then coalesce(ends_at, now()) else null end,
        end_reason = trim(coalesce(target_end_reason, '')), updated_at = now()
    where id = target_id returning id into saved_id;
  end if;
  update public.hr_employees employee
  set employment_status = case
        when exists (
          select 1 from public.hr_employee_assignments assignment
          where assignment.employee_id = employee.id and assignment.status = 'active'
        ) then 'active'
        when exists (
          select 1 from public.hr_employee_assignments assignment
          where assignment.employee_id = employee.id and assignment.status = 'suspended'
        ) then 'suspended'
        when exists (
          select 1 from public.hr_employee_assignments assignment
          where assignment.employee_id = employee.id and assignment.status = 'pending'
        ) then 'preboarding'
        else 'terminated'
      end,
      hired_on = coalesce(employee.hired_on, (
        select min(assignment.starts_at)::date
        from public.hr_employee_assignments assignment
        where assignment.employee_id = employee.id
          and assignment.status in ('active', 'suspended', 'ended')
      )),
      terminated_on = case
        when exists (
          select 1 from public.hr_employee_assignments assignment
          where assignment.employee_id = employee.id
            and assignment.status in ('pending', 'active', 'suspended')
        ) then null
        else coalesce((
          select max(assignment.ends_at)::date
          from public.hr_employee_assignments assignment
          where assignment.employee_id = employee.id and assignment.status = 'ended'
        ), current_date)
      end,
      updated_at = now()
  where employee.id = target_employee_id;
  return saved_id;
end;
$$;

create or replace function public.chowk_hr_save_policy(
  target_id uuid,
  target_key text,
  target_title text,
  target_description text,
  target_department_id uuid,
  target_access_role_id uuid,
  target_requires_acceptance boolean,
  target_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); saved_id uuid;
begin
  if actor is null or not public.chowk_user_has_permission('hr.policy.manage') then
    raise exception 'HR policy management permission required' using errcode = '42501';
  end if;
  if target_key is null
      or target_key !~ '^[a-z][a-z0-9_]{1,49}$'
      or target_title is null or length(trim(target_title)) not between 2 and 160
      or length(coalesce(target_description, '')) > 2000
      or target_requires_acceptance is null or target_is_active is null then
    raise exception 'Enter a valid policy key, title, description, and status' using errcode = '22023';
  end if;
  if target_department_id is not null and not exists (
    select 1 from public.hr_departments where id = target_department_id and is_active
  ) then raise exception 'Choose an active policy department' using errcode = '23514'; end if;
  if target_access_role_id is not null and not exists (
    select 1 from public.organization_access_roles where id = target_access_role_id and is_active
  ) then raise exception 'Choose an active policy access role' using errcode = '23514'; end if;
  if target_id is null then
    insert into public.hr_policy_documents(
      policy_key, title, description, department_id, access_role_id,
      requires_acceptance, is_active, created_by
    ) values (
      target_key, trim(target_title), trim(coalesce(target_description, '')),
      target_department_id, target_access_role_id,
      target_requires_acceptance, target_is_active, actor
    ) returning id into saved_id;
  else
    update public.hr_policy_documents
    set policy_key = target_key, title = trim(target_title),
        description = trim(coalesce(target_description, '')),
        department_id = target_department_id, access_role_id = target_access_role_id,
        requires_acceptance = target_requires_acceptance, is_active = target_is_active,
        updated_at = now()
    where id = target_id returning id into saved_id;
    if saved_id is null then raise exception 'Policy not found' using errcode = 'P0002'; end if;
  end if;
  return saved_id;
end;
$$;

create or replace function public.chowk_hr_save_policy_draft(
  target_policy_id uuid,
  target_id uuid,
  target_version text,
  target_content text,
  target_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare saved_id uuid;
begin
  if not public.chowk_user_has_permission('hr.policy.manage') then
    raise exception 'HR policy management permission required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.hr_policy_documents where id = target_policy_id and is_active)
      or target_version is null or target_version !~ '^[A-Za-z0-9._-]{1,40}$'
      or length(trim(coalesce(target_content, ''))) not between 1 and 100000
      or target_sha256 is null or target_sha256 !~ '^[a-f0-9]{64}$'
      or encode(extensions.digest(convert_to(target_content, 'UTF8'), 'sha256'), 'hex') <> target_sha256 then
    raise exception 'Provide an active policy, valid version, content, and matching SHA-256 digest'
      using errcode = '22023';
  end if;
  if target_id is not null and not exists (
    select 1 from public.hr_policy_versions where id = target_id
      and policy_id = target_policy_id and status = 'draft'
  ) then
    raise exception 'Only an existing draft can be edited' using errcode = '23514';
  end if;
  if target_id is null then
    insert into public.hr_policy_versions(policy_id, version, content, sha256, status, created_by)
    values (target_policy_id, target_version, target_content, target_sha256, 'draft', (select auth.uid()))
    returning id into saved_id;
  else
    update public.hr_policy_versions
    set version = target_version, content = target_content, sha256 = target_sha256
    where id = target_id returning id into saved_id;
  end if;
  return saved_id;
end;
$$;

create or replace function public.chowk_hr_publish_policy_version(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare policy_id_value uuid;
begin
  if not public.chowk_user_has_permission('hr.policy.manage') then
    raise exception 'HR policy management permission required' using errcode = '42501';
  end if;
  select policy_id into policy_id_value from public.hr_policy_versions
  where id = target_id and status = 'draft' for update;
  if not found then raise exception 'Policy draft not found' using errcode = 'P0002'; end if;
  update public.hr_policy_versions set status = 'retired'
  where policy_id = policy_id_value and status = 'published';
  update public.hr_policy_versions
  set status = 'published', published_by = (select auth.uid()), published_at = now()
  where id = target_id;
end;
$$;

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
        or exists (select 1 from public.hr_policy_documents where department_id = target_id) then
      raise exception 'Department is in use; deactivate it to preserve history' using errcode = '23503';
    end if;
    delete from public.hr_departments where id = target_id;
  elsif target_table = 'position' then
    if not public.chowk_user_has_permission('hr.configuration.manage') then
      raise exception 'HR configuration permission required' using errcode = '42501';
    end if;
    if exists (select 1 from public.hr_employee_assignments where position_id = target_id) then
      raise exception 'Position is in use; deactivate it to preserve history' using errcode = '23503';
    end if;
    delete from public.hr_positions where id = target_id;
  elsif target_table = 'access_role' then
    if not public.chowk_user_has_permission('hr.configuration.manage') then
      raise exception 'HR configuration permission required' using errcode = '42501';
    end if;
    if exists (select 1 from public.organization_access_roles where id = target_id and is_system)
        or exists (select 1 from public.hr_employee_assignments where access_role_id = target_id)
        or exists (select 1 from public.hr_policy_documents where access_role_id = target_id) then
      raise exception 'Access role is protected or in use; deactivate it to preserve history' using errcode = '23503';
    end if;
    delete from public.organization_access_roles where id = target_id;
  elsif target_table = 'policy_version' then
    if not public.chowk_user_has_permission('hr.policy.manage') then
      raise exception 'HR policy management permission required' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.hr_policy_versions version
      join public.hr_policy_acceptances acceptance on acceptance.policy_version_id = version.id
      where version.id = target_id
    ) then
      raise exception 'This policy version has acceptance history and cannot be deleted' using errcode = '23503';
    end if;
    delete from public.hr_policy_versions where id = target_id and status = 'draft';
  elsif target_table = 'policy' then
    if not public.chowk_user_has_permission('hr.policy.manage') then
      raise exception 'HR policy management permission required' using errcode = '42501';
    end if;
    if exists (select 1 from public.hr_policy_versions where policy_id = target_id) then
      raise exception 'Policy has version history; deactivate it instead of deleting it' using errcode = '23503';
    end if;
    delete from public.hr_policy_documents where id = target_id;
  else
    raise exception 'Unsupported HR record type' using errcode = '22023';
  end if;
  if not found then raise exception 'Unused draft record not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.chowk_hr_configuration_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  can_configure boolean := public.chowk_user_has_permission('hr.configuration.manage');
  actor_department uuid := (
    select assignment.department_id
    from public.hr_employee_assignments assignment
    where assignment.employee_id = (select auth.uid()) and assignment.status = 'active'
    order by assignment.is_primary desc, assignment.created_at desc
    limit 1
  );
  can_read_employees boolean := public.chowk_user_has_permission(
    'hr.employee.read', (select auth.uid()), actor_department
  );
  can_manage_employees boolean := public.chowk_user_has_permission(
    'hr.employee.manage', (select auth.uid()), actor_department
  );
  can_manage_policies boolean := public.chowk_user_has_permission('hr.policy.manage');
  can_read_configuration boolean := can_configure or can_read_employees
    or can_manage_employees or can_manage_policies;
begin
  if not (can_configure or can_read_employees or can_manage_employees or can_manage_policies) then
    raise exception 'HR workspace permission required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'capabilities', jsonb_build_object(
      'configuration', can_configure,
      'employees', can_read_employees or can_manage_employees or can_configure,
      'manage_employees', can_manage_employees or can_configure,
      'policies', can_manage_policies
    ),
    'departments', case when can_read_configuration then coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.name)
      from (
        select id, department_key, name, description, parent_id, is_active, created_at, updated_at
        from public.hr_departments
        where can_configure or is_active
      ) row_data
    ), '[]'::jsonb) else '[]'::jsonb end,
    'positions', case when can_read_configuration then coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.title)
      from (
        select id, position_key, title, description, department_id, is_active, created_at, updated_at
        from public.hr_positions
        where can_configure or is_active
      ) row_data
    ), '[]'::jsonb) else '[]'::jsonb end,
    'permissions', case when can_configure then coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.area, row_data.permission_key)
      from (
        select permission_key, area, description
        from public.organization_permission_catalog where is_active
      ) row_data
    ), '[]'::jsonb) else '[]'::jsonb end,
    'access_roles', case when can_read_configuration then coalesce((
      select jsonb_agg(
        to_jsonb(row_data) || jsonb_build_object('permissions', row_data.permissions)
        order by row_data.name
      )
      from (
        select role.id, role.role_key, role.name, role.description, role.is_system,
          role.is_active, role.created_at, role.updated_at,
          case when can_configure then coalesce((
            select jsonb_agg(jsonb_build_object(
              'permission_key', permission.permission_key, 'scope', permission.scope
            ) order by permission.permission_key)
            from public.organization_access_role_permissions permission
            where permission.role_id = role.id
          ), '[]'::jsonb) else '[]'::jsonb end as permissions
        from public.organization_access_roles role
        where can_configure or role.is_active
      ) row_data
    ), '[]'::jsonb) else '[]'::jsonb end,
    'assignments', case when can_read_employees or can_manage_employees or can_configure then coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.created_at desc)
      from (
        select assignment.id, assignment.employee_id, assignment.department_id,
          assignment.position_id, assignment.access_role_id, assignment.manager_employee_id,
          assignment.status, assignment.is_primary, assignment.starts_at,
          assignment.ends_at, assignment.end_reason, assignment.assigned_by,
          assignment.created_at, assignment.updated_at,
          person.full_name as employee_name, person.email as employee_email,
          employee.employee_number, employee.employment_type,
          employee.employment_status, employee.hired_on, employee.terminated_on,
          manager.full_name as manager_name,
          department.name as department_name, position.title as position_title,
          access_role.name as access_role_name
        from public.hr_employee_assignments assignment
        join public.hr_employees employee on employee.id = assignment.employee_id
        join public.profiles person on person.id = assignment.employee_id
        left join public.profiles manager on manager.id = assignment.manager_employee_id
        left join public.hr_departments department on department.id = assignment.department_id
        left join public.hr_positions position on position.id = assignment.position_id
        left join public.organization_access_roles access_role on access_role.id = assignment.access_role_id
        where can_configure
          or public.chowk_user_has_permission(
            'hr.employee.read', assignment.employee_id, assignment.department_id
          )
          or public.chowk_user_has_permission(
            'hr.employee.manage', assignment.employee_id, assignment.department_id
          )
      ) row_data
    ), '[]'::jsonb) else '[]'::jsonb end,
    'accounts', case when can_configure or can_read_employees or can_manage_employees then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', profile.id, 'full_name', profile.full_name, 'email', profile.email,
        'role', profile.role
      ) order by profile.full_name, profile.email)
      from public.profiles profile
      where can_configure or profile.id = (select auth.uid()) or exists (
        select 1
        from public.hr_employee_assignments assignment
        where assignment.employee_id = profile.id
          and assignment.status in ('pending', 'active', 'suspended')
          and (
            public.chowk_user_has_permission('hr.employee.read', assignment.employee_id, assignment.department_id)
            or public.chowk_user_has_permission('hr.employee.manage', assignment.employee_id, assignment.department_id)
          )
      )
    ), '[]'::jsonb) else '[]'::jsonb end,
    'employees', case when can_configure or can_read_employees or can_manage_employees then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', employee.id, 'employee_number', employee.employee_number,
        'employment_type', employee.employment_type,
        'employment_status', employee.employment_status,
        'full_name', profile.full_name, 'email', profile.email
      ) order by profile.full_name, profile.email)
      from public.hr_employees employee
      join public.profiles profile on profile.id = employee.id
      where employee.employment_status = 'active'
        and (can_configure or exists (
          select 1 from public.hr_employee_assignments assignment
          where assignment.employee_id = employee.id
            and (
              public.chowk_user_has_permission('hr.employee.read', assignment.employee_id, assignment.department_id)
              or public.chowk_user_has_permission('hr.employee.manage', assignment.employee_id, assignment.department_id)
            )
        ))
    ), '[]'::jsonb) else '[]'::jsonb end,
    'policies', case when can_manage_policies then coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.title)
      from (
        select policy.id, policy.policy_key, policy.title, policy.description,
          policy.department_id, policy.access_role_id,
          policy.requires_acceptance, policy.is_active, policy.created_at, policy.updated_at,
          coalesce((
            select jsonb_agg(to_jsonb(version_data) order by version_data.created_at desc)
            from (
              select version.id, version.version, version.content, version.sha256,
                version.status, version.created_at, version.published_at,
                coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'employee_id', acceptance.employee_id,
                    'full_name', profile.full_name,
                    'email', profile.email,
                    'accepted_at', acceptance.accepted_at
                  ) order by acceptance.accepted_at desc)
                  from public.hr_policy_acceptances acceptance
                  join public.profiles profile on profile.id = acceptance.employee_id
                  where acceptance.policy_version_id = version.id
                ), '[]'::jsonb) as accepted_employees
              from public.hr_policy_versions version
              where version.policy_id = policy.id
            ) version_data
          ), '[]'::jsonb) as versions
        from public.hr_policy_documents policy
      ) row_data
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create or replace function public.chowk_hr_accept_current_policy(target_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  version_row public.hr_policy_versions%rowtype;
  policy_row public.hr_policy_documents%rowtype;
  has_matching_assignment boolean;
begin
  if actor is null then raise exception 'Sign in to accept this policy' using errcode = '42501'; end if;
  select * into version_row
  from public.hr_policy_versions
  where id = target_version_id and status = 'published'
  for share;
  if not found then raise exception 'This published policy version is unavailable' using errcode = '23514'; end if;
  select * into policy_row
  from public.hr_policy_documents
  where id = version_row.policy_id and is_active and requires_acceptance
  for share;
  if not found then raise exception 'This policy does not require acceptance' using errcode = '23514'; end if;
  if policy_row.department_id is not null or policy_row.access_role_id is not null then
    select exists (
      select 1 from public.hr_employee_assignments assignment
      where assignment.employee_id = actor
        and assignment.status in ('pending', 'active', 'suspended')
        and (policy_row.department_id is null or assignment.department_id = policy_row.department_id)
        and (policy_row.access_role_id is null or assignment.access_role_id = policy_row.access_role_id)
    ) into has_matching_assignment;
    if not has_matching_assignment then
      raise exception 'This policy does not apply to your current employee assignment' using errcode = '42501';
    end if;
  end if;
  insert into public.hr_policy_acceptances(
    employee_id, policy_version_id, policy_key_snapshot, version_snapshot, sha256_snapshot
  )
  values (actor, version_row.id, policy_row.policy_key, version_row.version, version_row.sha256)
  on conflict (employee_id, policy_version_id) do nothing;
end;
$$;

create or replace function public.chowk_hr_current_policies()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Sign in to view current HR policies' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', version.id,
      'version', version.version,
      'content', version.content,
      'sha256', version.sha256,
      'published_at', version.published_at,
      'policy', jsonb_build_object(
        'policy_key', policy.policy_key, 'title', policy.title,
        'description', policy.description, 'requires_acceptance', policy.requires_acceptance
      ),
      'accepted_at', acceptance.accepted_at
    ) order by policy.title)
    from public.hr_policy_documents policy
    join public.hr_policy_versions version
      on version.policy_id = policy.id and version.status = 'published'
    left join public.hr_policy_acceptances acceptance
      on acceptance.policy_version_id = version.id and acceptance.employee_id = actor
    where policy.is_active
      and (
        (policy.department_id is null and policy.access_role_id is null)
        or exists (
          select 1 from public.hr_employee_assignments assignment
          where assignment.employee_id = actor
            and assignment.status in ('pending', 'active', 'suspended')
            and (policy.department_id is null or assignment.department_id = policy.department_id)
            and (policy.access_role_id is null or assignment.access_role_id = policy.access_role_id)
        )
      )
  ), '[]'::jsonb);
end;
$$;

create or replace function public.chowk_hr_require_policy_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  employee_id uuid;
  employee_department_id uuid;
  employee_access_role_id uuid;
begin
  if new.status <> 'active' or (
    tg_op = 'UPDATE'
    and old.status = 'active'
    and new.department_id is not distinct from old.department_id
    and new.access_role_id is not distinct from old.access_role_id
  ) then return new; end if;
  employee_id := new.employee_id;
  employee_department_id := new.department_id;
  employee_access_role_id := new.access_role_id;
  if not exists (
    select 1 from public.profiles
    where id = employee_id and length(trim(coalesce(full_name, ''))) >= 2
  ) then
    raise exception 'The employee must complete their name and HR profile before activation'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.hr_policy_documents policy
    where policy.is_active and policy.requires_acceptance
      and (policy.department_id is null or policy.department_id = employee_department_id)
      and (policy.access_role_id is null or policy.access_role_id = employee_access_role_id)
      and not exists (
        select 1 from public.hr_policy_versions current_version
        where current_version.policy_id = policy.id and current_version.status = 'published'
      )
  ) then
    raise exception 'An active required HR policy has no published version'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.hr_policy_documents policy
    join public.hr_policy_versions current_version
      on current_version.policy_id = policy.id and current_version.status = 'published'
    where policy.is_active and policy.requires_acceptance
      and (policy.department_id is null or policy.department_id = employee_department_id)
      and (policy.access_role_id is null or policy.access_role_id = employee_access_role_id)
      and not exists (
        select 1 from public.hr_policy_acceptances acceptance
        where acceptance.employee_id = employee_id
          and acceptance.policy_version_id = current_version.id
          and acceptance.sha256_snapshot = current_version.sha256
      )
  ) then
    raise exception 'The employee must accept every current required HR policy before activation'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

do $$
declare access_role_id uuid;
begin
  insert into public.organization_access_roles(role_key, name, description, is_system)
  values ('hr_administrator', 'HR administrator',
    'Manages employee assignments and HR configuration.', true)
  on conflict (role_key) do update set is_system = true
  returning id into access_role_id;
  insert into public.organization_access_role_permissions(role_id, permission_key, scope)
  values (access_role_id, 'hr.console.access', 'all'),
    (access_role_id, 'hr.configuration.manage', 'all'),
    (access_role_id, 'hr.employee.read', 'all'),
    (access_role_id, 'hr.employee.manage', 'all'),
    (access_role_id, 'hr.policy.manage', 'all')
  on conflict (role_id, permission_key) do update set scope = excluded.scope;
end;
$$;

alter table public.hr_departments enable row level security;
alter table public.hr_positions enable row level security;
alter table public.organization_permission_catalog enable row level security;
alter table public.organization_access_roles enable row level security;
alter table public.organization_access_role_permissions enable row level security;
alter table public.hr_employees enable row level security;
alter table public.hr_employee_assignments enable row level security;
alter table public.hr_policy_documents enable row level security;
alter table public.hr_policy_versions enable row level security;
alter table public.hr_policy_acceptances enable row level security;

create policy "HR users read HR configuration"
  on public.hr_departments for select to authenticated
  using (public.chowk_user_has_permission('hr.configuration.manage')
    or public.chowk_user_has_permission('hr.employee.read'));
create policy "HR users read HR positions"
  on public.hr_positions for select to authenticated
  using (public.chowk_user_has_permission('hr.configuration.manage')
    or public.chowk_user_has_permission('hr.employee.read'));
create policy "Authenticated users read active HR permissions"
  on public.organization_permission_catalog for select to authenticated using (is_active);
create policy "HR users read access roles"
  on public.organization_access_roles for select to authenticated
  using (public.chowk_user_has_permission('hr.configuration.manage')
    or public.chowk_user_has_permission('hr.employee.read'));
create policy "HR users read access role permissions"
  on public.organization_access_role_permissions for select to authenticated
  using (public.chowk_user_has_permission('hr.configuration.manage')
    or public.chowk_user_has_permission('hr.employee.read'));
create policy "Employees read their own employment record"
  on public.hr_employees for select to authenticated
  using (
    id = (select auth.uid())
    or public.chowk_user_has_permission('hr.configuration.manage')
    or exists (
      select 1
      from public.hr_employee_assignments assignment
      where assignment.employee_id = hr_employees.id
        and (
          public.chowk_user_has_permission(
            'hr.employee.read', assignment.employee_id, assignment.department_id
          )
          or public.chowk_user_has_permission(
            'hr.employee.manage', assignment.employee_id, assignment.department_id
          )
        )
    )
  );
create policy "HR users read employee assignments"
  on public.hr_employee_assignments for select to authenticated
  using (
    employee_id = (select auth.uid())
    or public.chowk_user_has_permission('hr.employee.read', employee_id, department_id)
    or public.chowk_user_has_permission('hr.employee.manage', employee_id, department_id)
  );
create policy "Authenticated users read active HR policies"
  on public.hr_policy_documents for select to authenticated
  using (
    public.chowk_user_has_permission('hr.policy.manage')
    or (
      is_active
      and (
        (hr_policy_documents.department_id is null and hr_policy_documents.access_role_id is null)
        or exists (
          select 1 from public.hr_employee_assignments assignment
          where assignment.employee_id = (select auth.uid())
            and assignment.status in ('pending', 'active', 'suspended')
            and (
              hr_policy_documents.department_id is null
              or assignment.department_id = hr_policy_documents.department_id
            )
            and (
              hr_policy_documents.access_role_id is null
              or assignment.access_role_id = hr_policy_documents.access_role_id
            )
        )
      )
    )
  );
create policy "Authenticated users read published HR policy versions"
  on public.hr_policy_versions for select to authenticated
  using (
    public.chowk_user_has_permission('hr.policy.manage')
    or (
      status = 'published'
      and exists (
        select 1 from public.hr_policy_documents policy
        where policy.id = hr_policy_versions.policy_id and policy.is_active
          and (
            (policy.department_id is null and policy.access_role_id is null)
            or exists (
              select 1 from public.hr_employee_assignments assignment
              where assignment.employee_id = (select auth.uid())
                and assignment.status in ('pending', 'active', 'suspended')
                and (policy.department_id is null or assignment.department_id = policy.department_id)
                and (policy.access_role_id is null or assignment.access_role_id = policy.access_role_id)
            )
          )
      )
    )
  );
create policy "Employees read own HR policy acceptance history"
  on public.hr_policy_acceptances for select to authenticated
  using (employee_id = (select auth.uid())
    or public.chowk_user_has_permission('hr.policy.manage'));

create trigger require_current_hr_policies_for_employee_activation
  before insert or update of status, department_id, access_role_id on public.hr_employee_assignments
  for each row execute function public.chowk_hr_require_policy_acceptance();
revoke all on public.hr_departments, public.hr_positions, public.organization_permission_catalog,
  public.organization_access_roles, public.organization_access_role_permissions, public.hr_employees, public.hr_employee_assignments,
  public.hr_policy_documents, public.hr_policy_versions, public.hr_policy_acceptances
  from anon, authenticated;
grant select on public.hr_departments, public.hr_positions, public.organization_permission_catalog,
  public.organization_access_roles, public.organization_access_role_permissions, public.hr_employees, public.hr_employee_assignments,
  public.hr_policy_documents, public.hr_policy_versions, public.hr_policy_acceptances
  to authenticated;

revoke all on function public.chowk_user_has_permission(text,uuid,uuid) from public, anon;
grant execute on function public.chowk_user_has_permission(text,uuid,uuid) to authenticated;
revoke all on function public.chowk_hr_configuration_snapshot(),
  public.chowk_hr_accept_current_policy(uuid),
  public.chowk_hr_current_policies(),
  public.chowk_hr_require_policy_acceptance() from public, anon;
grant execute on function public.chowk_hr_configuration_snapshot(),
  public.chowk_hr_accept_current_policy(uuid),
  public.chowk_hr_current_policies() to authenticated;

revoke all on function public.chowk_hr_save_department(uuid,text,text,text,uuid,boolean),
  public.chowk_hr_delete_department(uuid),
  public.chowk_hr_save_position(uuid,text,text,text,uuid,boolean),
  public.chowk_hr_delete_position(uuid),
  public.chowk_hr_save_access_role(uuid,text,text,text,boolean),
  public.chowk_hr_delete_access_role(uuid),
  public.chowk_hr_set_role_permissions(uuid,jsonb),
  public.chowk_hr_save_employee_assignment(uuid,uuid,uuid,uuid,uuid,uuid,text,boolean,timestamptz,text,text),
  public.chowk_hr_save_policy(uuid,text,text,text,uuid,uuid,boolean,boolean),
  public.chowk_hr_save_policy_draft(uuid,uuid,text,text,text),
  public.chowk_hr_publish_policy_version(uuid),
  public.chowk_hr_delete_unused_draft(text,uuid)
  from public, anon;
grant execute on function public.chowk_hr_save_department(uuid,text,text,text,uuid,boolean),
  public.chowk_hr_delete_department(uuid),
  public.chowk_hr_save_position(uuid,text,text,text,uuid,boolean),
  public.chowk_hr_delete_position(uuid),
  public.chowk_hr_save_access_role(uuid,text,text,text,boolean),
  public.chowk_hr_delete_access_role(uuid),
  public.chowk_hr_set_role_permissions(uuid,jsonb),
  public.chowk_hr_save_employee_assignment(uuid,uuid,uuid,uuid,uuid,uuid,text,boolean,timestamptz,text,text),
  public.chowk_hr_save_policy(uuid,text,text,text,uuid,uuid,boolean,boolean),
  public.chowk_hr_save_policy_draft(uuid,uuid,text,text,text),
  public.chowk_hr_publish_policy_version(uuid),
  public.chowk_hr_delete_unused_draft(text,uuid)
  to authenticated;

create trigger audit_hr_departments
  after insert or update or delete on public.hr_departments
  for each row execute function public.chowk_audit_row();
create trigger audit_hr_positions
  after insert or update or delete on public.hr_positions
  for each row execute function public.chowk_audit_row();
create trigger audit_organization_access_roles
  after insert or update or delete on public.organization_access_roles
  for each row execute function public.chowk_audit_row();
create trigger audit_organization_access_role_permissions
  after insert or update or delete on public.organization_access_role_permissions
  for each row execute function public.chowk_audit_row();
create trigger audit_hr_employees
  after insert or update or delete on public.hr_employees
  for each row execute function public.chowk_audit_row();
create trigger audit_hr_employee_assignments
  after insert or update or delete on public.hr_employee_assignments
  for each row execute function public.chowk_audit_row();
create trigger audit_hr_policy_documents
  after insert or update or delete on public.hr_policy_documents
  for each row execute function public.chowk_audit_row();
create trigger audit_hr_policy_versions
  after insert or update or delete on public.hr_policy_versions
  for each row execute function public.chowk_audit_row();
create trigger audit_hr_policy_acceptances
  after insert or update or delete on public.hr_policy_acceptances
  for each row execute function public.chowk_audit_row();
