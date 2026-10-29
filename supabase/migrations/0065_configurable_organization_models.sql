create table public.organization_models (
  id uuid primary key default gen_random_uuid(),
  model_key text not null unique check (model_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  name text not null check (length(trim(name)) between 2 and 100),
  description text not null default '' check (length(description) <= 2000),
  initial_status text not null default 'draft' check (initial_status ~ '^[a-z][a-z0-9_]{1,39}$'),
  workflow_enabled boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_model_fields (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.organization_models(id) on delete cascade,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  label text not null check (length(trim(label)) between 1 and 100),
  field_type text not null check (field_type in (
    'text', 'long_text', 'number', 'date', 'boolean', 'select', 'email', 'url'
  )),
  is_required boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (model_id, field_key)
);

create table public.organization_model_permissions (
  role_id uuid not null references public.organization_access_roles(id) on delete cascade,
  model_id uuid not null references public.organization_models(id) on delete cascade,
  action text not null check (action in ('read', 'create', 'update', 'delete', 'submit', 'approve')),
  scope text not null check (scope in ('all', 'department', 'assigned', 'own')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (role_id, model_id, action)
);

create table public.organization_model_transitions (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.organization_models(id) on delete cascade,
  from_status text not null check (from_status ~ '^[a-z][a-z0-9_]{1,39}$'),
  to_status text not null check (to_status ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (length(trim(label)) between 2 and 80),
  required_action text not null check (required_action in ('update', 'submit', 'approve')),
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_status <> to_status),
  unique (model_id, from_status, to_status)
);

create table public.organization_records (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.organization_models(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  department_id uuid references public.hr_departments(id) on delete restrict,
  status text not null check (status ~ '^[a-z][a-z0-9_]{1,39}$'),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index organization_records_model_status_idx
  on public.organization_records(model_id, status, updated_at desc)
  where deleted_at is null;
create index organization_records_owner_idx
  on public.organization_records(owner_id, model_id, updated_at desc)
  where deleted_at is null;
create index organization_records_department_idx
  on public.organization_records(department_id, model_id, status)
  where deleted_at is null;

create table public.organization_record_events (
  id bigint generated always as identity primary key,
  record_id uuid not null references public.organization_records(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('created', 'updated', 'transitioned', 'deleted')),
  from_status text,
  to_status text,
  revision integer not null,
  data_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index organization_record_events_record_idx
  on public.organization_record_events(record_id, created_at desc);

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

create or replace function public.chowk_org_validate_model_data(
  target_model uuid,
  target_data jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  field_row record;
  field_value jsonb;
  value_text text;
  invalid_value boolean;
begin
  if jsonb_typeof(target_data) is distinct from 'object' then
    raise exception 'Model data must be a JSON object' using errcode = '22023';
  end if;
  if length(target_data::text) > 100000 then
    raise exception 'Model data exceeds the 100 KB record limit' using errcode = '22023';
  end if;
  for field_row in
    select field_key, label, field_type, is_required, options
    from public.organization_model_fields
    where model_id = target_model and is_active
  loop
    field_value := target_data -> field_row.field_key;
    if field_value is null or field_value = 'null'::jsonb then
      if field_row.is_required then
        raise exception 'The % field is required', field_row.label using errcode = '22023';
      end if;
      continue;
    end if;
    value_text := field_value #>> '{}';
    case field_row.field_type
      when 'text' then
        invalid_value := jsonb_typeof(field_value) <> 'string' or length(value_text) > 500;
      when 'long_text' then
        invalid_value := jsonb_typeof(field_value) <> 'string' or length(value_text) > 10000;
      when 'number' then
        invalid_value := jsonb_typeof(field_value) <> 'number';
      when 'date' then
        invalid_value := jsonb_typeof(field_value) <> 'string'
          or value_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          or to_char(value_text::date, 'YYYY-MM-DD') <> value_text;
      when 'boolean' then
        invalid_value := jsonb_typeof(field_value) <> 'boolean';
      when 'select' then
        invalid_value := jsonb_typeof(field_value) <> 'string'
          or not exists (
            select 1 from jsonb_array_elements_text(field_row.options) option_value
            where option_value = value_text
          );
      when 'email' then
        invalid_value := jsonb_typeof(field_value) <> 'string'
          or length(value_text) > 254
          or value_text !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';
      when 'url' then
        invalid_value := jsonb_typeof(field_value) <> 'string'
          or length(value_text) > 2000 or value_text !~ '^https?://[^[:space:]]+$';
      else
        invalid_value := true;
    end case;
    if invalid_value then
      raise exception 'The value for % is invalid', field_row.label using errcode = '22023';
    end if;
  end loop;
  if exists (
    select 1 from jsonb_object_keys(target_data) supplied(key)
    where not exists (
      select 1 from public.organization_model_fields field
      where field.model_id = target_model and field.is_active
        and field.field_key = supplied.key
    )
  ) then
    raise exception 'Data contains fields not configured for this model' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.chowk_org_save_model(
  target_id uuid,
  target_key text,
  target_name text,
  target_description text,
  target_initial_status text,
  target_workflow_enabled boolean,
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
  if target_key is null or target_key !~ '^[a-z][a-z0-9_]{1,49}$'
      or target_name is null or length(trim(target_name)) not between 2 and 100
      or length(coalesce(target_description, '')) > 2000
      or target_initial_status is null or target_initial_status !~ '^[a-z][a-z0-9_]{1,39}$'
      or target_workflow_enabled is null or target_is_active is null then
    raise exception 'Enter a valid model key, name, initial status, description, and status'
      using errcode = '22023';
  end if;
  if target_id is null then
    insert into public.organization_models(
      model_key, name, description, initial_status, workflow_enabled, is_active, created_by
    ) values (
      target_key, trim(target_name), trim(coalesce(target_description, '')),
      target_initial_status, target_workflow_enabled, target_is_active, actor
    ) returning id into saved_id;
  else
    if exists (
      select 1 from public.organization_models model
      where model.id = target_id and model.initial_status <> target_initial_status
        and exists (
          select 1 from public.organization_records record
          where record.model_id = model.id and record.deleted_at is null
        )
    ) then
      raise exception 'The initial state cannot change after records exist'
        using errcode = '23514';
    end if;
    update public.organization_models
    set model_key = target_key, name = trim(target_name),
        description = trim(coalesce(target_description, '')),
        initial_status = target_initial_status,
        workflow_enabled = target_workflow_enabled,
        is_active = target_is_active,
        updated_at = now()
    where id = target_id returning id into saved_id;
    if saved_id is null then raise exception 'Custom model not found' using errcode = 'P0002'; end if;
  end if;
  return saved_id;
end;
$$;

create or replace function public.chowk_org_save_model_field(
  target_model uuid,
  target_id uuid,
  target_key text,
  target_label text,
  target_type text,
  target_required boolean,
  target_active boolean,
  target_sort_order integer,
  target_options jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  existing public.organization_model_fields%rowtype;
  saved_id uuid;
begin
  if actor is null or not public.chowk_user_has_permission('hr.configuration.manage') then
    raise exception 'HR configuration permission required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organization_models where id = target_model and is_active)
      or target_key is null or target_key !~ '^[a-z][a-z0-9_]{1,49}$'
      or target_label is null or length(trim(target_label)) not between 1 and 100
      or target_type is null
      or target_type not in ('text', 'long_text', 'number', 'date', 'boolean', 'select', 'email', 'url')
      or target_required is null or target_active is null
      or target_sort_order is null or target_sort_order not between 0 and 10000
      or jsonb_typeof(target_options) is distinct from 'array'
      or jsonb_array_length(target_options) > 100 then
    raise exception 'Enter a valid field definition' using errcode = '22023';
  end if;
  if jsonb_typeof(target_options) is distinct from 'array' then
    raise exception 'Field options must be a JSON array' using errcode = '22023';
  end if;
  if target_type = 'select' and (
    jsonb_array_length(target_options) < 1
    or exists (
      select 1 from jsonb_array_elements(target_options) option_value
      where jsonb_typeof(option_value) is distinct from 'string'
        or length(trim(option_value #>> '{}')) not between 1 and 100
    )
    or jsonb_array_length(target_options) <> (
      select count(distinct value #>> '{}') from jsonb_array_elements(target_options)
    )
  ) then
    raise exception 'Select fields need unique, non-empty options up to 100 characters'
      using errcode = '22023';
  end if;
  if target_type <> 'select' and jsonb_array_length(target_options) > 0 then
    raise exception 'Only select fields can define options' using errcode = '22023';
  end if;
  if target_id is not null then
    select * into existing from public.organization_model_fields
    where id = target_id and model_id = target_model for update;
    if not found then raise exception 'Model field not found' using errcode = 'P0002'; end if;
    if existing.field_key <> target_key and exists (
      select 1 from public.organization_records record
      where record.model_id = target_model and record.deleted_at is null
        and record.data ? existing.field_key
    ) then
      raise exception 'A field key cannot change after records contain values'
        using errcode = '23514';
    end if;
    if existing.field_type <> target_type and exists (
      select 1 from public.organization_records record
      where record.model_id = target_model and record.deleted_at is null
        and record.data ? existing.field_key
    ) then
      raise exception 'A field type cannot change after records contain values; add a new field instead'
        using errcode = '23514';
    end if;
    if not existing.is_active and target_active and (
      select count(*) from public.organization_model_fields field
      where field.model_id = target_model and field.is_active
    ) >= 100 then
      raise exception 'A model can have at most 100 active fields' using errcode = '22023';
    end if;
    update public.organization_model_fields
    set field_key = target_key, label = trim(target_label), field_type = target_type,
        is_required = target_required, is_active = target_active,
        sort_order = target_sort_order, options = target_options, updated_at = now()
    where id = target_id returning id into saved_id;
  else
    if (
      select count(*) from public.organization_model_fields field
      where field.model_id = target_model and field.is_active
    ) >= 100 then
      raise exception 'A model can have at most 100 active fields' using errcode = '22023';
    end if;
    insert into public.organization_model_fields(
      model_id, field_key, label, field_type, is_required, is_active, sort_order, options
    ) values (
      target_model, target_key, trim(target_label), target_type, target_required,
      target_active, target_sort_order, target_options
    ) returning id into saved_id;
  end if;
  return saved_id;
end;
$$;

create or replace function public.chowk_org_set_model_permissions(
  target_role uuid,
  target_model uuid,
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
  if actor is null or not public.chowk_user_has_permission('hr.configuration.manage') then
    raise exception 'HR configuration permission required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organization_access_roles where id = target_role and is_active)
      or not exists (select 1 from public.organization_models where id = target_model)
      or jsonb_typeof(target_permissions) is distinct from 'array' then
    raise exception 'Choose an active access role, a model, and a valid permission list'
      using errcode = '22023';
  end if;
  if jsonb_array_length(target_permissions) > 6 then
    raise exception 'A model supports at most six action grants' using errcode = '22023';
  end if;
  if jsonb_array_length(target_permissions) <> (
    select count(distinct value ->> 'action')
    from jsonb_array_elements(target_permissions)
  ) then
    raise exception 'Each model action can only be configured once' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(target_permissions)
  loop
    if jsonb_typeof(item) is distinct from 'object'
        or item ->> 'action' is null
        or item ->> 'action' not in ('read', 'create', 'update', 'delete', 'submit', 'approve')
        or item ->> 'scope' is null
        or item ->> 'scope' not in ('all', 'department', 'assigned', 'own')
        or (item ->> 'action' in ('create', 'delete') and item ->> 'scope' = 'assigned') then
      raise exception 'Each model permission needs a supported action and scope'
        using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.profiles where id = actor and role in ('admin', 'super_admin')
    ) and not exists (
      select 1
      from public.hr_employee_assignments assignment
      join public.organization_model_permissions permission
        on permission.role_id = assignment.access_role_id
      where assignment.employee_id = actor and assignment.status = 'active'
        and permission.model_id = target_model
        and permission.action = item ->> 'action'
        and (
          permission.scope = 'all'
          or (
            permission.scope = item ->> 'scope'
            and (item ->> 'scope' <> 'department' or assignment.department_id is not null)
          )
        )
    ) then
      raise exception 'You cannot delegate a model action or scope you do not hold yourself'
        using errcode = '42501';
    end if;
  end loop;
  delete from public.organization_model_permissions
  where role_id = target_role and model_id = target_model;
  insert into public.organization_model_permissions(role_id, model_id, action, scope, created_by)
  select target_role, target_model, item ->> 'action', item ->> 'scope', actor
  from jsonb_array_elements(target_permissions) item;
end;
$$;

create or replace function public.chowk_org_save_model_transition(
  target_model uuid,
  target_id uuid,
  target_from text,
  target_to text,
  target_label text,
  target_action text,
  target_sort_order integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); saved_id uuid;
begin
  if actor is null or not public.chowk_user_has_permission('hr.configuration.manage') then
    raise exception 'HR configuration permission required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_models where id = target_model and workflow_enabled and is_active
  ) or target_from is null or target_from !~ '^[a-z][a-z0-9_]{1,39}$'
      or target_to is null or target_to !~ '^[a-z][a-z0-9_]{1,39}$'
      or target_from = target_to or target_label is null
      or length(trim(target_label)) not between 2 and 80
      or target_action is null
      or target_action not in ('update', 'submit', 'approve')
      or target_sort_order is null or target_sort_order not between 0 and 10000 then
    raise exception 'Enter valid workflow transition details' using errcode = '22023';
  end if;
  if target_id is null and (
    select count(*) from public.organization_model_transitions transition
    where transition.model_id = target_model
  ) >= 200 then
    raise exception 'A model can have at most 200 workflow transitions' using errcode = '22023';
  end if;
  if target_id is null then
    insert into public.organization_model_transitions(
      model_id, from_status, to_status, label, required_action, sort_order, created_by
    ) values (
      target_model, target_from, target_to, trim(target_label), target_action,
      target_sort_order, actor
    ) returning id into saved_id;
  else
    if exists (
      select 1
      from public.organization_model_transitions existing
      join public.organization_records record
        on record.model_id = existing.model_id
        and record.status = existing.from_status
        and record.deleted_at is null
      where existing.id = target_id and existing.model_id = target_model
    ) then
      raise exception 'A transition cannot change while records use its source state'
        using errcode = '23514';
    end if;
    update public.organization_model_transitions
    set from_status = target_from, to_status = target_to, label = trim(target_label),
        required_action = target_action, sort_order = target_sort_order
    where id = target_id and model_id = target_model returning id into saved_id;
    if saved_id is null then raise exception 'Workflow transition not found' using errcode = 'P0002'; end if;
  end if;
  return saved_id;
end;
$$;

create or replace function public.chowk_org_delete_model_transition(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.chowk_user_has_permission('hr.configuration.manage') then
    raise exception 'HR configuration permission required' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.organization_model_transitions transition
    join public.organization_records record
      on record.model_id = transition.model_id and record.status = transition.from_status
        and record.deleted_at is null
    where transition.id = target_id
  ) then
    raise exception 'A transition cannot be deleted while records use its source state'
      using errcode = '23514';
  end if;
  delete from public.organization_model_transitions where id = target_id;
  if not found then raise exception 'Workflow transition not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.chowk_org_delete_unused_model(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.chowk_user_has_permission('hr.configuration.manage') then
    raise exception 'HR configuration permission required' using errcode = '42501';
  end if;
  if exists (select 1 from public.organization_records where model_id = target_id) then
    raise exception 'This model has record or audit history; deactivate it to preserve history'
      using errcode = '23503';
  end if;
  delete from public.organization_models where id = target_id;
  if not found then raise exception 'Unused model not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.chowk_org_model_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  can_configure boolean := public.chowk_user_has_permission('hr.configuration.manage');
begin
  if actor is null then raise exception 'Sign in to load organization models' using errcode = '42501'; end if;
  return jsonb_build_object(
    'can_configure', can_configure,
    'models', coalesce((
      select jsonb_agg(model_data.value order by model_data.value ->> 'name')
      from (
        select jsonb_build_object(
          'id', model.id, 'model_key', model.model_key, 'name', model.name,
          'description', model.description, 'initial_status', model.initial_status,
          'workflow_enabled', model.workflow_enabled, 'is_active', model.is_active,
          'actions', case when can_configure
            then '["read","create","update","delete","submit","approve"]'::jsonb
            else coalesce((
              select jsonb_agg(distinct permission.action)
              from public.hr_employee_assignments assignment
              join public.organization_model_permissions permission
                on permission.role_id = assignment.access_role_id
              where assignment.employee_id = actor and assignment.status = 'active'
                and permission.model_id = model.id
            ), '[]'::jsonb) end,
          'fields', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', field.id, 'field_key', field.field_key, 'label', field.label,
              'field_type', field.field_type, 'is_required', field.is_required,
              'is_active', field.is_active, 'sort_order', field.sort_order,
              'options', field.options
            ) order by field.sort_order, field.label)
            from public.organization_model_fields field where field.model_id = model.id
              and (can_configure or field.is_active)
          ), '[]'::jsonb),
          'transitions', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', transition.id, 'from_status', transition.from_status,
              'to_status', transition.to_status, 'label', transition.label,
              'required_action', transition.required_action, 'sort_order', transition.sort_order
            ) order by transition.sort_order, transition.label)
            from public.organization_model_transitions transition
            where transition.model_id = model.id and model.workflow_enabled
          ), '[]'::jsonb),
          'permissions', case when can_configure then coalesce((
            select jsonb_agg(jsonb_build_object(
              'role_id', permission.role_id, 'action', permission.action, 'scope', permission.scope
            ))
            from public.organization_model_permissions permission
            where permission.model_id = model.id
          ), '[]'::jsonb) else '[]'::jsonb end
        ) as value
        from public.organization_models model
        where can_configure or (
          model.is_active and exists (
            select 1
            from public.hr_employee_assignments assignment
            join public.organization_model_permissions permission
              on permission.role_id = assignment.access_role_id
            where assignment.employee_id = actor and assignment.status = 'active'
              and permission.model_id = model.id
          )
        )
      ) model_data
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.chowk_org_model_list_records(
  target_model uuid,
  target_limit integer default 50,
  target_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null or target_limit is null or target_limit not between 1 and 100
      or target_offset is null or target_offset < 0 then
    raise exception 'Sign in and provide a valid page size' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organization_models where id = target_model and is_active) then
    raise exception 'Active model not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.hr_employee_assignments assignment
    join public.organization_model_permissions permission
      on permission.role_id = assignment.access_role_id
    where assignment.employee_id = actor and assignment.status = 'active'
      and permission.model_id = target_model and permission.action = 'read'
      and case permission.scope
        when 'all' then true
        when 'department' then assignment.department_id is not null
        when 'assigned' then exists (
          select 1 from public.hr_employee_assignments managed
          where managed.manager_employee_id = actor and managed.status in ('pending', 'active', 'suspended')
        )
        when 'own' then true
        else false
      end
  ) and not exists (
    select 1 from public.profiles
    where id = actor and role in ('admin', 'super_admin')
  ) then
    raise exception 'Permission to read this model is required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(row_data) order by row_data.updated_at desc)
    from (
      select record.id, record.owner_id, record.department_id, record.status, record.data,
        record.revision, record.created_at, record.updated_at,
        profile.full_name as owner_name,
        (
          public.chowk_org_can_model_action(
            target_model, 'update', record.owner_id, record.department_id
          ) and (
            not model.workflow_enabled or record.status = model.initial_status
          )
        ) as can_update,
        public.chowk_org_can_model_action(
          target_model, 'delete', record.owner_id, record.department_id
        ) as can_delete,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', transition.id, 'label', transition.label,
            'from_status', transition.from_status, 'to_status', transition.to_status,
            'required_action', transition.required_action
          ) order by transition.sort_order, transition.label)
          from public.organization_model_transitions transition
          where transition.model_id = target_model and transition.from_status = record.status
            and model.workflow_enabled
            and public.chowk_org_can_model_action(
              target_model, transition.required_action, record.owner_id, record.department_id
            )
        ), '[]'::jsonb) as available_transitions
      from public.organization_records record
      join public.organization_models model on model.id = record.model_id and model.is_active
      left join public.profiles profile on profile.id = record.owner_id
      where record.model_id = target_model and record.deleted_at is null
        and public.chowk_org_can_model_action(
          target_model, 'read', record.owner_id, record.department_id
        )
      order by record.updated_at desc
      limit target_limit offset target_offset
    ) row_data
  ), '[]'::jsonb);
end;
$$;

create or replace function public.chowk_org_model_save_record(
  target_model uuid,
  target_id uuid,
  target_data jsonb,
  target_revision integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  record_row public.organization_records%rowtype;
  department uuid;
  status_value text;
  saved_id uuid;
begin
  if actor is null then raise exception 'Sign in to save this record' using errcode = '42501'; end if;
  select assignment.department_id into department
  from public.hr_employee_assignments assignment
  where assignment.employee_id = actor and assignment.status = 'active'
  order by assignment.is_primary desc, assignment.created_at desc limit 1;
  if target_id is null then
    if not exists (select 1 from public.organization_models where id = target_model and is_active) then
      raise exception 'Active model not found' using errcode = 'P0002';
    end if;
    if not public.chowk_org_can_model_action(target_model, 'create', actor, department) then
      raise exception 'Permission to create this model record is required' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.organization_models model
      where model.id = target_model and model.workflow_enabled
        and not exists (
          select 1 from public.organization_model_transitions transition
          where transition.model_id = model.id and transition.from_status = model.initial_status
        )
    ) then
      raise exception 'The model workflow needs an initial-state transition before records can be created'
        using errcode = '23514';
    end if;
    perform public.chowk_org_validate_model_data(target_model, target_data);
    select initial_status into status_value from public.organization_models where id = target_model;
    insert into public.organization_records(
      model_id, owner_id, department_id, status, data, created_by, updated_by
    ) values (
      target_model, actor, department, status_value, target_data, actor, actor
    ) returning id into saved_id;
    insert into public.organization_record_events(
      record_id, actor_id, event_type, to_status, revision, data_snapshot
    ) select saved_id, actor, 'created', status_value, 1, target_data;
  else
    select * into record_row from public.organization_records
    where id = target_id and model_id = target_model and deleted_at is null for update;
    if not found then raise exception 'Record not found' using errcode = 'P0002'; end if;
    if not public.chowk_org_can_model_action(
      target_model, 'update', record_row.owner_id, record_row.department_id
    ) then
      raise exception 'Permission to update this record is required' using errcode = '42501';
    end if;
    if target_revision is null or target_revision <> record_row.revision then
      raise exception 'This record changed since it was loaded. Reload it before saving'
        using errcode = '40001';
    end if;
    if not exists (
      select 1 from public.organization_models model
      where model.id = target_model and model.is_active
        and (not model.workflow_enabled or record_row.status = model.initial_status)
    ) then
      raise exception 'Only records in the initial workflow state can be edited'
        using errcode = '23514';
    end if;
    perform public.chowk_org_validate_model_data(target_model, target_data);
    target_data := target_data || (
      select coalesce(jsonb_object_agg(old_value.key, old_value.value), '{}'::jsonb)
      from jsonb_each(record_row.data) old_value
      where not target_data ? old_value.key
        and exists (
          select 1 from public.organization_model_fields field
          where field.model_id = target_model and field.field_key = old_value.key
            and not field.is_active
        )
    );
    update public.organization_records
    set data = target_data, revision = revision + 1, updated_by = actor, updated_at = now()
    where id = target_id returning id into saved_id;
    insert into public.organization_record_events(
      record_id, actor_id, event_type, from_status, to_status, revision, data_snapshot
    ) values (
      saved_id, actor, 'updated', record_row.status, record_row.status,
      record_row.revision + 1, target_data
    );
  end if;
  return saved_id;
end;
$$;

create or replace function public.chowk_org_model_transition_record(
  target_record uuid,
  target_transition uuid,
  target_revision integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  record_row public.organization_records%rowtype;
  transition_row public.organization_model_transitions%rowtype;
begin
  if actor is null then raise exception 'Sign in to update this record' using errcode = '42501'; end if;
  select * into record_row from public.organization_records
  where id = target_record and deleted_at is null for update;
  if not found then raise exception 'Record not found' using errcode = 'P0002'; end if;
  select * into transition_row from public.organization_model_transitions
  where id = target_transition and model_id = record_row.model_id
    and from_status = record_row.status;
  if not found then raise exception 'This workflow transition is not available' using errcode = '23514'; end if;
  if target_revision is null or record_row.revision <> target_revision then
    raise exception 'This record changed since it was loaded. Reload it before continuing'
      using errcode = '40001';
  end if;
  if not public.chowk_org_can_model_action(
    record_row.model_id, transition_row.required_action,
    record_row.owner_id, record_row.department_id
  ) then
    raise exception 'Permission to perform this workflow action is required' using errcode = '42501';
  end if;
  update public.organization_records
  set status = transition_row.to_status, revision = revision + 1,
      updated_by = actor, updated_at = now()
  where id = record_row.id;
  insert into public.organization_record_events(
    record_id, actor_id, event_type, from_status, to_status, revision, data_snapshot
  ) values (
    record_row.id, actor, 'transitioned', record_row.status, transition_row.to_status,
    record_row.revision + 1, record_row.data
  );
end;
$$;

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
  where id = target_record and deleted_at is null for update;
  if not found then raise exception 'Record not found' using errcode = 'P0002'; end if;
  if not public.chowk_org_can_model_action(
    record_row.model_id, 'delete', record_row.owner_id, record_row.department_id
  ) then
    raise exception 'Permission to delete this record is required' using errcode = '42501';
  end if;
  update public.organization_records set deleted_at = now(),
    revision = revision + 1, updated_by = actor, updated_at = now()
  where id = record_row.id;
  insert into public.organization_record_events(
    record_id, actor_id, event_type, from_status, to_status, revision, data_snapshot
  ) values (
    record_row.id, actor, 'deleted', record_row.status, record_row.status,
    record_row.revision + 1, record_row.data
  );
end;
$$;

create or replace function public.chowk_org_model_record_history(target_record uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); record_row public.organization_records%rowtype;
begin
  if actor is null then raise exception 'Sign in to view record history' using errcode = '42501'; end if;
  select * into record_row from public.organization_records where id = target_record;
  if not found then raise exception 'Record not found' using errcode = 'P0002'; end if;
  if not public.chowk_org_can_model_action(
    record_row.model_id, 'read', record_row.owner_id, record_row.department_id
  ) then
    raise exception 'Permission to read this record history is required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'event_type', event.event_type, 'actor_id', event.actor_id,
      'actor_name', profile.full_name, 'from_status', event.from_status,
      'to_status', event.to_status, 'revision', event.revision,
      'data_snapshot', event.data_snapshot, 'created_at', event.created_at
    ) order by event.created_at desc)
    from public.organization_record_events event
    left join public.profiles profile on profile.id = event.actor_id
    where event.record_id = target_record
  ), '[]'::jsonb);
end;
$$;

create or replace function public.chowk_org_keep_record_events_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Organization record history is immutable' using errcode = '42501';
  return old;
end;
$$;

alter table public.organization_models enable row level security;
alter table public.organization_model_fields enable row level security;
alter table public.organization_model_permissions enable row level security;
alter table public.organization_model_transitions enable row level security;
alter table public.organization_records enable row level security;
alter table public.organization_record_events enable row level security;

revoke all on public.organization_models, public.organization_model_fields,
  public.organization_model_permissions, public.organization_model_transitions,
  public.organization_records, public.organization_record_events
  from anon, authenticated;

revoke all on function public.chowk_org_can_model_action(uuid,text,uuid,uuid),
  public.chowk_org_validate_model_data(uuid,jsonb),
  public.chowk_org_save_model(uuid,text,text,text,text,boolean,boolean),
  public.chowk_org_save_model_field(uuid,uuid,text,text,text,boolean,boolean,integer,jsonb),
  public.chowk_org_set_model_permissions(uuid,uuid,jsonb),
  public.chowk_org_save_model_transition(uuid,uuid,text,text,text,text,integer),
  public.chowk_org_delete_model_transition(uuid),
  public.chowk_org_delete_unused_model(uuid),
  public.chowk_org_model_snapshot(),
  public.chowk_org_model_list_records(uuid,integer,integer),
  public.chowk_org_model_save_record(uuid,uuid,jsonb,integer),
  public.chowk_org_model_transition_record(uuid,uuid,integer),
  public.chowk_org_model_delete_record(uuid),
  public.chowk_org_model_record_history(uuid),
  public.chowk_org_keep_record_events_immutable()
  from public, anon;
grant execute on function public.chowk_org_model_snapshot(),
  public.chowk_org_model_list_records(uuid,integer,integer),
  public.chowk_org_model_save_record(uuid,uuid,jsonb,integer),
  public.chowk_org_model_transition_record(uuid,uuid,integer),
  public.chowk_org_model_delete_record(uuid),
  public.chowk_org_model_record_history(uuid)
  to authenticated;
grant execute on function public.chowk_org_save_model(uuid,text,text,text,text,boolean,boolean),
  public.chowk_org_save_model_field(uuid,uuid,text,text,text,boolean,boolean,integer,jsonb),
  public.chowk_org_set_model_permissions(uuid,uuid,jsonb),
  public.chowk_org_save_model_transition(uuid,uuid,text,text,text,text,integer),
  public.chowk_org_delete_model_transition(uuid),
  public.chowk_org_delete_unused_model(uuid)
  to authenticated;

create trigger audit_organization_models
  after insert or update or delete on public.organization_models
  for each row execute function public.chowk_audit_row();
create trigger audit_organization_model_fields
  after insert or update or delete on public.organization_model_fields
  for each row execute function public.chowk_audit_row();
create trigger audit_organization_model_permissions
  after insert or update or delete on public.organization_model_permissions
  for each row execute function public.chowk_audit_row();
create trigger audit_organization_model_transitions
  after insert or update or delete on public.organization_model_transitions
  for each row execute function public.chowk_audit_row();
create trigger keep_organization_record_events_immutable
  before update or delete on public.organization_record_events
  for each row execute function public.chowk_org_keep_record_events_immutable();
