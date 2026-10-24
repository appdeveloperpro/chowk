create or replace function public.chowk_reporter_options()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with recursive district_ancestors(
    district_id, id, parent_id, location_type, name, slug, is_active, path
  ) as (
    select location.id, location.id, location.parent_id, location.location_type,
           location.name, location.slug, location.is_active, array[location.id]
    from public.locations location
    where location.location_type = 'district'
    union all
    select ancestors.district_id, parent.id, parent.parent_id, parent.location_type,
           parent.name, parent.slug, parent.is_active, ancestors.path || parent.id
    from district_ancestors ancestors
    join public.locations parent on parent.id = ancestors.parent_id
    where not parent.id = any(ancestors.path)
  ),
  district_hierarchy as (
    select district_id,
           max(id) filter (where location_type = 'region') as region_id,
           max(name) filter (where location_type = 'region') as region_name,
           max(slug) filter (where location_type = 'region') as region_slug,
           max(id) filter (where location_type = 'state') as location_state_id,
           max(name) filter (where location_type = 'state') as location_state_name,
           bool_and(is_active) as hierarchy_active
    from district_ancestors
    group by district_id
  )
  select jsonb_build_object(
    'states', coalesce((
      select jsonb_agg(to_jsonb(state) order by state.state_name)
      from public.states state
      where state.is_active
        and exists (
          select 1
          from public.locations location_state
          join public.locations region
            on region.parent_id = location_state.id
           and region.location_type = 'region'
           and region.is_active
           and region.slug not like 'unassigned-region-%'
          where location_state.location_type = 'state'
            and location_state.is_active
            and lower(btrim(location_state.name)) = lower(btrim(state.state_name))
        )
    ), '[]'::jsonb),
    'regions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', region.id,
        'state_id', state.id,
        'name', region.name
      ) order by region.name)
      from public.locations region
      join public.locations location_state
        on location_state.id = region.parent_id
       and location_state.location_type = 'state'
       and location_state.is_active
      join public.states state
        on lower(btrim(state.state_name)) = lower(btrim(location_state.name))
       and state.is_active
      where region.location_type = 'region'
        and region.is_active
        and region.slug not like 'unassigned-region-%'
    ), '[]'::jsonb),
    'rtos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', office.id,
        'state_id', office.state_id,
        'region_id', hierarchy.region_id,
        'region_name', hierarchy.region_name,
        'district_id', district.id,
        'district_name', district.name,
        'rto_code', office.rto_code,
        'city_name', office.city_name
      ) order by district.name, office.rto_code)
      from public.rto_offices office
      join public.states state
        on state.id = office.state_id
       and state.is_active
      join public.locations district
        on district.id = office.location_id
       and district.location_type = 'district'
      join district_hierarchy hierarchy
        on hierarchy.district_id = district.id
       and hierarchy.hierarchy_active
       and hierarchy.region_id is not null
       and hierarchy.location_state_id is not null
       and hierarchy.region_name is not null
       and hierarchy.region_slug not like 'unassigned-region-%'
       and lower(btrim(hierarchy.location_state_name)) = lower(btrim(state.state_name))
      where office.is_active
        and office.location_id is not null
    ), '[]'::jsonb),
    'types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', type.id, 'type_code', type.type_code, 'name', type.name, 'description', type.description
      ) order by type.name)
      from public.reporter_types type
      where type.is_active
    ), '[]'::jsonb),
    'agreement', (
      select jsonb_build_object(
        'version', agreement.version,
        'sha256', agreement.sha256,
        'document_url', agreement.document_url
      )
      from public.reporter_agreement_versions agreement
      where agreement.status = 'published'
      limit 1
    ),
    'service_agreement', (
      select jsonb_build_object(
        'version', agreement.version,
        'sha256', agreement.sha256,
        'document_url', agreement.document_url
      )
      from public.reporter_service_agreement_versions agreement
      where agreement.status = 'published'
      limit 1
    )
  );
$$;

revoke all on function public.chowk_reporter_options() from public, authenticated;
grant execute on function public.chowk_reporter_options() to anon, authenticated;

create or replace function public.chowk_validate_reporter_location(
  target_state bigint,
  target_region bigint,
  target_rto bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  location_record record;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  with recursive ancestors(id, parent_id, location_type, name, slug, is_active, path) as (
    select district.id, district.parent_id, district.location_type, district.name,
           district.slug, district.is_active, array[district.id]
    from public.rto_offices office
    join public.locations district on district.id = office.location_id
    where office.id = target_rto
      and office.state_id = target_state
      and office.is_active
      and district.location_type = 'district'
    union all
    select parent.id, parent.parent_id, parent.location_type, parent.name,
           parent.slug, parent.is_active, ancestors.path || parent.id
    from ancestors
    join public.locations parent on parent.id = ancestors.parent_id
    where not parent.id = any(ancestors.path)
  )
  select max(id) filter (where location_type = 'region') as region_id,
         max(name) filter (where location_type = 'region') as region_name,
         max(slug) filter (where location_type = 'region') as region_slug,
         max(name) filter (where location_type = 'state') as state_name,
         bool_and(is_active) as hierarchy_active
  into location_record
  from ancestors;

  if not found
     or location_record.region_id is null
     or location_record.region_id <> target_region
     or location_record.region_slug like 'unassigned-region-%'
     or not coalesce(location_record.hierarchy_active, false)
     or not exists (
       select 1
       from public.states state
       where state.id = target_state
         and state.is_active
         and lower(btrim(state.state_name)) = lower(btrim(location_record.state_name))
     ) then
    raise exception 'Choose an active District within the selected Region and State'
      using errcode = '23514';
  end if;

  return true;
end;
$$;

revoke all on function public.chowk_validate_reporter_location(bigint, bigint, bigint) from public, anon;
grant execute on function public.chowk_validate_reporter_location(bigint, bigint, bigint) to authenticated;

create or replace function public.chowk_validate_reporter_application_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_region_id bigint;
begin
  select actual_region.id
  into selected_region_id
  from public.rto_offices office
  join public.locations district
    on district.id = office.location_id
   and district.location_type = 'district'
  join public.locations range_location
    on range_location.id = district.parent_id
   and range_location.location_type = 'range'
  join public.locations zone
    on zone.id = range_location.parent_id
   and zone.location_type = 'zone'
  join public.locations actual_region
    on actual_region.id = zone.parent_id
   and actual_region.location_type = 'region'
  where office.id = new.rto_office_id;

  if selected_region_id is null then
    raise exception 'The selected RTO must belong to a managed District and Region'
      using errcode = '23514';
  end if;

  perform public.chowk_validate_reporter_location(
    new.state_id,
    selected_region_id,
    new.rto_office_id
  );
  return new;
end;
$$;

drop trigger if exists chowk_reporter_application_location_check on public.reporter_applications;
create trigger chowk_reporter_application_location_check
before insert or update of state_id, rto_office_id on public.reporter_applications
for each row execute function public.chowk_validate_reporter_application_location();
