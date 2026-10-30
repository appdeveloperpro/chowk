begin;

create table public.staff_role_permissions (
  staff_role_id uuid not null references public.staff_role_definitions(id) on delete cascade,
  permission_key text not null references public.organization_permission_catalog(permission_key) on delete restrict,
  scope text not null check (scope in ('all', 'assigned', 'own')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (staff_role_id, permission_key)
);

insert into public.staff_role_permissions(staff_role_id, permission_key, scope)
select definition.id, permission.permission_key, permission.scope
from public.staff_role_definitions definition
join public.organization_access_roles access_role
  on access_role.role_key = definition.access_profile
join public.organization_access_role_permissions permission
  on permission.role_id = access_role.id
join public.organization_permission_catalog catalog
  on catalog.permission_key = permission.permission_key
where catalog.is_active
  and permission.scope in ('all', 'assigned', 'own');

alter table public.staff_role_permissions enable row level security;
revoke all on public.staff_role_permissions from anon;
grant select on public.staff_role_permissions to authenticated;

create policy "Admins and assigned staff read newsroom role permissions"
  on public.staff_role_permissions for select to authenticated
  using (
    (select public.chowk_has_any_role(array['admin', 'super_admin']))
    or exists (
      select 1
      from public.staff_role_assignments assignment
      where assignment.staff_role_id = staff_role_permissions.staff_role_id
        and assignment.user_id = (select auth.uid())
        and assignment.status in ('pending', 'active')
    )
  );

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
      join public.organization_access_roles access_role
        on access_role.id = person.access_role_id and access_role.is_active
      join public.organization_access_role_permissions permission
        on permission.role_id = access_role.id
       and permission.permission_key = target_permission
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
    ) or exists (
      select 1
      from public.staff_role_assignments assignment
      join public.staff_role_definitions definition
        on definition.id = assignment.staff_role_id and definition.is_active
      join public.staff_role_permissions permission
        on permission.staff_role_id = definition.id
       and permission.permission_key = target_permission
      join public.organization_people person
        on person.person_id = assignment.user_id
       and person.source_type = 'staff_role_assignment'
       and person.source_id = assignment.id::text
       and person.status = 'active'
       and person.ends_at is null
      join public.organization_permission_catalog catalog
        on catalog.permission_key = permission.permission_key and catalog.is_active
      where assignment.user_id = (select auth.uid())
        and assignment.status = 'active'
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
  select public.chowk_org_user_has_permission(target_permission, (select auth.uid()), null);
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
      select array_agg(distinct granted.permission_key order by granted.permission_key)
      from (
        select permission.permission_key
        from public.organization_people person
        join public.organization_access_roles access_role
          on access_role.id = person.access_role_id and access_role.is_active
        join public.organization_access_role_permissions permission
          on permission.role_id = access_role.id
        where person.person_id = (select auth.uid())
          and person.status = 'active' and person.ends_at is null
        union
        select permission.permission_key
        from public.staff_role_assignments assignment
        join public.staff_role_definitions definition
          on definition.id = assignment.staff_role_id and definition.is_active
        join public.staff_role_permissions permission
          on permission.staff_role_id = definition.id
        join public.organization_people person
          on person.person_id = assignment.user_id
         and person.source_type = 'staff_role_assignment'
         and person.source_id = assignment.id::text
         and person.status = 'active'
         and person.ends_at is null
        where assignment.user_id = (select auth.uid())
          and assignment.status = 'active'
      ) granted
      join public.organization_permission_catalog catalog
        on catalog.permission_key = granted.permission_key and catalog.is_active
      where public.chowk_org_permission_module_enabled(granted.permission_key)
    ), array[]::text[])
  end;
$$;

create or replace function public.chowk_admin_save_newsroom_role(
  target_role_id uuid,
  target_role_key text,
  target_display_name text,
  target_description text,
  target_duties text,
  target_is_active boolean,
  target_permissions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_role_id uuid;
  legacy_profile text;
  permission_item jsonb;
  permission_key_value text;
  permission_scope_value text;
  permission_count integer := 0;
  role_is_builtin boolean;
  actor uuid := (select auth.uid());
begin
  if actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if target_role_key is null
      or target_role_key !~ '^[a-z][a-z0-9_]{1,49}$'
      or length(trim(coalesce(target_display_name, ''))) not between 2 and 80
      or length(coalesce(target_description, '')) > 500
      or length(coalesce(target_duties, '')) > 5000
      or jsonb_typeof(target_permissions) is distinct from 'array' then
    raise exception 'Provide a valid newsroom role, responsibilities, and permission list'
      using errcode = '22023';
  end if;
  if jsonb_array_length(target_permissions) > 100 then
    raise exception 'A newsroom role cannot have more than 100 permissions'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(target_permissions) as entries(item)
    group by item->>'permission_key'
    having count(*) > 1
  ) then
    raise exception 'Each permission can appear only once in a newsroom role'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_permissions) as entries(item)
    left join public.organization_permission_catalog catalog
      on catalog.permission_key = item->>'permission_key' and catalog.is_active
    where jsonb_typeof(item) is distinct from 'object'
       or catalog.permission_key is null
       or coalesce(item->>'scope', '') not in ('all', 'assigned', 'own')
       or item->>'permission_key' !~ '^(newsroom|reporters|people|organization\.workflows)\.[a-z][a-z0-9_.-]*$'
  ) then
    raise exception 'Choose active newsroom, reporter, people, or workflow permissions with a valid scope'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(target_permissions) as entries(item)
    where item->>'permission_key' in (
      'newsroom.articles.publish', 'newsroom.articles.delete',
      'newsroom.categories.manage', 'newsroom.comments.moderate',
      'newsroom.reports.manage', 'newsroom.media.manage',
      'newsroom.locations.manage', 'newsroom.people.manage',
      'reporters.manage'
    )
      and item->>'scope' <> 'all'
  ) then
    raise exception 'Administrative newsroom permissions must use the all scope'
      using errcode = '22023';
  end if;

  if target_role_id is null then
    legacy_profile := case
      when exists (
        select 1 from jsonb_array_elements(target_permissions) as entries(item)
        where item->>'permission_key' = 'newsroom.articles.publish'
      ) then 'editor'
      else 'moderator'
    end;
    insert into public.staff_role_definitions(
      role_key, display_name, description, duties, access_profile, is_active, created_by
    ) values (
      target_role_key, trim(target_display_name), coalesce(target_description, ''),
      coalesce(target_duties, ''), legacy_profile, coalesce(target_is_active, true), actor
    ) returning id into saved_role_id;
  else
    select id, access_profile, is_builtin into saved_role_id, legacy_profile, role_is_builtin
    from public.staff_role_definitions
    where id = target_role_id
    for update;
    if not found then
      raise exception 'Newsroom role not found' using errcode = 'P0002';
    end if;
    if target_role_key is distinct from (
      select role_key from public.staff_role_definitions where id = target_role_id
    ) then
      raise exception 'A newsroom role key cannot be changed after creation'
        using errcode = '22023';
    end if;
    if legacy_profile = 'moderator' and exists (
      select 1 from jsonb_array_elements(target_permissions) as entries(item)
      where item->>'permission_key' = 'newsroom.articles.publish'
    ) then
      raise exception 'This role is tied to the legacy Moderator workflow. Create a separate newsroom role with publishing enabled.'
        using errcode = '23514';
    end if;
    update public.staff_role_definitions
    set display_name = trim(target_display_name),
        description = coalesce(target_description, ''),
        duties = coalesce(target_duties, ''),
        is_active = case when role_is_builtin then true else coalesce(target_is_active, true) end,
        updated_at = now()
    where id = saved_role_id;
  end if;

  delete from public.staff_role_permissions where staff_role_id = saved_role_id;
  for permission_item in
    select item from jsonb_array_elements(target_permissions) as entries(item)
  loop
    permission_key_value := permission_item->>'permission_key';
    permission_scope_value := permission_item->>'scope';
    insert into public.staff_role_permissions(
      staff_role_id, permission_key, scope, created_by
    ) values (
      saved_role_id, permission_key_value, permission_scope_value, actor
    );
    permission_count := permission_count + 1;
  end loop;
  if permission_count = 0 and (role_is_builtin or coalesce(target_is_active, true)) then
    raise exception 'An active newsroom role must grant at least one permission'
      using errcode = '23514';
  end if;

  return saved_role_id;
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
  account_profile text;
  relationship_kind text;
  relationship_state text;
  relationship_end timestamptz;
begin
  select definition.access_profile into account_profile
  from public.staff_role_definitions definition
  where definition.id = new.staff_role_id;
  if account_profile is null then
    raise exception 'The newsroom role has no valid legacy workflow profile'
      using errcode = '23514';
  end if;

  select id into primary_organization
  from public.organizations
  where is_primary and is_active;
  if primary_organization is null then
    raise exception 'An active primary organization is required before syncing people'
      using errcode = '23514';
  end if;

  relationship_kind := case when account_profile = 'reporter'
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
    'staff_role_assignment', new.id::text, new.assigned_at, relationship_end, null
  )
  on conflict (organization_id, person_id, relationship_type)
    where ends_at is null
  do update set status = excluded.status,
    source_id = excluded.source_id,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    access_role_id = null,
    updated_at = now();
  return new;
end;
$$;

update public.organization_people
set access_role_id = null,
    updated_at = now()
where source_type = 'staff_role_assignment'
  and access_role_id is not null;

revoke all on function public.chowk_admin_save_newsroom_role(uuid,text,text,text,text,boolean,jsonb)
  from public, anon;
grant execute on function public.chowk_admin_save_newsroom_role(uuid,text,text,text,text,boolean,jsonb)
  to authenticated;
revoke all on function public.chowk_admin_save_staff_role_definition(uuid,text,text,text,text,text,boolean)
  from public, anon, authenticated;

commit;
