create or replace function public.chowk_validate_location_hierarchy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_type text;
  parent_active boolean;
begin
  if tg_op='UPDATE' and (
    new.parent_id is distinct from old.parent_id
    or new.location_type is distinct from old.location_type
  ) and exists (
    select 1 from public.district_ranges mapping
    where mapping.valid_to is null
      and (mapping.range_id=new.id or mapping.district_id=new.id)
  ) then
    raise exception 'End active district/range mappings before changing the location hierarchy' using errcode='23514';
  end if;
  if new.parent_id is null then
    if new.location_type <> 'state' then
      raise exception 'Only a state can be a top-level location' using errcode='23514';
    end if;
    return new;
  end if;
  if new.parent_id=new.id then
    raise exception 'A location cannot be its own parent' using errcode='23514';
  end if;
  select location_type,is_active into parent_type,parent_active
  from public.locations
  where id=new.parent_id;
  if parent_type is null then
    raise exception 'Choose an existing parent location' using errcode='23514';
  end if;
  if new.is_active and not parent_active then
    raise exception 'Activate the parent location before activating this location' using errcode='23514';
  end if;
  if not (
    (new.location_type='zone' and parent_type='state')
    or (new.location_type='district' and parent_type in ('state','zone'))
    or (new.location_type='range' and parent_type='zone')
    or (new.location_type='city' and parent_type='district')
    or (new.location_type='coverage_area' and parent_type in ('district','city'))
  ) then
    raise exception 'The selected parent location has an invalid hierarchy level' using errcode='23514';
  end if;
  if tg_op='UPDATE' and exists (
    with recursive descendants(id,visited) as (
      select old.id,array[old.id]
      union all
      select child.id,descendants.visited || child.id
      from descendants
      join public.locations child on child.parent_id=descendants.id
      where not child.id=any(descendants.visited)
    )
    select 1 from descendants where id=new.parent_id
  ) then
    raise exception 'A location cannot be moved beneath one of its descendants' using errcode='23514';
  end if;
  return new;
end;
$$;

create or replace function public.chowk_cascade_location_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  with recursive hierarchy_edges(parent_id,child_id) as (
    select parent_id,id
    from public.locations
    where parent_id is not null
    union
    select range_id,district_id
    from public.district_ranges
    where valid_to is null
    union
    select zone_id,district_id
    from public.zone_districts
    where valid_to is null
  ),
  affected_locations(id) as (
    select child_id
    from hierarchy_edges
    where parent_id=new.id
    union
    select hierarchy_edges.child_id
    from affected_locations
    join hierarchy_edges on hierarchy_edges.parent_id=affected_locations.id
  )
  update public.locations location
  set is_active=false
  where location.is_active
    and location.id in (select id from affected_locations);

  update public.district_ranges mapping
  set valid_to=greatest(clock_timestamp(),mapping.valid_from + interval '1 microsecond')
  where mapping.valid_to is null
    and (
      exists (
        select 1 from public.locations range_location
        where range_location.id=mapping.range_id and not range_location.is_active
      )
      or exists (
        select 1 from public.locations district_location
        where district_location.id=mapping.district_id and not district_location.is_active
      )
    );

  update public.zone_districts mapping
  set valid_to=greatest(clock_timestamp(),mapping.valid_from + interval '1 microsecond')
  where mapping.valid_to is null
    and (
      exists (
        select 1 from public.locations zone_location
        where zone_location.id=mapping.zone_id and not zone_location.is_active
      )
      or exists (
        select 1 from public.locations district_location
        where district_location.id=mapping.district_id and not district_location.is_active
      )
    );

  return new;
end;
$$;

with recursive hierarchy_edges(parent_id,child_id) as (
  select parent_id,id
  from public.locations
  where parent_id is not null
  union
  select range_id,district_id
  from public.district_ranges
  where valid_to is null
  union
  select zone_id,district_id
  from public.zone_districts
  where valid_to is null
),
affected_locations(id) as (
  select child.child_id
  from public.locations parent
  join hierarchy_edges child on child.parent_id=parent.id
  where not parent.is_active
  union
  select hierarchy_edges.child_id
  from affected_locations
  join hierarchy_edges on hierarchy_edges.parent_id=affected_locations.id
)
update public.locations location
set is_active=false
where location.is_active
  and location.id in (select id from affected_locations);

update public.district_ranges mapping
set valid_to=greatest(clock_timestamp(),mapping.valid_from + interval '1 microsecond')
where mapping.valid_to is null
  and (
    exists (
      select 1 from public.locations range_location
      where range_location.id=mapping.range_id and not range_location.is_active
    )
    or exists (
      select 1 from public.locations district_location
      where district_location.id=mapping.district_id and not district_location.is_active
    )
  );

update public.zone_districts mapping
set valid_to=greatest(clock_timestamp(),mapping.valid_from + interval '1 microsecond')
where mapping.valid_to is null
  and (
    exists (
      select 1 from public.locations zone_location
      where zone_location.id=mapping.zone_id and not zone_location.is_active
    )
    or exists (
      select 1 from public.locations district_location
      where district_location.id=mapping.district_id and not district_location.is_active
    )
  );

drop trigger if exists chowk_locations_cascade_deactivation on public.locations;
create trigger chowk_locations_cascade_deactivation
after update of is_active on public.locations
for each row
when (old.is_active and not new.is_active)
execute function public.chowk_cascade_location_deactivation();
