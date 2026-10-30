begin;

do $$
declare
  cyclic_employee uuid;
begin
  with recursive manager_edges as (
    select assignment.employee_id, assignment.manager_employee_id
    from public.hr_employee_assignments assignment
    where assignment.status in ('pending', 'active', 'suspended')
      and assignment.manager_employee_id is not null
  ),
  manager_walk(root_employee_id, current_manager_id, path, is_cycle) as (
    select edge.employee_id, edge.manager_employee_id,
      array[edge.employee_id, edge.manager_employee_id],
      edge.employee_id = edge.manager_employee_id
    from manager_edges edge
    union all
    select walk.root_employee_id, edge.manager_employee_id,
      walk.path || edge.manager_employee_id,
      edge.manager_employee_id = walk.root_employee_id
    from manager_walk walk
    join manager_edges edge on edge.employee_id = walk.current_manager_id
    where not walk.is_cycle
      and (
        edge.manager_employee_id = walk.root_employee_id
        or not edge.manager_employee_id = any(walk.path)
      )
  )
  select root_employee_id into cyclic_employee
  from manager_walk
  where is_cycle
  limit 1;

  if cyclic_employee is not null then
    raise exception 'An existing HR manager cycle must be corrected before applying this migration (employee %)', cyclic_employee
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.chowk_hr_prevent_manager_cycles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  creates_cycle boolean;
begin
  if new.manager_employee_id is null
      or new.status not in ('pending', 'active', 'suspended') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('chowk_hr_manager_hierarchy', 0));

  with recursive manager_edges as (
    select assignment.employee_id, assignment.manager_employee_id
    from public.hr_employee_assignments assignment
    where assignment.id is distinct from new.id
      and assignment.status in ('pending', 'active', 'suspended')
      and assignment.manager_employee_id is not null
    union all
    select new.employee_id, new.manager_employee_id
  ),
  manager_chain(employee_id, path) as (
    select new.manager_employee_id, array[new.manager_employee_id]
    union all
    select edge.manager_employee_id, chain.path || edge.manager_employee_id
    from manager_chain chain
    join manager_edges edge on edge.employee_id = chain.employee_id
    where not edge.manager_employee_id = any(chain.path)
  )
  select exists (
    select 1 from manager_chain where employee_id = new.employee_id
  ) into creates_cycle;

  if creates_cycle then
    raise exception 'This manager assignment would create a reporting cycle'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_hr_manager_cycles on public.hr_employee_assignments;
create trigger prevent_hr_manager_cycles
  before insert or update of employee_id, manager_employee_id, status
  on public.hr_employee_assignments
  for each row execute function public.chowk_hr_prevent_manager_cycles();

create or replace function public.chowk_location_leadership_person_is_eligible(target_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = target_person
      and (
        exists (
          select 1
          from public.hr_employees employee
          join public.hr_employee_assignments assignment
            on assignment.employee_id = employee.id
            and assignment.status = 'active'
            and assignment.starts_at <= statement_timestamp()
          where employee.id = profile.id and employee.employment_status = 'active'
        )
        or (
          profile.role = 'reporter'
          and exists (
            select 1 from public.reporter_profiles reporter
            join public.reporter_assignments assignment
              on assignment.user_id = reporter.user_id
              and assignment.effective_to is null
              and assignment.effective_from <= statement_timestamp()
            where reporter.user_id = profile.id
          )
        )
        or (
          profile.role in ('moderator', 'editor')
          and exists (
            select 1 from public.staff_onboarding onboarding
            join public.staff_role_assignments assignment
              on assignment.user_id = onboarding.user_id
              and assignment.status = 'active'
            where onboarding.user_id = profile.id
              and onboarding.status = 'active'
              and onboarding.requested_role = profile.role
          )
        )
      )
  );
$$;

revoke all on function public.chowk_hr_prevent_manager_cycles() from public, anon, authenticated;

commit;
