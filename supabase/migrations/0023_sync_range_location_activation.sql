create or replace function public.chowk_sync_location_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_ids bigint[];
  restored_ids bigint[];
begin
  if pg_trigger_depth() > 1 or old.is_active is not distinct from new.is_active then
    return new;
  end if;

  if not new.is_active then
    with recursive latest_range_mappings as (
      select distinct on (district_id) range_id, district_id
      from public.district_ranges
      order by district_id, valid_from desc, id desc
    ),
    latest_zone_mappings as (
      select distinct on (district_id) zone_id, district_id
      from public.zone_districts
      order by district_id, valid_from desc, id desc
    ),
    hierarchy_edges(parent_id, child_id) as (
      select parent_id, id
      from public.locations
      where parent_id is not null
      union
      select range_id, district_id from latest_range_mappings
      union
      select zone_id, district_id from latest_zone_mappings
    ),
    affected_locations(id) as (
      select child_id
      from hierarchy_edges
      where parent_id = new.id
      union
      select edge.child_id
      from affected_locations affected
      join hierarchy_edges edge on edge.parent_id = affected.id
    )
    select coalesce(array_agg(id), '{}'::bigint[])
    into affected_ids
    from affected_locations;

    update public.locations location
    set is_active = false
    where location.is_active
      and location.id = any(affected_ids);

    update public.district_ranges
    set valid_to = greatest(clock_timestamp(), valid_from + interval '1 microsecond')
    where valid_to is null
      and (range_id = any(affected_ids) or district_id = any(affected_ids));

    update public.zone_districts
    set valid_to = greatest(clock_timestamp(), valid_from + interval '1 microsecond')
    where valid_to is null
      and (zone_id = any(affected_ids) or district_id = any(affected_ids));

    return new;
  end if;

  with recursive latest_range_mappings as (
    select distinct on (district_id) range_id, district_id
    from public.district_ranges
    order by district_id, valid_from desc, id desc
  ),
  latest_zone_mappings as (
    select distinct on (district_id) zone_id, district_id
    from public.zone_districts
    order by district_id, valid_from desc, id desc
  ),
  hierarchy_edges(parent_id, child_id) as (
    select parent_id, id
    from public.locations
    where parent_id is not null
    union
    select range_id, district_id from latest_range_mappings
    union
    select zone_id, district_id from latest_zone_mappings
  ),
  descendants(id) as (
    select child_id
    from hierarchy_edges
    where parent_id = new.id
    union
    select edge.child_id
    from descendants descendant
    join hierarchy_edges edge on edge.parent_id = descendant.id
  )
  select coalesce(array_agg(id), '{}'::bigint[])
  into affected_ids
  from descendants;

  update public.locations location
  set is_active = true
  where not location.is_active
    and location.id = any(affected_ids);

  restored_ids := array_append(affected_ids, new.id);

  insert into public.district_ranges(range_id, district_id, assigned_by)
  select latest.range_id, latest.district_id, auth.uid()
  from (
    select distinct on (district_id) range_id, district_id
    from public.district_ranges
    order by district_id, valid_from desc, id desc
  ) latest
  where (latest.range_id = any(restored_ids) or latest.district_id = any(restored_ids))
    and exists (
      select 1 from public.locations
      where id = latest.range_id and is_active
    )
    and exists (
      select 1 from public.locations
      where id = latest.district_id and is_active
    )
    and not exists (
      select 1 from public.district_ranges current_mapping
      where current_mapping.district_id = latest.district_id
        and current_mapping.valid_to is null
    )
  on conflict (district_id) where valid_to is null do nothing;

  insert into public.zone_districts(zone_id, district_id, assigned_by)
  select latest.zone_id, latest.district_id, auth.uid()
  from (
    select distinct on (district_id) zone_id, district_id
    from public.zone_districts
    order by district_id, valid_from desc, id desc
  ) latest
  where (latest.zone_id = any(restored_ids) or latest.district_id = any(restored_ids))
    and exists (
      select 1 from public.locations
      where id = latest.zone_id and is_active
    )
    and exists (
      select 1 from public.locations
      where id = latest.district_id and is_active
    )
    and not exists (
      select 1 from public.zone_districts current_mapping
      where current_mapping.district_id = latest.district_id
        and current_mapping.valid_to is null
    )
  on conflict (district_id) where valid_to is null do nothing;

  return new;
end;
$$;

with recursive latest_range_mappings as (
  select distinct on (district_id) range_id, district_id
  from public.district_ranges
  order by district_id, valid_from desc, id desc
),
latest_zone_mappings as (
  select distinct on (district_id) zone_id, district_id
  from public.zone_districts
  order by district_id, valid_from desc, id desc
),
hierarchy_edges(parent_id, child_id) as (
  select parent_id, id
  from public.locations
  where parent_id is not null
  union
  select range_id, district_id from latest_range_mappings
  union
  select zone_id, district_id from latest_zone_mappings
),
affected_locations(id) as (
  select edge.child_id
  from hierarchy_edges edge
  join public.locations parent on parent.id = edge.parent_id
  where not parent.is_active
  union
  select edge.child_id
  from affected_locations affected
  join hierarchy_edges edge on edge.parent_id = affected.id
)
update public.locations location
set is_active = false
where location.is_active
  and location.id in (select id from affected_locations);

update public.district_ranges
set valid_to = greatest(clock_timestamp(), valid_from + interval '1 microsecond')
where valid_to is null
  and (
    exists (
      select 1 from public.locations range_location
      where range_location.id = district_ranges.range_id
        and not range_location.is_active
    )
    or exists (
      select 1 from public.locations district_location
      where district_location.id = district_ranges.district_id
        and not district_location.is_active
    )
  );

update public.zone_districts
set valid_to = greatest(clock_timestamp(), valid_from + interval '1 microsecond')
where valid_to is null
  and (
    exists (
      select 1 from public.locations zone_location
      where zone_location.id = zone_districts.zone_id
        and not zone_location.is_active
    )
    or exists (
      select 1 from public.locations district_location
      where district_location.id = zone_districts.district_id
        and not district_location.is_active
    )
  );
