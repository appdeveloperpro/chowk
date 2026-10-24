with recursive latest_zone_mappings as (
  select distinct on (district_id) zone_id, district_id
  from public.zone_districts
  order by district_id, valid_from desc, id desc
),
district_states(district_id, state_id, parent_id, visited) as (
  select district.id, parent.id, parent.parent_id, array[district.id, parent.id]
  from public.locations district
  join public.locations parent on parent.id = district.parent_id
  where district.location_type = 'district'
  union all
  select ancestors.district_id, parent.id, parent.parent_id, ancestors.visited || parent.id
  from district_states ancestors
  join public.locations parent on parent.id = ancestors.parent_id
  where not parent.id = any(ancestors.visited)
),
district_state_ids as (
  select distinct on (district_id) district_id, state_id
  from district_states
  where exists (
    select 1 from public.locations state
    where state.id = district_states.state_id
      and state.location_type = 'state'
  )
  order by district_id
),
eligible_range_history as (
  select
    mapping.district_id,
    mapping.range_id,
    row_number() over (
      partition by mapping.district_id
      order by (mapping.valid_to is null) desc, range_location.is_active desc,
               mapping.valid_from desc, mapping.id desc
    ) as history_rank
  from public.district_ranges mapping
  join latest_zone_mappings zone_mapping
    on zone_mapping.district_id = mapping.district_id
  join district_state_ids district_state
    on district_state.district_id = mapping.district_id
  join public.locations district
    on district.id = mapping.district_id
   and district.location_type = 'district'
  join public.locations range_location
    on range_location.id = mapping.range_id
   and range_location.location_type = 'range'
  join public.locations range_zone
    on range_zone.id = range_location.parent_id
   and range_zone.location_type = 'zone'
   and range_zone.id = zone_mapping.zone_id
  where range_zone.parent_id = district_state.state_id
    and (not district.is_active or range_location.is_active)
),
range_repair as (
  select district_id, range_id
  from eligible_range_history
  where history_rank = 1
)
update public.locations district
set parent_id = repair.range_id
from range_repair repair
join latest_zone_mappings zone_mapping on zone_mapping.district_id = repair.district_id
join public.locations current_range on current_range.location_type = 'range'
join public.locations current_zone on current_zone.id = current_range.parent_id
where district.id = repair.district_id
  and current_range.id = district.parent_id
  and current_zone.id is distinct from zone_mapping.zone_id;

do $$
declare
  unresolved_districts bigint[];
begin
  with latest_zone_mappings as (
    select distinct on (district_id) zone_id, district_id
    from public.zone_districts
    order by district_id, valid_from desc, id desc
  )
  select array_agg(district.id order by district.id)
  into unresolved_districts
  from public.locations district
  join latest_zone_mappings zone_mapping on zone_mapping.district_id = district.id
  join public.locations range_location
    on range_location.id = district.parent_id
   and range_location.location_type = 'range'
  join public.locations range_zone on range_zone.id = range_location.parent_id
  where district.location_type = 'district'
    and range_zone.id is distinct from zone_mapping.zone_id;

  if cardinality(unresolved_districts) > 0 then
    raise exception 'Districts % have a Range outside their mapped Zone and no matching historical Range assignment. Repair these District-to-Range assignments before applying this migration.',
      unresolved_districts;
  end if;
end;
$$;

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
    select zone.parent_id, zone.id
    into expected_state_id, parent_zone_id
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
        select old_zone.id
        into expected_zone_id
        from public.locations old_range
        join public.locations old_zone on old_zone.id = old_range.parent_id
        where old_range.id = old.parent_id
          and old_zone.location_type = 'zone';
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

create or replace function public.chowk_validate_zone_district()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  zone_row public.locations%rowtype;
  district_row public.locations%rowtype;
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

  if zone_row.parent_id is null or zone_row.parent_id is distinct from district_state_id then
    raise exception 'The zone and district must belong to the same state' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.district_id is distinct from old.district_id then
    raise exception 'A zone/district history row cannot be moved to another district' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop function if exists public.chowk_admin_assign_district_range(bigint, bigint);

create function public.chowk_admin_assign_district_range(
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
  if expected_zone_id is null
     and district_row.parent_id is not null then
    select existing_zone.id
    into expected_zone_id
    from public.locations existing_range
    join public.locations existing_zone on existing_zone.id = existing_range.parent_id
    where existing_range.id = district_row.parent_id
      and existing_range.location_type = 'range'
      and existing_zone.location_type = 'zone';
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
revoke all on function public.chowk_admin_assign_district_range(bigint, bigint, boolean) from public, anon;
grant execute on function public.chowk_admin_assign_district_range(bigint, bigint, boolean) to authenticated;

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
          coalesce(coverage.zone_id, coverage.district_id, coverage.city_id, coverage.coverage_area_id)
            = target_location
          and target_location in (select id from target_path)
        )
        or (
          coverage.include_descendants
          and coalesce(coverage.zone_id, coverage.district_id, coverage.city_id, coverage.coverage_area_id)
            in (select id from target_path)
        )
        or (
          coverage.include_descendants
          and coverage.zone_id is not null
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
            where zone_mapping.zone_id = coverage.zone_id
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
revoke all on function public.chowk_user_covers_location(uuid, bigint) from public, anon;
grant execute on function public.chowk_user_covers_location(uuid, bigint) to anon, authenticated;
