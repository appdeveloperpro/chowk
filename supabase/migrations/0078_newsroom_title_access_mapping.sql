begin;

do $$
begin
  if exists (
    select 1
    from public.staff_role_assignments assignment
    join public.staff_role_definitions title
      on title.id = assignment.staff_role_id
    left join public.organization_access_roles permission_role
      on permission_role.role_key = title.access_profile
      and permission_role.is_active
    where assignment.status in ('pending', 'active')
      and permission_role.id is null
  ) then
    raise exception 'Activate the organization permission role matching each active newsroom account profile before applying this migration'
      using errcode = '23514';
  end if;
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
  account_profile text;
  relationship_kind text;
  relationship_state text;
  relationship_end timestamptz;
begin
  select definition.access_profile into account_profile
  from public.staff_role_definitions definition
  where definition.id = new.staff_role_id;
  if account_profile is null then
    raise exception 'The newsroom job title has no valid legacy account profile'
      using errcode = '23514';
  end if;

  select role.id into mapped_role
  from public.organization_access_roles role
  where role.role_key = account_profile and role.is_active;
  if mapped_role is null and new.status in ('pending', 'active') then
    raise exception 'The organization permission role for account profile "%" is missing or inactive',
      account_profile using errcode = '23514';
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

update public.organization_people person
set access_role_id = permission_role.id,
    updated_at = statement_timestamp()
from public.staff_role_assignments assignment
join public.staff_role_definitions title
  on title.id = assignment.staff_role_id
join public.organization_access_roles permission_role
  on permission_role.role_key = title.access_profile
  and permission_role.is_active
where person.source_type = 'staff_role_assignment'
  and person.source_id = assignment.id::text
  and person.ends_at is null
  and assignment.status in ('pending', 'active')
  and person.access_role_id is distinct from permission_role.id;

commit;
