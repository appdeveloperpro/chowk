drop trigger if exists chowk_locations_cascade_deactivation on public.locations;
drop trigger if exists chowk_locations_sync_activation on public.locations;
drop function if exists public.chowk_cascade_location_deactivation();

do $$
declare
  restored_ids bigint[];
begin
  create temporary table location_reactivation_backfill_ids (
    id bigint primary key
  ) on commit drop;

  loop
    with latest_range_mappings as (
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
    eligible_locations(id) as (
      select location.id
      from public.locations location
      where not location.is_active
        and exists (
          select 1
          from hierarchy_edges edge
          join public.locations parent on parent.id = edge.parent_id
          where edge.child_id = location.id and parent.is_active
        )
        and not exists (
          select 1
          from hierarchy_edges edge
          join public.locations parent on parent.id = edge.parent_id
          where edge.child_id = location.id and not parent.is_active
        )
    ),
    restored as (
      update public.locations location
      set is_active = true
      where location.id in (select id from eligible_locations)
      returning location.id
    ),
    recorded as (
      insert into location_reactivation_backfill_ids(id)
      select id from restored
      on conflict (id) do nothing
      returning id
    )
    select coalesce(array_agg(id), '{}'::bigint[])
    into restored_ids
    from recorded;

    exit when cardinality(restored_ids) = 0;
  end loop;

  insert into public.district_ranges(range_id, district_id, assigned_by)
  select latest.range_id, latest.district_id, auth.uid()
  from (
    select distinct on (district_id) range_id, district_id
    from public.district_ranges
    order by district_id, valid_from desc, id desc
  ) latest
  where (
      latest.range_id in (select id from location_reactivation_backfill_ids)
      or latest.district_id in (select id from location_reactivation_backfill_ids)
    )
    and exists (
      select 1 from public.locations
      where id = latest.range_id and is_active
    )
    and exists (
      select 1 from public.locations
      where id = latest.district_id and is_active
    )
    and not exists (
      select 1
      from public.district_ranges current_mapping
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
  where (
      latest.zone_id in (select id from location_reactivation_backfill_ids)
      or latest.district_id in (select id from location_reactivation_backfill_ids)
    )
    and exists (
      select 1 from public.locations
      where id = latest.zone_id and is_active
    )
    and exists (
      select 1 from public.locations
      where id = latest.district_id and is_active
    )
    and not exists (
      select 1
      from public.zone_districts current_mapping
      where current_mapping.district_id = latest.district_id
        and current_mapping.valid_to is null
    )
  on conflict (district_id) where valid_to is null do nothing;
end;
$$;

create function public.chowk_sync_location_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  frontier_ids bigint[];
  restored_ids bigint[];
begin
  if pg_trigger_depth() > 1 or old.is_active is not distinct from new.is_active then
    return new;
  end if;

  if not new.is_active then
    with recursive hierarchy_edges(parent_id, child_id) as (
      select parent_id, id
      from public.locations
      where parent_id is not null
      union
      select range_id, district_id
      from public.district_ranges
      where valid_to is null
      union
      select zone_id, district_id
      from public.zone_districts
      where valid_to is null
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
    update public.locations location
    set is_active = false
    where location.is_active
      and location.id in (select id from affected_locations);

    return new;
  end if;

  frontier_ids := array[new.id];
  restored_ids := array[new.id];

  loop
    with latest_range_mappings as (
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
      where parent_id = any(frontier_ids)
    ),
    restored as (
      update public.locations location
      set is_active = true
      where not location.is_active
        and location.id in (select id from descendants)
      returning location.id
    )
    select coalesce(array_agg(id), '{}'::bigint[])
    into frontier_ids
    from restored;

    exit when cardinality(frontier_ids) = 0;
    restored_ids := restored_ids || frontier_ids;
  end loop;

  insert into public.district_ranges(range_id, district_id, assigned_by)
  select latest.range_id, latest.district_id, auth.uid()
  from (
    select distinct on (district_id) range_id, district_id
    from public.district_ranges
    order by district_id, valid_from desc, id desc
  ) latest
  where (
      latest.range_id = any(restored_ids)
      or latest.district_id = any(restored_ids)
    )
    and exists (
      select 1 from public.locations
      where id = latest.range_id and is_active
    )
    and exists (
      select 1 from public.locations
      where id = latest.district_id and is_active
    )
    and not exists (
      select 1
      from public.district_ranges current_mapping
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
  where (
      latest.zone_id = any(restored_ids)
      or latest.district_id = any(restored_ids)
    )
    and exists (
      select 1 from public.locations
      where id = latest.zone_id and is_active
    )
    and exists (
      select 1 from public.locations
      where id = latest.district_id and is_active
    )
    and not exists (
      select 1
      from public.zone_districts current_mapping
      where current_mapping.district_id = latest.district_id
        and current_mapping.valid_to is null
    )
  on conflict (district_id) where valid_to is null do nothing;

  return new;
end;
$$;

create trigger chowk_locations_sync_activation
after update of is_active on public.locations
for each row
when (old.is_active is distinct from new.is_active)
execute function public.chowk_sync_location_activation();
