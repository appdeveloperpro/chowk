drop trigger if exists chowk_locations_sync_activation on public.locations;
drop trigger if exists chowk_locations_cascade_deactivation on public.locations;

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

  if new.is_active and not parent_active then
    raise exception 'Activate the parent location before activating this location' using errcode = '23514';
  end if;

  if not (
    (new.location_type = 'zone' and parent_type = 'state')
    or (new.location_type = 'range' and parent_type = 'zone')
    or (new.location_type = 'district' and parent_type = 'range')
    or (new.location_type = 'coverage_area' and parent_type = 'district')
  ) then
    raise exception 'Location hierarchy must be State > Zone > Range > District > Coverage area'
      using errcode = '23514';
  end if;

  if new.location_type = 'district' then
    select zone.parent_id
    into expected_state_id
    from public.locations range_location
    join public.locations zone on zone.id = range_location.parent_id
    where range_location.id = new.parent_id
      and range_location.location_type = 'range'
      and zone.location_type = 'zone';

    if expected_state_id is null then
      raise exception 'The district range must belong to a zone within a state' using errcode = '23514';
    end if;
    if new.is_active and not exists (
      select 1
      from public.locations range_location
      join public.locations zone on zone.id = range_location.parent_id
      join public.locations state on state.id = zone.parent_id
      where range_location.id = new.parent_id
        and range_location.is_active
        and zone.is_active
        and state.is_active
    ) then
      raise exception 'Activate the full parent chain before activating this district'
        using errcode = '23514';
    end if;

    if tg_op = 'UPDATE' then
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

with recursive latest_range_mappings as (
  select distinct on (district_id) range_id, district_id
  from public.district_ranges
  order by district_id, valid_from desc, id desc
),
district_ancestors(district_id, ancestor_id, ancestor_type, parent_id, visited) as (
  select district.id, parent.id, parent.location_type, parent.parent_id,
         array[district.id, parent.id]
  from public.locations district
  join public.locations parent on parent.id = district.parent_id
  where district.location_type = 'district'
  union all
  select ancestors.district_id, parent.id, parent.location_type, parent.parent_id,
         ancestors.visited || parent.id
  from district_ancestors ancestors
  join public.locations parent on parent.id = ancestors.parent_id
  where not parent.id = any(ancestors.visited)
),
district_states as (
  select distinct on (district_id) district_id, ancestor_id as state_id
  from district_ancestors
  where ancestor_type = 'state'
  order by district_id
),
eligible_mappings as (
  select mapping.district_id, mapping.range_id
  from latest_range_mappings mapping
  join district_states on district_states.district_id = mapping.district_id
  join public.locations range_location
    on range_location.id = mapping.range_id
   and range_location.location_type = 'range'
  join public.locations zone_location
    on zone_location.id = range_location.parent_id
   and zone_location.location_type = 'zone'
  where zone_location.parent_id = district_states.state_id
)
update public.locations district
set parent_id = mapping.range_id,
    is_active = district.is_active and range_location.is_active
from eligible_mappings mapping
join public.locations range_location on range_location.id = mapping.range_id
where district.id = mapping.district_id
  and district.location_type = 'district'
  and district.parent_id is distinct from mapping.range_id;

update public.locations coverage_area
set parent_id = city.parent_id,
    is_active = coverage_area.is_active and district.is_active
from public.locations city
join public.locations district on district.id = city.parent_id
where coverage_area.location_type = 'coverage_area'
  and city.location_type = 'city'
  and coverage_area.parent_id = city.id
  and district.location_type = 'district';

update public.district_ranges mapping
set valid_to = greatest(clock_timestamp(), mapping.valid_from + interval '1 microsecond')
where mapping.valid_to is null
  and not exists (
    select 1
    from public.locations district
    where district.id = mapping.district_id
      and district.location_type = 'district'
      and district.parent_id = mapping.range_id
  );

create or replace function public.chowk_validate_district_range()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  range_row public.locations%rowtype;
  zone_row public.locations%rowtype;
  district_row public.locations%rowtype;
begin
  select * into range_row
  from public.locations
  where id = new.range_id and is_active;
  select * into district_row
  from public.locations
  where id = new.district_id and is_active;

  if range_row.id is null or range_row.location_type <> 'range' then
    raise exception 'Choose an active range' using errcode = '23514';
  end if;
  if district_row.id is null or district_row.location_type <> 'district' then
    raise exception 'Choose an active district' using errcode = '23514';
  end if;
  if district_row.parent_id is distinct from range_row.id then
    raise exception 'The district must be a child of its assigned range' using errcode = '23514';
  end if;

  select * into zone_row
  from public.locations
  where id = range_row.parent_id and is_active;
  if zone_row.id is null or zone_row.location_type <> 'zone' then
    raise exception 'The range must belong to an active zone' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.district_id is distinct from old.district_id then
    raise exception 'A district/range history row cannot be moved to another district' using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.chowk_sync_district_range_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_mapping public.district_ranges%rowtype;
begin
  if old.location_type <> 'district'
     or new.location_type <> 'district'
     or old.parent_id is not distinct from new.parent_id then
    return new;
  end if;

  select * into current_mapping
  from public.district_ranges
  where district_id = new.id and valid_to is null
  for update;

  if current_mapping.id is not null then
    update public.district_ranges
    set valid_to = greatest(clock_timestamp(), valid_from + interval '1 microsecond')
    where id = current_mapping.id;
  end if;

  if new.is_active then
    insert into public.district_ranges(range_id, district_id, assigned_by)
    values (new.parent_id, new.id, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists chowk_locations_sync_district_range on public.locations;
create trigger chowk_locations_sync_district_range
after update of parent_id on public.locations
for each row
when (old.parent_id is distinct from new.parent_id)
execute function public.chowk_sync_district_range_assignment();

create or replace function public.chowk_admin_assign_district_range(
  target_range bigint,
  target_district bigint
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
  mapping_id bigint;
  range_state_id bigint;
  district_state_id bigint;
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
  range_state_id := zone_row.parent_id;

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
revoke all on function public.chowk_admin_assign_district_range(bigint, bigint) from public, anon;
grant execute on function public.chowk_admin_assign_district_range(bigint, bigint) to authenticated;

create or replace function public.chowk_admin_end_district_range(target_mapping bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  raise exception 'District-to-range membership is controlled by the location hierarchy; edit the district parent to reassign it'
    using errcode = '22023';
end;
$$;
revoke all on function public.chowk_admin_end_district_range(bigint) from public, anon;
grant execute on function public.chowk_admin_end_district_range(bigint) to authenticated;

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
  if actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = target_user and role in ('reporter', 'moderator', 'editor')
  ) then
    raise exception 'Coverage can only be assigned to active newsroom staff' using errcode = '23514';
  end if;

  select * into location_row
  from public.locations
  where id = target_location and is_active;
  if not found then
    raise exception 'Select an active coverage location' using errcode = '22023';
  end if;
  if location_row.location_type not in ('zone', 'district', 'coverage_area') then
    raise exception 'New coverage assignments must target a zone, district, or coverage area'
      using errcode = '22023';
  end if;

  insert into public.user_coverage_assignments(
    user_id, zone_id, district_id, city_id, coverage_area_id, include_descendants, assigned_by
  ) values (
    target_user,
    case when location_row.location_type = 'zone' then location_row.id end,
    case when location_row.location_type = 'district' then location_row.id end,
    null,
    case when location_row.location_type = 'coverage_area' then location_row.id end,
    coalesce(include_children, true),
    actor
  )
  returning id into assignment_id;
  return assignment_id;
end;
$$;
revoke all on function public.chowk_admin_assign_coverage(uuid, bigint, boolean) from public, anon;
grant execute on function public.chowk_admin_assign_coverage(uuid, bigint, boolean) to authenticated;

create or replace function public.chowk_sync_location_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  descendant_ids bigint[];
  affected_ids bigint[];
  frontier_ids bigint[];
  next_frontier_ids bigint[];
begin
  if pg_trigger_depth() > 1 or old.is_active is not distinct from new.is_active then
    return new;
  end if;

  with recursive latest_zone_mappings as (
    select distinct on (district_id) zone_id, district_id
    from public.zone_districts
    order by district_id, valid_from desc, id desc
  ),
  hierarchy_edges(parent_id, child_id) as (
    select parent_id, id
    from public.locations
    where parent_id is not null
    union
    select mapping.zone_id, mapping.district_id
    from latest_zone_mappings mapping
    join public.locations district on district.id = mapping.district_id
    where not exists (
      select 1 from public.locations range_location
      where range_location.id = district.parent_id
        and range_location.location_type = 'range'
    )
  ),
  descendants(id) as (
    select child_id
    from hierarchy_edges
    where parent_id = new.id
    union
    select edge.child_id
    from descendants parent
    join hierarchy_edges edge on edge.parent_id = parent.id
  )
  select coalesce(array_agg(id), '{}'::bigint[])
  into descendant_ids
  from descendants;
  affected_ids := array_append(descendant_ids, new.id);

  if not new.is_active then
    update public.locations
    set is_active = false
    where is_active and id = any(descendant_ids);

    update public.district_ranges
    set valid_to = greatest(clock_timestamp(), valid_from + interval '1 microsecond')
    where valid_to is null
      and (range_id = any(affected_ids) or district_id = any(affected_ids));

    return new;
  end if;

  frontier_ids := array[new.id];
  affected_ids := array[new.id];
  loop
    with latest_zone_mappings as (
      select distinct on (district_id) zone_id, district_id
      from public.zone_districts
      order by district_id, valid_from desc, id desc
    ),
    hierarchy_edges(parent_id, child_id) as (
      select parent_id, id
      from public.locations
      where parent_id is not null
      union
      select mapping.zone_id, mapping.district_id
      from latest_zone_mappings mapping
      join public.locations district on district.id = mapping.district_id
      where not exists (
        select 1 from public.locations range_location
        where range_location.id = district.parent_id
          and range_location.location_type = 'range'
      )
    )
    select coalesce(array_agg(edge.child_id), '{}'::bigint[])
    into next_frontier_ids
    from hierarchy_edges edge
    where edge.parent_id = any(frontier_ids)
      and not edge.child_id = any(affected_ids);

    exit when cardinality(next_frontier_ids) = 0;

    update public.locations
    set is_active = true
    where not is_active and id = any(next_frontier_ids);

    affected_ids := affected_ids || next_frontier_ids;
    frontier_ids := next_frontier_ids;
  end loop;

  insert into public.district_ranges(range_id, district_id, assigned_by)
  select range_location.id, district_location.id, auth.uid()
  from public.locations district_location
  join public.locations range_location
    on range_location.id = district_location.parent_id
   and range_location.location_type = 'range'
   and range_location.is_active
  where district_location.location_type = 'district'
    and district_location.is_active
    and (range_location.id = any(affected_ids) or district_location.id = any(affected_ids))
    and not exists (
      select 1
      from public.district_ranges current_mapping
      where current_mapping.district_id = district_location.id
        and current_mapping.valid_to is null
    )
  on conflict (district_id) where valid_to is null do nothing;

  return new;
end;
$$;

with recursive latest_zone_mappings as (
  select distinct on (district_id) zone_id, district_id
  from public.zone_districts
  order by district_id, valid_from desc, id desc
),
hierarchy_edges(parent_id, child_id) as (
  select parent_id, id
  from public.locations
  where parent_id is not null
  union
  select mapping.zone_id, mapping.district_id
  from latest_zone_mappings mapping
  join public.locations district on district.id = mapping.district_id
  where not exists (
    select 1 from public.locations range_location
    where range_location.id = district.parent_id
      and range_location.location_type = 'range'
  )
),
descendants(id) as (
  select edge.child_id
  from hierarchy_edges edge
  join public.locations parent on parent.id = edge.parent_id
  where not parent.is_active
    and exists (
      select 1 from public.locations child
      where child.id = edge.child_id and child.is_active
    )
  union
  select edge.child_id
  from descendants parent
  join hierarchy_edges edge on edge.parent_id = parent.id
  join public.locations child on child.id = edge.child_id
  where child.is_active
)
update public.locations
set is_active = false
where id in (select id from descendants);

update public.district_ranges mapping
set valid_to = greatest(clock_timestamp(), mapping.valid_from + interval '1 microsecond')
where mapping.valid_to is null
  and not exists (
    select 1
    from public.locations district
    join public.locations range_location on range_location.id = mapping.range_id
    where district.id = mapping.district_id
      and district.parent_id = range_location.id
      and district.is_active
      and range_location.is_active
  );

insert into public.district_ranges(range_id, district_id)
select range_location.id, district.id
from public.locations district
join public.locations range_location
  on range_location.id = district.parent_id
 and range_location.location_type = 'range'
 and range_location.is_active
where district.location_type = 'district'
  and district.is_active
  and not exists (
    select 1 from public.district_ranges mapping
    where mapping.district_id = district.id
      and mapping.valid_to is null
  )
on conflict (district_id) where valid_to is null do nothing;

create trigger chowk_locations_sync_activation
after update of is_active on public.locations
for each row
when (old.is_active is distinct from new.is_active)
execute function public.chowk_sync_location_activation();
