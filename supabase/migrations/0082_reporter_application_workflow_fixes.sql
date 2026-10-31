begin;

create or replace function public.chowk_reporter_coverage_area_within_district(
  target_coverage_area bigint,
  target_district bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive ancestors(id, parent_id, location_type, is_active, visited) as (
    select location.id, location.parent_id, location.location_type, location.is_active,
           array[location.id]
    from public.locations location
    where location.id = target_coverage_area
    union all
    select parent.id, parent.parent_id, parent.location_type, parent.is_active,
           ancestors.visited || parent.id
    from ancestors
    join public.locations parent on parent.id = ancestors.parent_id
    where not parent.id = any(ancestors.visited)
  )
  select coalesce(
    bool_and(ancestors.is_active)
      and bool_or(ancestors.id = target_coverage_area
        and ancestors.location_type = 'coverage_area')
      and bool_or(ancestors.id = target_district
        and ancestors.location_type = 'district'),
    false
  )
  from ancestors;
$$;

revoke all on function public.chowk_reporter_coverage_area_within_district(bigint, bigint)
  from public, anon, authenticated;

create or replace function public.chowk_reporter_coverage_area_options()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with recursive ancestors(
    area_id, id, parent_id, location_type, name, depth, is_active, visited
  ) as (
    select area.id, area.id, area.parent_id, area.location_type, area.name,
           0, area.is_active, array[area.id]
    from public.locations area
    where area.location_type = 'coverage_area' and area.is_active
    union all
    select ancestors.area_id, parent.id, parent.parent_id, parent.location_type,
           parent.name, ancestors.depth + 1,
           ancestors.is_active and parent.is_active,
           ancestors.visited || parent.id
    from ancestors
    join public.locations parent on parent.id = ancestors.parent_id
    where not parent.id = any(ancestors.visited)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', area.id,
    'name', area.name,
    'parent_id', area.parent_id,
    'district_id', district.id,
    'path', (
      select string_agg(path.name, ' · ' order by path.depth desc)
      from ancestors path
      where path.area_id = area.id and path.depth <= district.depth
    )
  ) order by area.name), '[]'::jsonb)
  from public.locations area
  join lateral (
    select path.id, path.depth
    from ancestors path
    where path.area_id = area.id
      and path.location_type = 'district'
      and path.is_active
    order by path.depth
    limit 1
  ) district on true
  where area.location_type = 'coverage_area' and area.is_active;
$$;

revoke all on function public.chowk_reporter_coverage_area_options()
  from public;
grant execute on function public.chowk_reporter_coverage_area_options()
  to anon, authenticated;

do $$
declare
  function_definition text;
  replacement_condition constant text :=
    'public.chowk_reporter_coverage_area_within_district(coverage_area.id, office.location_id)';
begin
  function_definition := pg_get_functiondef(
    'public.chowk_submit_reporter_application_with_private_details(bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb)'::regprocedure
  );
  if position('office.location_id = coverage_area.parent_id' in function_definition) = 0 then
    raise exception 'Reporter application submission validation could not be updated';
  end if;
  execute replace(
    function_definition,
    'office.location_id = coverage_area.parent_id',
    replacement_condition
  );

  function_definition := pg_get_functiondef(
    'public.chowk_resubmit_reporter_application_base_0038(bigint,bigint,bigint,jsonb,jsonb)'::regprocedure
  );
  if position('coverage_area.parent_id = office.location_id' in function_definition) = 0 then
    raise exception 'Reporter application resubmission validation could not be updated';
  end if;
  execute replace(
    function_definition,
    'coverage_area.parent_id = office.location_id',
    replacement_condition
  );
end;
$$;

commit;
