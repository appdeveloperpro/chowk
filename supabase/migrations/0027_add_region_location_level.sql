alter table public.locations
  drop constraint if exists locations_location_type_check;

alter table public.locations
  add constraint locations_location_type_check
  check (location_type in ('state', 'region', 'zone', 'district', 'range', 'city', 'coverage_area'));

create or replace function public.chowk_validate_location_hierarchy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_type text;
  parent_active boolean;
  expected_state_id bigint;
  existing_state_id bigint;
  expected_zone_id bigint;
  parent_zone_id bigint;
begin
  if tg_op = 'UPDATE'
     and (old.location_type = 'city' or new.location_type = 'city') then
    if old.location_type = 'city'
       and new.location_type = 'city'
       and new.parent_id is not distinct from old.parent_id then
      select location_type, is_active
      into parent_type, parent_active
      from public.locations
      where id = old.parent_id;
      if parent_type is distinct from 'district' then
        raise exception 'Legacy city records must remain attached to their original district'
          using errcode = '23514';
      end if;
      if new.is_active and not parent_active then
        raise exception 'Activate the parent location before activating this legacy city'
          using errcode = '23514';
      end if;
      return new;
    end if;
    raise exception 'City locations are legacy records and cannot be created or moved; use a coverage area'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' and new.location_type = 'city' then
    raise exception 'City locations are no longer created; use a coverage area'
      using errcode = '23514';
  end if;

  if new.parent_id is null then
    if new.location_type <> 'state' then
      raise exception 'Only a state can be a top-level location' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A location cannot be its own parent' using errcode = '23514';
  end if;

  select location_type, is_active
  into parent_type, parent_active
  from public.locations
  where id = new.parent_id;

  if parent_type is null then
    raise exception 'Choose an existing parent location' using errcode = '23514';
  end if;

  if not (
    (new.location_type = 'region' and parent_type = 'state')
    or (new.location_type = 'zone' and parent_type = 'region')
    or (new.location_type = 'range' and parent_type = 'zone')
    or (new.location_type = 'district' and parent_type = 'range')
    or (new.location_type = 'coverage_area' and parent_type = 'district')
  ) then
    raise exception 'Location hierarchy must be State > Region > Zone > Range > District > Coverage area'
      using errcode = '23514';
  end if;

  if new.is_active and exists (
    with recursive ancestors(id, parent_id, is_active, visited) as (
      select parent.id, parent.parent_id, parent.is_active, array[new.id, parent.id]
      from public.locations parent
      where parent.id = new.parent_id
      union all
      select parent.id, parent.parent_id, parent.is_active, ancestors.visited || parent.id
      from ancestors
      join public.locations parent on parent.id = ancestors.parent_id
      where not parent.id = any(ancestors.visited)
    )
    select 1 from ancestors where not is_active
  ) then
    raise exception 'Activate the full parent chain before activating this location'
      using errcode = '23514';
  end if;

  if new.location_type = 'district' then
    with recursive ancestors(id, parent_id, location_type, visited) as (
      select parent.id, parent.parent_id, parent.location_type, array[new.parent_id, parent.id]
      from public.locations parent
      where parent.id = new.parent_id
      union all
      select parent.id, parent.parent_id, parent.location_type, ancestors.visited || parent.id
      from ancestors
      join public.locations parent on parent.id = ancestors.parent_id
      where not parent.id = any(ancestors.visited)
    )
    select
      (select id from ancestors where location_type = 'state' limit 1),
      (select id from ancestors where location_type = 'zone' limit 1)
    into expected_state_id, parent_zone_id;

    if expected_state_id is null or parent_zone_id is null then
      raise exception 'The district range must belong to a zone within a state' using errcode = '23514';
    end if;

    if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id then
      select mapping.zone_id
      into expected_zone_id
      from (
        select zone_id
        from public.zone_districts
        where district_id = new.id
        order by valid_from desc, id desc
        limit 1
      ) mapping;

      if expected_zone_id is null
         and exists (
           select 1 from public.locations old_range
           where old_range.id = old.parent_id
             and old_range.location_type = 'range'
         ) then
        with recursive ancestors(id, parent_id, location_type, visited) as (
          select parent.id, parent.parent_id, parent.location_type, array[old.id, parent.id]
          from public.locations parent
          where parent.id = old.parent_id
          union all
          select parent.id, parent.parent_id, parent.location_type, ancestors.visited || parent.id
          from ancestors
          join public.locations parent on parent.id = ancestors.parent_id
          where not parent.id = any(ancestors.visited)
        )
        select id into expected_zone_id
        from ancestors
        where location_type = 'zone'
        limit 1;
      end if;

      if expected_zone_id is not null and expected_zone_id is distinct from parent_zone_id then
        raise exception 'The district must be assigned to a range within its mapped zone. Update its zone mapping through an audited reassignment first.'
          using errcode = '23514';
      end if;

      with recursive ancestors(id, parent_id, location_type, visited) as (
        select parent.id, parent.parent_id, parent.location_type, array[old.id, parent.id]
        from public.locations parent
        where parent.id = old.parent_id
        union all
        select parent.id, parent.parent_id, parent.location_type, ancestors.visited || parent.id
        from ancestors
        join public.locations parent on parent.id = ancestors.parent_id
        where not parent.id = any(ancestors.visited)
      )
      select id into existing_state_id
      from ancestors
      where location_type = 'state'
      limit 1;

      if existing_state_id is not null and existing_state_id <> expected_state_id then
        raise exception 'A district and its new range must belong to the same state' using errcode = '23514';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' and exists (
    with recursive descendants(id, visited) as (
      select old.id, array[old.id]
      union all
      select child.id, descendants.visited || child.id
      from descendants
      join public.locations child on child.parent_id = descendants.id
      where not child.id = any(descendants.visited)
    )
    select 1 from descendants where id = new.parent_id
  ) then
    raise exception 'A location cannot be moved beneath one of its descendants' using errcode = '23514';
  end if;

  return new;
end;
$$;

insert into public.locations(name, slug, location_type, parent_id, is_active)
select
  'Unassigned Region',
  'unassigned-region-' || state.id::text,
  'region',
  state.id,
  state.is_active
from public.locations state
where state.location_type = 'state'
  and exists (
    select 1
    from public.locations zone
    where zone.location_type = 'zone'
      and zone.parent_id = state.id
  )
  and not exists (
    select 1
    from public.locations region
    where region.location_type = 'region'
      and region.parent_id = state.id
      and region.slug = 'unassigned-region-' || state.id::text
  );

update public.locations zone
set parent_id = region.id,
    is_active = zone.is_active and region.is_active
from public.locations region
where zone.location_type = 'zone'
  and region.location_type = 'region'
  and region.slug = 'unassigned-region-' || zone.parent_id::text
  and region.parent_id = zone.parent_id;

create or replace function public.chowk_validate_zone_district()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  zone_row public.locations%rowtype;
  district_row public.locations%rowtype;
  zone_state_id bigint;
  district_state_id bigint;
begin
  if tg_op = 'UPDATE'
     and new.zone_id = old.zone_id
     and new.district_id = old.district_id then
    return new;
  end if;

  select * into zone_row
  from public.locations
  where id = new.zone_id and is_active;
  select * into district_row
  from public.locations
  where id = new.district_id and is_active;
  if zone_row.id is null or zone_row.location_type <> 'zone' then
    raise exception 'Choose an active zone' using errcode = '23514';
  end if;
  if district_row.id is null or district_row.location_type <> 'district' then
    raise exception 'Choose an active district' using errcode = '23514';
  end if;

  with recursive ancestors(id, parent_id, location_type, visited) as (
    select parent.id, parent.parent_id, parent.location_type, array[zone_row.id, parent.id]
    from public.locations parent
    where parent.id = zone_row.parent_id
    union all
    select parent.id, parent.parent_id, parent.location_type, ancestors.visited || parent.id
    from ancestors
    join public.locations parent on parent.id = ancestors.parent_id
    where not parent.id = any(ancestors.visited)
  )
  select id into zone_state_id
  from ancestors
  where location_type = 'state'
  limit 1;

  with recursive ancestors(id, parent_id, location_type, visited) as (
    select parent.id, parent.parent_id, parent.location_type, array[district_row.id, parent.id]
    from public.locations parent
    where parent.id = district_row.parent_id
    union all
    select parent.id, parent.parent_id, parent.location_type, ancestors.visited || parent.id
    from ancestors
    join public.locations parent on parent.id = ancestors.parent_id
    where not parent.id = any(ancestors.visited)
  )
  select id into district_state_id
  from ancestors
  where location_type = 'state'
  limit 1;

  if zone_state_id is null or zone_state_id is distinct from district_state_id then
    raise exception 'The zone and district must belong to the same state' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.district_id is distinct from old.district_id then
    raise exception 'A zone/district history row cannot be moved to another district' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop function if exists public.chowk_admin_assign_district_range(bigint, bigint);

create or replace function public.chowk_admin_assign_district_range(
  target_range bigint,
  target_district bigint,
  allow_zone_transfer boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  range_row public.locations%rowtype;
  zone_row public.locations%rowtype;
  district_row public.locations%rowtype;
  current_mapping public.district_ranges%rowtype;
  current_zone_mapping public.zone_districts%rowtype;
  mapping_id bigint;
  range_state_id bigint;
  district_state_id bigint;
  expected_zone_id bigint;
begin
  if actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select * into range_row
  from public.locations
  where id = target_range and is_active
  for share;
  select * into district_row
  from public.locations
  where id = target_district and is_active
  for update;

  if range_row.id is null or range_row.location_type <> 'range' then
    raise exception 'Choose an active range' using errcode = '22023';
  end if;
  if district_row.id is null or district_row.location_type <> 'district' then
    raise exception 'Choose an active district' using errcode = '22023';
  end if;
  select * into zone_row
  from public.locations
  where id = range_row.parent_id and is_active;
  if zone_row.id is null or zone_row.location_type <> 'zone' then
    raise exception 'Choose a range beneath an active zone' using errcode = '22023';
  end if;

  select mapping.zone_id
  into expected_zone_id
  from (
    select zone_id
    from public.zone_districts
    where district_id = target_district
    order by valid_from desc, id desc
    limit 1
  ) mapping;
  if expected_zone_id is null and district_row.parent_id is not null then
    with recursive ancestors(id, parent_id, location_type, visited) as (
      select parent.id, parent.parent_id, parent.location_type, array[district_row.id, parent.id]
      from public.locations parent
      where parent.id = district_row.parent_id
      union all
      select parent.id, parent.parent_id, parent.location_type, ancestors.visited || parent.id
      from ancestors
      join public.locations parent on parent.id = ancestors.parent_id
      where not parent.id = any(ancestors.visited)
    )
    select id into expected_zone_id
    from ancestors
    where location_type = 'zone'
    limit 1;
  end if;
  if expected_zone_id is not null and expected_zone_id is distinct from zone_row.id then
    if not coalesce(allow_zone_transfer, false) then
      raise exception 'This district is mapped to another zone. Confirm a zone transfer to record the change in mapping history.'
        using errcode = '22023';
    end if;
  end if;

  select * into current_zone_mapping
  from public.zone_districts
  where district_id = target_district and valid_to is null
  for update;
  if current_zone_mapping.id is not null
     and current_zone_mapping.zone_id is distinct from zone_row.id then
    update public.zone_districts
    set valid_to = greatest(clock_timestamp(), valid_from + interval '1 microsecond')
    where id = current_zone_mapping.id;
    current_zone_mapping.id := null;
  end if;
  if current_zone_mapping.id is null then
    insert into public.zone_districts(zone_id, district_id, assigned_by)
    values (zone_row.id, target_district, actor);
  end if;

  with recursive ancestors(id, parent_id, location_type, visited) as (
    select parent.id, parent.parent_id, parent.location_type, array[zone_row.id, parent.id]
    from public.locations parent
    where parent.id = zone_row.parent_id
    union all
    select parent.id, parent.parent_id, parent.location_type, ancestors.visited || parent.id
    from ancestors
    join public.locations parent on parent.id = ancestors.parent_id
    where not parent.id = any(ancestors.visited)
  )
  select id into range_state_id
  from ancestors
  where location_type = 'state'
  limit 1;

  with recursive ancestors(id, parent_id, location_type, visited) as (
    select parent.id, parent.parent_id, parent.location_type, array[district_row.id, parent.id]
    from public.locations parent
    where parent.id = district_row.parent_id
    union all
    select parent.id, parent.parent_id, parent.location_type, ancestors.visited || parent.id
    from ancestors
    join public.locations parent on parent.id = ancestors.parent_id
    where not parent.id = any(ancestors.visited)
  )
  select id into district_state_id
  from ancestors
  where location_type = 'state'
  limit 1;

  if range_state_id is null or district_state_id is distinct from range_state_id then
    raise exception 'The range and district must belong to the same state' using errcode = '22023';
  end if;

  select * into current_mapping
  from public.district_ranges
  where district_id = target_district and valid_to is null
  for update;

  if district_row.parent_id is distinct from target_range then
    update public.locations
    set parent_id = target_range
    where id = target_district;
  elsif current_mapping.id is null or current_mapping.range_id is distinct from target_range then
    if current_mapping.id is not null then
      update public.district_ranges
      set valid_to = greatest(clock_timestamp(), valid_from + interval '1 microsecond')
      where id = current_mapping.id;
    end if;
    insert into public.district_ranges(range_id, district_id, assigned_by)
    values (target_range, target_district, actor)
    returning id into mapping_id;
    return mapping_id;
  end if;

  select id into mapping_id
  from public.district_ranges
  where district_id = target_district and valid_to is null;
  return mapping_id;
end;
$$;
revoke all on function public.chowk_admin_assign_district_range(bigint, bigint, boolean) from public, anon;
grant execute on function public.chowk_admin_assign_district_range(bigint, bigint, boolean) to authenticated;

alter table public.user_coverage_assignments
  add column if not exists region_id bigint references public.locations(id) on delete restrict;

do $$
declare
  check_name text;
begin
  for check_name in
    select constraint_row.conname
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.user_coverage_assignments'::regclass
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) like '%num_nonnulls%'
  loop
    execute format(
      'alter table public.user_coverage_assignments drop constraint %I',
      check_name
    );
  end loop;
end;
$$;

alter table public.user_coverage_assignments
  add constraint user_coverage_assignments_one_location_check
  check (num_nonnulls(region_id, zone_id, district_id, city_id, coverage_area_id) = 1);

create index if not exists coverage_assignments_region_idx
  on public.user_coverage_assignments(region_id, valid_from desc)
  where region_id is not null;

create or replace function public.chowk_admin_assign_coverage(
  target_user uuid,
  target_location bigint,
  include_children boolean default true
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  location_row public.locations%rowtype;
  assignment_id bigint;
begin
  if actor is null or not (select public.chowk_has_any_role(array['admin','super_admin'])) then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.profiles
    where id=target_user and role in ('reporter','moderator','editor')
  ) then
    raise exception 'Coverage can only be assigned to active newsroom staff' using errcode='23514';
  end if;
  select * into location_row
  from public.locations
  where id=target_location and is_active;
  if not found then
    raise exception 'Select an active coverage location' using errcode='22023';
  end if;
  if location_row.location_type not in ('region','zone','district','city','coverage_area') then
    raise exception 'Coverage must target a region, zone, district, city or coverage area' using errcode='22023';
  end if;
  if location_row.location_type = 'region' and location_row.slug like 'unassigned-region-%' then
    raise exception 'Move Zones into a named Region before assigning Region-level coverage' using errcode='22023';
  end if;
  insert into public.user_coverage_assignments(
    user_id,region_id,zone_id,district_id,city_id,coverage_area_id,include_descendants,assigned_by
  ) values (
    target_user,
    case when location_row.location_type='region' then location_row.id end,
    case when location_row.location_type='zone' then location_row.id end,
    case when location_row.location_type='district' then location_row.id end,
    case when location_row.location_type='city' then location_row.id end,
    case when location_row.location_type='coverage_area' then location_row.id end,
    coalesce(include_children,true),actor
  ) returning id into assignment_id;
  return assignment_id;
end;
$$;
revoke all on function public.chowk_admin_assign_coverage(uuid,bigint,boolean) from public, anon;
grant execute on function public.chowk_admin_assign_coverage(uuid,bigint,boolean) to authenticated;

create or replace function public.chowk_user_covers_location(target_user uuid, target_location bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive latest_zone_mappings as (
    select distinct on (district_id) zone_id, district_id
    from public.zone_districts
    order by district_id, valid_from desc, id desc
  ),
  target_path(id, parent_id, visited) as (
    select location.id, location.parent_id, array[location.id]
    from public.locations location
    where location.id = target_location and location.is_active
    union all
    select parent.id, parent.parent_id, target_path.visited || parent.id
    from target_path
    join public.locations parent on parent.id = target_path.parent_id and parent.is_active
    where not parent.id = any(target_path.visited)
  )
  select exists (
    select 1
    from public.user_coverage_assignments coverage
    where target_user = (select auth.uid())
      and coverage.user_id = target_user
      and coverage.valid_from <= now()
      and (coverage.valid_to is null or coverage.valid_to > now())
      and (
        (
          coalesce(coverage.region_id, coverage.zone_id, coverage.district_id, coverage.city_id, coverage.coverage_area_id)
            = target_location
          and target_location in (select id from target_path)
        )
        or (
          coverage.include_descendants
          and coalesce(coverage.region_id, coverage.zone_id, coverage.district_id, coverage.city_id, coverage.coverage_area_id)
            in (select id from target_path)
        )
        or (
          coverage.include_descendants
          and (coverage.region_id is not null or coverage.zone_id is not null)
          and exists (
            select 1
            from target_path
            join public.locations district
              on district.id = target_path.id
             and district.location_type = 'district'
             and district.is_active
            join latest_zone_mappings zone_mapping on zone_mapping.district_id = district.id
            join public.locations mapped_zone
              on mapped_zone.id = zone_mapping.zone_id
             and mapped_zone.location_type = 'zone'
             and mapped_zone.is_active
            where (
              zone_mapping.zone_id = coverage.zone_id
              or (
                coverage.region_id is not null
                and mapped_zone.parent_id = coverage.region_id
              )
            )
              and not exists (
                select 1
                from public.locations range_location
                where range_location.id = district.parent_id
                  and range_location.location_type = 'range'
              )
          )
        )
      )
  );
$$;
revoke all on function public.chowk_user_covers_location(uuid,bigint) from public, anon;
grant execute on function public.chowk_user_covers_location(uuid,bigint) to anon, authenticated;

create or replace function public.chowk_workspace_transition_article(
  target_article bigint,
  requested_action text,
  action_note text default '',
  scheduled_for timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_name_value text;
  actor_role text;
  article_row public.articles%rowtype;
  next_status text;
begin
  if actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select full_name,role into actor_name_value,actor_role
  from public.profiles where id=actor;
  select * into article_row from public.articles where id=target_article for update;
  if not found then raise exception 'Story not found' using errcode='P0002'; end if;
  if actor_role='moderator' and (
    article_row.reporting_location_id is null
    or not public.chowk_user_covers_location(actor,article_row.reporting_location_id)
    or (article_row.assigned_to is not null and article_row.assigned_to<>actor)
  ) then
    raise exception 'This story is outside your assigned coverage or assigned to another moderator' using errcode='42501';
  end if;

  if requested_action='submit' and actor_role in ('reporter','editor')
     and article_row.author_id=actor
     and article_row.workflow_status in ('draft','changes_requested') then
    next_status := 'submitted';
  elsif requested_action='withdraw' and actor_role='reporter'
     and article_row.author_id=actor
     and article_row.workflow_status in ('submitted','moderator_review','changes_requested') then
    next_status := 'withdrawn';
  elsif requested_action='restore_withdrawn' and actor_role='reporter'
     and article_row.author_id=actor
     and article_row.workflow_status='withdrawn' then
    next_status := 'draft';
  elsif requested_action='delete_withdrawn' and actor_role='reporter'
     and article_row.author_id=actor
     and article_row.workflow_status='withdrawn' then
    next_status := 'archived';
  elsif requested_action='start_review' and actor_role='moderator'
     and article_row.workflow_status='submitted' then
    next_status := 'moderator_review';
  elsif requested_action='send_to_editor' and actor_role='moderator'
     and article_row.workflow_status='moderator_review' then
    next_status := 'editor_review';
  elsif requested_action='request_changes' and actor_role in ('moderator','editor')
     and ((actor_role='moderator' and article_row.workflow_status='moderator_review')
       or (actor_role='editor' and article_row.workflow_status='editor_review')) then
    next_status := 'changes_requested';
  elsif requested_action='reject' and actor_role in ('moderator','editor')
     and ((actor_role='moderator' and article_row.workflow_status='moderator_review')
       or (actor_role='editor' and article_row.workflow_status='editor_review')) then
    next_status := 'rejected';
  elsif requested_action='publish' and actor_role in ('editor','publisher')
     and article_row.workflow_status in ('editor_review','scheduled') then
    next_status := 'published';
  elsif requested_action='schedule' and actor_role in ('editor','publisher')
     and article_row.workflow_status in ('editor_review','scheduled')
     and scheduled_for is not null and scheduled_for > now() then
    next_status := 'scheduled';
  elsif requested_action='unschedule' and actor_role in ('editor','publisher')
     and article_row.workflow_status='scheduled' then
    next_status := 'editor_review';
  elsif requested_action='reopen_rejected' and actor_role in ('admin','super_admin')
     and article_row.workflow_status='rejected' then
    next_status := 'submitted';
  elsif requested_action='publish' and actor_role in ('admin','super_admin')
     and article_row.workflow_status not in ('withdrawn','archived','rejected') then
    if length(trim(coalesce(action_note,''))) < 2 then
      raise exception 'Admin publication requires an override reason' using errcode='22023';
    end if;
    next_status := 'published';
  elsif requested_action='archive' and actor_role in ('editor','publisher','admin','super_admin')
     and article_row.workflow_status in ('published','scheduled','rejected') then
    next_status := 'archived';
  else
    raise exception 'This role cannot perform that action in the current story state' using errcode='42501';
  end if;

  if requested_action in ('request_changes','reject') and length(trim(coalesce(action_note,''))) < 2 then
    raise exception 'Add a review note to return or reject this story' using errcode='22023';
  end if;
  if actor_role in ('admin','super_admin') and length(trim(coalesce(action_note,''))) < 2 then
    raise exception 'Admin workflow overrides require an audit reason' using errcode='22023';
  end if;
  if requested_action='submit' and (
    length(trim(coalesce(article_row.title,''))) < 8
    or length(trim(coalesce(article_row.content,''))) < 50
  ) then
    raise exception 'Complete the headline and story content before submitting' using errcode='22023';
  end if;
  if requested_action='submit' and actor_role='reporter' and (
    not exists (select 1 from public.reporter_profiles where user_id=actor)
    or not exists (select 1 from public.reporter_assignments where user_id=actor and effective_to is null)
    or article_row.reporting_location_id is null
    or not public.chowk_user_covers_location(actor,article_row.reporting_location_id)
  ) then
    raise exception 'Current reporter assignment and coverage are required to submit this story' using errcode='42501';
  end if;
  if requested_action='submit' and actor_role='editor' and (
    article_row.reporting_location_id is null
    or not exists (
      select 1 from public.locations
      where id=article_row.reporting_location_id and is_active
    )
  ) then
    raise exception 'Choose an active reporting location before submitting this story' using errcode='22023';
  end if;
  perform set_config('chowk.workflow_event_action', requested_action, true);
  perform set_config('chowk.workflow_event_note', trim(coalesce(action_note,'')), true);
  update public.articles set
    workflow_status=next_status,
    status=case when next_status in ('published','scheduled') then 'published'
      when next_status='archived' then 'archived' else 'draft' end,
    published_at=case when next_status='published' then now()
      when next_status='scheduled' then scheduled_for
      when requested_action='unschedule'
        or next_status in ('archived','withdrawn','rejected','changes_requested') then null
      else published_at end,
    submitted_at=case when requested_action in ('submit','reopen_rejected') then now() else submitted_at end,
    review_note=case when requested_action in ('request_changes','reject') then trim(action_note)
      when requested_action in ('submit','send_to_editor','publish','schedule','unschedule','reopen_rejected') then ''
      else review_note end,
    assigned_to=case
      when requested_action='submit' and actor_role='reporter' then (
        with recursive latest_zone_mappings as (
          select distinct on (district_id) zone_id, district_id
          from public.zone_districts
          order by district_id, valid_from desc, id desc
        ),
        target_path(id,parent_id,visited) as (
          select location.id,location.parent_id,array[location.id]
          from public.locations location
          where location.id=article_row.reporting_location_id and location.is_active
          union all
          select parent.id,parent.parent_id,target_path.visited || parent.id
          from target_path
          join public.locations parent on parent.id=target_path.parent_id and parent.is_active
          where not parent.id=any(target_path.visited)
        )
        select moderator.id
        from public.profiles moderator
        join public.user_coverage_assignments coverage on coverage.user_id=moderator.id
        where moderator.role='moderator'
          and coverage.valid_from<=now()
          and (coverage.valid_to is null or coverage.valid_to>now())
          and (
            coalesce(coverage.region_id,coverage.zone_id,coverage.district_id,coverage.city_id,coverage.coverage_area_id)
              = article_row.reporting_location_id
            or (
              coverage.include_descendants
              and coalesce(coverage.region_id,coverage.zone_id,coverage.district_id,coverage.city_id,coverage.coverage_area_id)
                in (select id from target_path)
            )
            or (
              coverage.include_descendants
              and coverage.region_id is not null
              and exists (
                select 1
                from target_path
                join public.locations district
                  on district.id=target_path.id
                 and district.location_type='district'
                 and district.is_active
                join latest_zone_mappings zone_mapping on zone_mapping.district_id=district.id
                join public.locations mapped_zone
                  on mapped_zone.id=zone_mapping.zone_id
                 and mapped_zone.location_type='zone'
                 and mapped_zone.is_active
                where mapped_zone.parent_id=coverage.region_id
                  and not exists (
                    select 1
                    from public.locations range_location
                    where range_location.id=district.parent_id
                      and range_location.location_type='range'
                  )
              )
            )
          )
        order by coverage.valid_from desc,moderator.id
        limit 1
      )
      when next_status='moderator_review' then actor
      else null
    end,
    workflow_updated_at=now()
  where id=target_article;
  perform set_config('chowk.workflow_event_action', '', true);
  perform set_config('chowk.workflow_event_note', '', true);
end;
$$;
revoke all on function public.chowk_workspace_transition_article(bigint,text,text,timestamptz) from public, anon;
grant execute on function public.chowk_workspace_transition_article(bigint,text,text,timestamptz) to authenticated;

create or replace function public.chowk_admin_issue_credential(
  target_user uuid,
  credential_kind text,
  start_date date,
  end_date date,
  signer_name text default '',
  signer_designation text default '',
  signer_address text default ''
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  person public.profiles%rowtype;
  reporter_code_value text;
  assignment public.reporter_assignments%rowtype;
  signer public.profiles%rowtype;
  reference_value text;
  token_value text;
  credential_status text;
  issued_id bigint;
  snapshot_scope jsonb;
  approved_application boolean;
  service_agreement_accepted boolean;
  service_agreement_version_value text;
begin
  if actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select * into person from public.profiles where id = target_user;
  if person.id is null or person.role not in ('reporter', 'editor', 'moderator', 'subscriber') then
    raise exception 'Credentials require an eligible newsroom staff member' using errcode = '23514';
  end if;
  select exists (
    select 1 from public.reporter_applications
    where user_id = target_user and status in ('approved', 'active')
  ) into approved_application;
  select exists (
    select 1
    from public.reporter_applications application
    join public.reporter_service_agreement_versions agreement
      on agreement.status = 'published'
     and agreement.version = application.service_agreement_version
     and agreement.sha256 = application.service_agreement_sha256
    where application.user_id = target_user and application.status in ('approved', 'active')
      and application.service_agreement_accepted_at is not null
  ) into service_agreement_accepted;
  select service_agreement_version into service_agreement_version_value
  from public.reporter_applications
  where user_id = target_user and status in ('approved', 'active');
  if person.role = 'subscriber' and not approved_application then
    raise exception 'Only an approved reporter applicant can receive onboarding credentials' using errcode = '23514';
  end if;
  if credential_kind not in ('id_card', 'authority_letter') then
    raise exception 'Select a valid credential type' using errcode = '22023';
  end if;
  if credential_kind = 'id_card' and approved_application and not service_agreement_accepted then
    raise exception 'The reporter must accept the current service agreement before an ID card is issued' using errcode = '23514';
  end if;
  if credential_kind = 'authority_letter'
      and person.role <> 'reporter' and not approved_application then
    raise exception 'Authority letters are only issued to approved reporter applicants' using errcode = '23514';
  end if;
  if credential_kind = 'authority_letter' and approved_application and not service_agreement_accepted then
    raise exception 'The reporter must accept the current service agreement before an authority letter is issued' using errcode = '23514';
  end if;
  if start_date is null or end_date is null or end_date < start_date or end_date > start_date + 366 then
    raise exception 'Credential validity must be a valid period of no more than one year' using errcode = '22023';
  end if;
  if start_date < current_date then raise exception 'Credential start date cannot be in the past' using errcode = '22023'; end if;
  if credential_kind = 'id_card' and start_date <> current_date then
    raise exception 'ID cards must be effective from today' using errcode = '22023';
  end if;
  if credential_kind = 'authority_letter' and (
    length(trim(coalesce(signer_name, ''))) < 2 or length(trim(coalesce(signer_designation, ''))) < 2
    or length(trim(coalesce(signer_address, ''))) < 5
  ) then raise exception 'Authority letter signer name, designation and return address are required' using errcode = '22023'; end if;
  select reporter_code into reporter_code_value from public.reporter_profiles where user_id = target_user;
  select * into assignment from public.reporter_assignments
  where user_id = target_user and effective_to is null order by effective_from desc limit 1;
  if (person.role = 'reporter' or approved_application)
      and (assignment.id is null or reporter_code_value is null) then
    raise exception 'A reporter ID and current reporter assignment are required before issuing credentials' using errcode = '23514';
  end if;
  select * into signer from public.profiles where id = actor;
  snapshot_scope := case when assignment.id is not null then (
    select jsonb_build_object(
      'state_name', s.state_name, 'state_code', s.state_code,
      'rto_code', r.rto_code, 'city_name', r.city_name,
      'reporter_type', t.name, 'reporter_type_code', t.type_code
    )
    from public.rto_offices r join public.states s on s.id = r.state_id
    join public.reporter_types t on t.id = assignment.reporter_type_id
    where r.id = assignment.rto_office_id
  ) else coalesce((
    select jsonb_build_object(
      'coverage_location_id', location.id, 'coverage_name', location.name,
      'coverage_location_type', location.location_type, 'include_descendants', coverage.include_descendants
    )
    from public.user_coverage_assignments coverage
    join public.locations location on location.id = coalesce(
      coverage.region_id, coverage.zone_id, coverage.district_id, coverage.city_id, coverage.coverage_area_id
    )
    where coverage.user_id = target_user and coverage.valid_to is null
    order by coverage.valid_from desc limit 1
  ), '{}'::jsonb) end;
  reference_value := upper(case when credential_kind = 'id_card' then 'CH-ID-' else 'CH-AUTH-' end)
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  token_value := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
  credential_status := case when credential_kind = 'id_card' then 'active' else 'pending_acceptance' end;
  update public.staff_credentials set status = 'superseded'
  where subject_user_id_snapshot = target_user and credential_type = credential_kind
    and (status = 'pending_acceptance' or (credential_kind = 'id_card' and status = 'active'));
  insert into public.staff_credentials(
    user_id, subject_user_id_snapshot, credential_type, reference_code, verification_token, status,
    name_snapshot, role_snapshot, reporter_code_snapshot, scope_snapshot,
    issued_by, issued_by_name_snapshot, issued_by_role_snapshot,
    valid_from, valid_until, authorized_signer_name, authorized_signer_designation, return_address,
    service_agreement_version_snapshot
  ) values (
    target_user, target_user, credential_kind, reference_value, token_value, credential_status,
    person.full_name, case when approved_application then 'reporter' else person.role end,
    reporter_code_value, snapshot_scope,
    actor, signer.full_name, signer.role, start_date, end_date,
    nullif(trim(signer_name), ''), nullif(trim(signer_designation), ''), nullif(trim(signer_address), ''),
    case when credential_kind = 'authority_letter' then service_agreement_version_value end
  ) returning id into issued_id;
  return issued_id;
end;
$$;
revoke all on function public.chowk_admin_issue_credential(uuid,text,date,date,text,text,text) from public, anon;
grant execute on function public.chowk_admin_issue_credential(uuid,text,date,date,text,text,text) to authenticated;

create or replace function public.chowk_verify_staff_credential(verification_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  credential public.staff_credentials%rowtype;
  display_status text;
begin
  if verification_code !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid verification code' using errcode='22023';
  end if;
  select * into credential from public.staff_credentials where verification_token=verification_code;
  if not found then return null; end if;
  display_status := credential.status;
  if credential.status in ('active','pending_acceptance') then
    if credential.valid_until < current_date then
      display_status := 'expired';
    elsif credential.valid_from > current_date and credential.status='active' then
      display_status := 'not_yet_valid';
    elsif not exists (
      select 1 from public.profiles p
      where p.id=credential.subject_user_id_snapshot and p.role=credential.role_snapshot
    ) then
      display_status := 'inactive';
    elsif credential.role_snapshot = 'reporter' and not exists (
      select 1
      from public.reporter_assignments assignment
      join public.rto_offices rto on rto.id=assignment.rto_office_id
      join public.states state_row on state_row.id=rto.state_id
      join public.reporter_types reporter_type on reporter_type.id=assignment.reporter_type_id
      where assignment.user_id=credential.subject_user_id_snapshot
        and assignment.effective_to is null
        and state_row.state_code=credential.scope_snapshot->>'state_code'
        and rto.rto_code=credential.scope_snapshot->>'rto_code'
        and reporter_type.type_code=credential.scope_snapshot->>'reporter_type_code'
    ) then
      display_status := 'inactive';
    elsif credential.role_snapshot in ('editor','moderator')
      and credential.scope_snapshot ? 'coverage_location_id'
      and not exists (
        select 1 from public.user_coverage_assignments coverage
        where coverage.user_id=credential.subject_user_id_snapshot
          and coverage.valid_to is null
          and coalesce(coverage.region_id,coverage.zone_id,coverage.district_id,coverage.city_id,coverage.coverage_area_id)::text
            = credential.scope_snapshot->>'coverage_location_id'
      ) then
      display_status := 'inactive';
    end if;
  end if;
  return jsonb_build_object(
    'credential_type',credential.credential_type,
    'reference_code',credential.reference_code,
    'status',display_status,
    'name',credential.name_snapshot,
    'role',credential.role_snapshot,
    'reporter_code',credential.reporter_code_snapshot,
    'scope',credential.scope_snapshot,
    'valid_from',credential.valid_from,
    'valid_until',credential.valid_until
  );
end;
$$;
revoke all on function public.chowk_verify_staff_credential(text) from public, authenticated;
grant execute on function public.chowk_verify_staff_credential(text) to anon;
