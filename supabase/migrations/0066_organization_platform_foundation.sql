do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ~ '(hr_custom_|hr_access_roles|hr_access_role_permissions|hr_permission_catalog|hr_staff_assignments)'
  ) then
    raise exception 'Legacy organization functions reference pre-canonical table names; reconcile and recreate those functions before migration 0066';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.hr_access_roles') is not null
      and to_regclass('public.organization_access_roles') is null then
    alter table public.hr_access_roles rename to organization_access_roles;
  elsif to_regclass('public.hr_access_roles') is not null
      and to_regclass('public.organization_access_roles') is not null then
    raise exception 'Both legacy and canonical access-role tables exist; reconcile them before applying migration 0066';
  end if;

  if to_regclass('public.hr_access_role_permissions') is not null
      and to_regclass('public.organization_access_role_permissions') is null then
    alter table public.hr_access_role_permissions rename to organization_access_role_permissions;
  elsif to_regclass('public.hr_access_role_permissions') is not null
      and to_regclass('public.organization_access_role_permissions') is not null then
    raise exception 'Both legacy and canonical access-permission tables exist; reconcile them before applying migration 0066';
  end if;

  if to_regclass('public.hr_permission_catalog') is not null
      and to_regclass('public.organization_permission_catalog') is null then
    alter table public.hr_permission_catalog rename to organization_permission_catalog;
  elsif to_regclass('public.hr_permission_catalog') is not null
      and to_regclass('public.organization_permission_catalog') is not null then
    raise exception 'Both legacy and canonical permission catalogs exist; reconcile them before applying migration 0066';
  end if;

  if to_regclass('public.hr_custom_models') is not null
      and to_regclass('public.organization_models') is null then
    alter table public.hr_custom_models rename to organization_models;
  elsif to_regclass('public.hr_custom_models') is not null
      and to_regclass('public.organization_models') is not null then
    raise exception 'Both legacy and canonical model tables exist; reconcile them before applying migration 0066';
  end if;

  if to_regclass('public.hr_custom_model_fields') is not null
      and to_regclass('public.organization_model_fields') is null then
    alter table public.hr_custom_model_fields rename to organization_model_fields;
  elsif to_regclass('public.hr_custom_model_fields') is not null
      and to_regclass('public.organization_model_fields') is not null then
    raise exception 'Both legacy and canonical model-field tables exist; reconcile them before applying migration 0066';
  end if;

  if to_regclass('public.hr_custom_model_permissions') is not null
      and to_regclass('public.organization_model_permissions') is null then
    alter table public.hr_custom_model_permissions rename to organization_model_permissions;
  elsif to_regclass('public.hr_custom_model_permissions') is not null
      and to_regclass('public.organization_model_permissions') is not null then
    raise exception 'Both legacy and canonical model-permission tables exist; reconcile them before applying migration 0066';
  end if;

  if to_regclass('public.hr_custom_model_transitions') is not null
      and to_regclass('public.organization_model_transitions') is null then
    alter table public.hr_custom_model_transitions rename to organization_model_transitions;
  elsif to_regclass('public.hr_custom_model_transitions') is not null
      and to_regclass('public.organization_model_transitions') is not null then
    raise exception 'Both legacy and canonical model-transition tables exist; reconcile them before applying migration 0066';
  end if;

  if to_regclass('public.hr_custom_records') is not null
      and to_regclass('public.organization_records') is null then
    alter table public.hr_custom_records rename to organization_records;
  elsif to_regclass('public.hr_custom_records') is not null
      and to_regclass('public.organization_records') is not null then
    raise exception 'Both legacy and canonical organization-record tables exist; reconcile them before applying migration 0066';
  end if;

  if to_regclass('public.hr_custom_record_events') is not null
      and to_regclass('public.organization_record_events') is null then
    alter table public.hr_custom_record_events rename to organization_record_events;
  elsif to_regclass('public.hr_custom_record_events') is not null
      and to_regclass('public.organization_record_events') is not null then
    raise exception 'Both legacy and canonical record-event tables exist; reconcile them before applying migration 0066';
  end if;

  if to_regclass('public.hr_staff_assignments') is not null
      and to_regclass('public.hr_employee_assignments') is null then
    alter table public.hr_staff_assignments rename to hr_employee_assignments;
  elsif to_regclass('public.hr_staff_assignments') is not null
      and to_regclass('public.hr_employee_assignments') is not null then
    raise exception 'Both legacy staff and canonical employee assignment tables exist; reconcile them before applying migration 0066';
  end if;

  if to_regclass('public.hr_employee_assignments') is not null
      and exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'hr_employee_assignments' and column_name = 'user_id')
      and not exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'hr_employee_assignments' and column_name = 'employee_id') then
    alter table public.hr_employee_assignments rename column user_id to employee_id;
  end if;

  if to_regclass('public.hr_employee_assignments') is not null
      and exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'hr_employee_assignments' and column_name = 'manager_id')
      and not exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'hr_employee_assignments' and column_name = 'manager_employee_id') then
    alter table public.hr_employee_assignments rename column manager_id to manager_employee_id;
  end if;

  if to_regclass('public.hr_policy_acceptances') is not null
      and exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'hr_policy_acceptances' and column_name = 'user_id')
      and not exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'hr_policy_acceptances' and column_name = 'employee_id') then
    alter table public.hr_policy_acceptances rename column user_id to employee_id;
  end if;
end;
$$;

create table if not exists public.organizations (
  id uuid primary key default '00000000-0000-4000-8000-000000000066',
  organization_key text not null unique check (organization_key ~ '^[a-z][a-z0-9_-]{1,79}$'),
  display_name text not null check (length(trim(display_name)) between 2 and 160),
  legal_name text not null default '' check (length(legal_name) <= 200),
  website_url text not null default '' check (length(website_url) <= 500),
  contact_email text not null default '' check (length(contact_email) <= 254),
  contact_phone text not null default '' check (length(contact_phone) <= 30),
  country_code text not null default 'IN' check (country_code ~ '^[A-Z]{2}$'),
  locale text not null default 'en-IN' check (length(locale) between 2 and 20),
  timezone text not null default 'Asia/Kolkata' check (length(timezone) between 1 and 80),
  currency_code text not null default 'INR' check (currency_code ~ '^[A-Z]{3}$'),
  is_primary boolean not null default true,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (is_primary)
);

create unique index if not exists organizations_one_primary_idx
  on public.organizations(is_primary) where is_primary;

do $$
begin
  if exists (select 1 from public.organizations where organization_key = 'chowk-news')
      and exists (select 1 from public.organizations
        where organization_key = 'chowk-news'
          and id <> '00000000-0000-4000-8000-000000000066') then
    raise exception 'The existing Chowk News organization uses a different ID; reconcile its references before migration 0066';
  end if;
end;
$$;

insert into public.organizations(
  id, organization_key, display_name, legal_name, country_code, locale, timezone, currency_code
)
values ('00000000-0000-4000-8000-000000000066', 'chowk-news', 'Chowk News', 'Chowk News', 'IN', 'en-IN', 'Asia/Kolkata', 'INR')
on conflict (organization_key) do nothing;

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

insert into public.hr_employees(
  id, employment_status, hired_on, terminated_on, created_at, updated_at
)
select profile_id,
  case
    when bool_or(status = 'active') then 'active'
    when bool_or(status = 'suspended') then 'suspended'
    when bool_or(status = 'pending') then 'preboarding'
    else 'terminated'
  end,
  min(starts_at)::date,
  case when bool_or(status in ('pending', 'active', 'suspended')) then null
    else max(ends_at)::date end,
  min(created_at), max(updated_at)
from (
  select employee_id as profile_id, status, starts_at, ends_at, created_at, updated_at
  from public.hr_employee_assignments
  union all
  select manager_employee_id, 'active', starts_at, null, created_at, updated_at
  from public.hr_employee_assignments
  where manager_employee_id is not null
  union all
  select employee_id, 'active', accepted_at, null, accepted_at, accepted_at
  from public.hr_policy_acceptances
) assignments
group by profile_id
on conflict (id) do nothing;

do $$
declare constraint_row record;
begin
  if to_regclass('public.hr_employee_assignments') is not null then
    for constraint_row in
      select constraint_data.conname
      from pg_constraint constraint_data
      join pg_attribute column_data
        on column_data.attrelid = constraint_data.conrelid
       and column_data.attnum = any(constraint_data.conkey)
      where constraint_data.contype = 'f'
        and constraint_data.conrelid = 'public.hr_employee_assignments'::regclass
        and constraint_data.confrelid = 'public.profiles'::regclass
        and column_data.attname = 'employee_id'
    loop
      execute format(
        'alter table public.hr_employee_assignments drop constraint %I',
        constraint_row.conname
      );
    end loop;
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.hr_employee_assignments'::regclass
        and conname = 'hr_employee_assignments_employee_id_fkey'
    ) then
      alter table public.hr_employee_assignments
        add constraint hr_employee_assignments_employee_id_fkey
        foreign key (employee_id) references public.hr_employees(id) on delete restrict;
    end if;
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.hr_employee_assignments'::regclass
        and conname = 'hr_employee_assignments_manager_employee_id_fkey'
    ) then
      alter table public.hr_employee_assignments
        add constraint hr_employee_assignments_manager_employee_id_fkey
        foreign key (manager_employee_id) references public.hr_employees(id) on delete restrict;
    end if;
  end if;
  if to_regclass('public.hr_policy_acceptances') is not null then
    for constraint_row in
      select constraint_data.conname
      from pg_constraint constraint_data
      join pg_attribute column_data
        on column_data.attrelid = constraint_data.conrelid
       and column_data.attnum = any(constraint_data.conkey)
      where constraint_data.contype = 'f'
        and constraint_data.conrelid = 'public.hr_policy_acceptances'::regclass
        and constraint_data.confrelid = 'public.profiles'::regclass
        and column_data.attname = 'employee_id'
    loop
      execute format(
        'alter table public.hr_policy_acceptances drop constraint %I',
        constraint_row.conname
      );
    end loop;
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.hr_policy_acceptances'::regclass
        and conname = 'hr_policy_acceptances_employee_id_fkey'
    ) then
      alter table public.hr_policy_acceptances
        add constraint hr_policy_acceptances_employee_id_fkey
        foreign key (employee_id) references public.hr_employees(id) on delete restrict;
    end if;
  end if;
end;
$$;

create table if not exists public.organization_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  setting_key text not null check (setting_key ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  value jsonb not null check (jsonb_typeof(value) in ('object', 'array', 'string', 'number', 'boolean', 'null')),
  description text not null default '' check (length(description) <= 1000),
  revision integer not null default 1 check (revision > 0),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, setting_key)
);

create table if not exists public.organization_setting_events (
  id bigint generated always as identity primary key,
  setting_id uuid not null references public.organization_settings(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete set null,
  revision integer not null check (revision > 0),
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now(),
  unique (setting_id, revision)
);

create table if not exists public.organization_people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  person_id uuid not null references public.profiles(id) on delete restrict,
  relationship_type text not null check (relationship_type in (
    'employee', 'reporter', 'newsroom_collaborator', 'contractor',
    'vendor', 'volunteer', 'applicant', 'subscriber', 'partner'
  )),
  status text not null check (status in ('invited', 'active', 'suspended', 'ended')),
  source_type text not null default 'admin' check (source_type in (
    'admin', 'hr_assignment', 'reporter_profile', 'staff_role_assignment', 'migration'
  )),
  source_id text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'ended') = (ends_at is not null))
);

create unique index if not exists organization_people_one_current_relationship_idx
  on public.organization_people(organization_id, person_id, relationship_type)
  where ends_at is null;
create index if not exists organization_people_person_history_idx
  on public.organization_people(organization_id, person_id, starts_at desc);
create index if not exists organization_people_type_status_idx
  on public.organization_people(organization_id, relationship_type, status);

create table if not exists public.organization_module_catalog (
  module_key text primary key check (module_key ~ '^[a-z][a-z0-9_-]{1,79}$'),
  name text not null check (length(trim(name)) between 2 and 120),
  description text not null check (length(trim(description)) between 5 and 1000),
  module_type text not null check (module_type in ('core', 'operational', 'optional')),
  is_required boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  created_at timestamptz not null default now()
);

insert into public.organization_module_catalog(
  module_key, name, description, module_type, is_required, sort_order
)
values
  ('organization', 'Organization', 'Organization identity, settings, and structure.', 'core', true, 10),
  ('people', 'People directory', 'Accounts and organization relationship directory.', 'core', true, 20),
  ('human-resources', 'Human resources', 'Employment, assignments, policies, and onboarding.', 'core', true, 30),
  ('access-control', 'Access control', 'Permission catalog, access roles, and authorization scopes.', 'core', true, 40),
  ('workflows', 'Workflows', 'Reusable states, transitions, approvals, and history.', 'core', true, 50),
  ('organization-models', 'Organization models', 'Admin-defined record types, fields, access, and workflow.', 'core', true, 60),
  ('newsroom', 'Newsroom', 'Editorial content and publishing operations.', 'operational', false, 100),
  ('reporters', 'Reporter operations', 'Reporter applications, assignments, coverage, and agreements.', 'operational', false, 110),
  ('agreements', 'Agreements', 'Organization and role-specific agreement templates and acceptance.', 'operational', false, 120),
  ('credentials', 'Credentials', 'Staff identity credentials and public verification.', 'operational', false, 130),
  ('locations', 'Locations', 'Hierarchical geographic and organization locations.', 'operational', false, 140),
  ('media', 'Media', 'Images, video, audio, and streaming catalogs.', 'operational', false, 150),
  ('moderation', 'Moderation', 'Comments, content reports, and moderation decisions.', 'operational', false, 160),
  ('audit', 'Audit history', 'Searchable, append-only organization activity history.', 'core', true, 170),
  ('recruitment', 'Recruitment', 'Vacancies, candidate pipeline, and hiring decisions.', 'optional', false, 200),
  ('leave-attendance', 'Leave and attendance', 'Leave requests, work schedules, and attendance records.', 'optional', false, 210),
  ('payroll', 'Payroll', 'Compensation, payroll periods, and payslip records.', 'optional', false, 220),
  ('assets-expenses', 'Assets and expenses', 'Organization assets, purchases, and reimbursement workflows.', 'optional', false, 230),
  ('training-performance', 'Training and performance', 'Learning plans, reviews, and development goals.', 'optional', false, 240),
  ('compliance', 'Compliance', 'Compliance controls, evidence, and review schedules.', 'optional', false, 250)
on conflict (module_key) do update
set name = excluded.name,
    description = excluded.description,
    module_type = excluded.module_type,
    is_required = excluded.is_required,
    sort_order = excluded.sort_order,
    is_active = true;

create table if not exists public.organization_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  module_key text not null references public.organization_module_catalog(module_key) on delete restrict,
  is_enabled boolean not null default true,
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  revision integer not null default 1 check (revision > 0),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, module_key)
);

insert into public.organization_modules(organization_id, module_key, is_enabled)
select organization.id, catalog.module_key, catalog.is_required or catalog.module_type = 'operational'
from public.organizations organization
cross join public.organization_module_catalog catalog
where organization.is_primary
on conflict (organization_id, module_key) do nothing;

create table if not exists public.organization_module_configuration_versions (
  id uuid primary key default gen_random_uuid(),
  organization_module_id uuid not null references public.organization_modules(id) on delete restrict,
  version integer not null check (version > 0),
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object'),
  status text not null check (status in ('draft', 'published', 'retired')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  unique (organization_module_id, version),
  check (status <> 'published' or published_at is not null)
);

create unique index if not exists organization_module_one_published_config_idx
  on public.organization_module_configuration_versions(organization_module_id)
  where status = 'published';

create table if not exists public.organization_workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  module_key text not null references public.organization_module_catalog(module_key) on delete restrict,
  workflow_key text not null check (workflow_key ~ '^[a-z][a-z0-9_-]{1,79}$'),
  name text not null check (length(trim(name)) between 2 and 120),
  description text not null default '' check (length(description) <= 2000),
  version integer not null default 1 check (version > 0),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, module_key, workflow_key)
);

create table if not exists public.organization_workflow_states (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.organization_workflows(id) on delete restrict,
  state_key text not null check (state_key ~ '^[a-z][a-z0-9_-]{1,39}$'),
  label text not null check (length(trim(label)) between 1 and 80),
  is_initial boolean not null default false,
  is_terminal boolean not null default false,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  created_at timestamptz not null default now(),
  unique (workflow_id, state_key),
  unique (id, workflow_id)
);

create unique index if not exists organization_workflow_one_initial_state_idx
  on public.organization_workflow_states(workflow_id) where is_initial;

create table if not exists public.organization_workflow_transitions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.organization_workflows(id) on delete restrict,
  from_state_id uuid not null references public.organization_workflow_states(id) on delete restrict,
  to_state_id uuid not null references public.organization_workflow_states(id) on delete restrict,
  transition_key text not null check (transition_key ~ '^[a-z][a-z0-9_-]{1,79}$'),
  label text not null check (length(trim(label)) between 2 and 80),
  required_permission text not null references public.organization_permission_catalog(permission_key) on delete restrict,
  requires_reason boolean not null default false,
  requires_approval boolean not null default false,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_state_id <> to_state_id),
  unique (workflow_id, transition_key),
  unique (workflow_id, from_state_id, to_state_id),
  foreign key (from_state_id, workflow_id)
    references public.organization_workflow_states(id, workflow_id) on delete restrict,
  foreign key (to_state_id, workflow_id)
    references public.organization_workflow_states(id, workflow_id) on delete restrict
);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'hr_departments', 'hr_positions', 'organization_access_roles',
    'organization_access_role_permissions', 'hr_employees',
    'hr_employee_assignments', 'hr_policy_documents', 'hr_policy_versions',
    'hr_policy_acceptances', 'organization_models', 'organization_model_fields',
    'organization_model_permissions', 'organization_model_transitions',
    'organization_records', 'organization_record_events'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format(
        'alter table public.%I add column if not exists organization_id uuid',
        table_name
      );
      execute format(
        'update public.%I set organization_id = %L::uuid where organization_id is null',
        table_name, '00000000-0000-4000-8000-000000000066'
      );
      execute format(
        'alter table public.%I alter column organization_id set default %L::uuid',
        table_name, '00000000-0000-4000-8000-000000000066'
      );
      execute format(
        'alter table public.%I alter column organization_id set not null',
        table_name
      );
      if not exists (
        select 1 from pg_constraint
        where conrelid = to_regclass('public.' || table_name)
          and conname = table_name || '_organization_id_fkey'
      ) then
        execute format(
          'alter table public.%I add constraint %I foreign key (organization_id) references public.organizations(id) on delete restrict',
          table_name, table_name || '_organization_id_fkey'
        );
      end if;
    end if;
  end loop;
end;
$$;

alter table public.organizations enable row level security;
alter table public.organization_settings enable row level security;
alter table public.organization_setting_events enable row level security;
alter table public.organization_people enable row level security;
alter table public.organization_module_catalog enable row level security;
alter table public.organization_modules enable row level security;
alter table public.organization_module_configuration_versions enable row level security;
alter table public.organization_workflows enable row level security;
alter table public.organization_workflow_states enable row level security;
alter table public.organization_workflow_transitions enable row level security;

revoke all on public.organizations, public.organization_settings,
  public.organization_setting_events, public.organization_people,
  public.organization_modules, public.organization_module_configuration_versions,
  public.organization_workflows, public.organization_workflow_states,
  public.organization_workflow_transitions
  from anon, authenticated;
revoke all on public.organization_module_catalog from anon, authenticated;
grant select on public.organizations, public.organization_settings,
  public.organization_people, public.organization_module_catalog,
  public.organization_modules, public.organization_workflows,
  public.organization_workflow_states, public.organization_workflow_transitions
  to authenticated;

create policy "Super admins read organization identity"
  on public.organizations for select to authenticated
  using (exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'super_admin'
  ));
create policy "Authenticated users read active organization module catalog"
  on public.organization_module_catalog for select to authenticated using (is_active);
create policy "Super admins read organization settings"
  on public.organization_settings for select to authenticated
  using (exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'super_admin'
  ));
create policy "Organization members read own relationship"
  on public.organization_people for select to authenticated
  using (
    person_id = (select auth.uid())
    or exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role in ('admin', 'super_admin')
    )
  );
create policy "Authenticated users read enabled organization modules"
  on public.organization_modules for select to authenticated
  using (is_enabled or exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'super_admin'
  ));
create policy "Authenticated users read active organization workflows"
  on public.organization_workflows for select to authenticated
  using (is_active or exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'super_admin'
  ));
create policy "Authenticated users read states for active workflows"
  on public.organization_workflow_states for select to authenticated
  using (exists (
    select 1 from public.organization_workflows workflow
    where workflow.id = organization_workflow_states.workflow_id and workflow.is_active
  ));
create policy "Authenticated users read active workflow transitions"
  on public.organization_workflow_transitions for select to authenticated
  using (is_active and exists (
    select 1 from public.organization_workflows workflow
    where workflow.id = organization_workflow_transitions.workflow_id and workflow.is_active
  ));

create or replace function public.chowk_org_sync_employee_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  primary_organization uuid;
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
  insert into public.organization_people(
    organization_id, person_id, relationship_type, status, source_type, source_id,
    starts_at, ends_at, created_by
  )
  select primary_organization, employee.id, 'employee',
    case employee.employment_status
      when 'preboarding' then 'invited'
      when 'terminated' then 'ended'
      else employee.employment_status
    end,
    'hr_assignment', null,
    coalesce(employee.hired_on::timestamptz, employee.created_at),
    case when employee.terminated_on is not null
      then employee.terminated_on::timestamptz else null end,
    employee.created_by
  from public.hr_employees employee
  where employee.id = new.id
  on conflict (organization_id, person_id, relationship_type)
    where ends_at is null
  do update set
    status = excluded.status,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    updated_at = now();
  return new;
end;
$$;

create trigger sync_organization_employee_relationship_insert
  after insert on public.hr_employees
  for each row execute function public.chowk_org_sync_employee_relationship();
create trigger sync_organization_employee_relationship_update
  after update of employment_status, hired_on, terminated_on on public.hr_employees
  for each row execute function public.chowk_org_sync_employee_relationship();
create trigger sync_organization_employee_relationship_delete
  after delete on public.hr_employees
  for each row execute function public.chowk_org_sync_employee_relationship();

insert into public.organization_people(
  organization_id, person_id, relationship_type, status, source_type, source_id, starts_at, ends_at
)
select organization.id, employee.id, 'employee',
  case employee.employment_status
    when 'preboarding' then 'invited'
    when 'terminated' then 'ended'
    else employee.employment_status
  end,
  'migration', employee.employee_number,
  coalesce(employee.hired_on::timestamptz, employee.created_at),
  employee.terminated_on::timestamptz
from public.organizations organization
cross join public.hr_employees employee
where organization.is_primary
on conflict (organization_id, person_id, relationship_type)
  where ends_at is null do nothing;

insert into public.organization_people(
  organization_id, person_id, relationship_type, status, source_type, source_id, starts_at
)
select organization.id, reporter.user_id, 'reporter', 'active', 'reporter_profile',
  reporter.user_id::text, coalesce(reporter.created_at, now())
from public.organizations organization
cross join public.reporter_profiles reporter
where organization.is_primary
on conflict (organization_id, person_id, relationship_type)
  where ends_at is null do nothing;

insert into public.organization_people(
  organization_id, person_id, relationship_type, status, source_type, source_id, starts_at, ends_at
)
select organization.id, assignment.user_id, 'newsroom_collaborator',
  case assignment.status when 'ended' then 'ended' when 'pending' then 'invited' else 'active' end,
  'staff_role_assignment', assignment.id::text, assignment.assigned_at, assignment.ended_at
from public.organizations organization
cross join public.staff_role_assignments assignment
join public.staff_role_definitions definition on definition.id = assignment.staff_role_id
where organization.is_primary
  and definition.role_key <> 'reporter'
on conflict (organization_id, person_id, relationship_type)
  where ends_at is null do nothing;

revoke all on function public.chowk_org_sync_employee_relationship() from public, anon, authenticated;
