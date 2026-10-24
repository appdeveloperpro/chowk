with recursive district_ancestors(
  district_id, id, parent_id, location_type, name, path
) as (
  select district.id, district.id, district.parent_id, district.location_type,
         district.name, array[district.id]
  from public.locations district
  where district.location_type = 'district'
  union all
  select ancestors.district_id, parent.id, parent.parent_id, parent.location_type,
         parent.name, ancestors.path || parent.id
  from district_ancestors ancestors
  join public.locations parent on parent.id = ancestors.parent_id
  where not parent.id = any(ancestors.path)
),
district_states as (
  select district_id,
         max(id) filter (where location_type = 'state') as location_state_id,
         max(name) filter (where location_type = 'state') as location_state_name
  from district_ancestors
  group by district_id
),
candidate_links as (
  select district.id as district_id,
         office.rto_code,
         count(*) over (partition by district.id) as office_match_count,
         count(*) over (partition by office.id) as district_match_count
  from public.locations district
  join district_states hierarchy on hierarchy.district_id = district.id
  join public.states state
    on state.is_active
   and state.id = hierarchy.location_state_id
   and lower(btrim(state.state_name)) = lower(btrim(hierarchy.location_state_name))
  join public.rto_offices office
    on office.state_id = state.id
   and office.is_active
   and lower(btrim(office.city_name)) = lower(btrim(district.name))
   and (office.location_id is null or office.location_id = district.id)
  where district.location_type = 'district'
    and district.rto_code is null
)
update public.locations district
set rto_code = candidate.rto_code
from candidate_links candidate
where district.id = candidate.district_id
  and candidate.office_match_count = 1
  and candidate.district_match_count = 1;

with recursive district_ancestors(
  district_id, id, parent_id, location_type, name, path
) as (
  select district.id, district.id, district.parent_id, district.location_type,
         district.name, array[district.id]
  from public.locations district
  where district.location_type = 'district'
  union all
  select ancestors.district_id, parent.id, parent.parent_id, parent.location_type,
         parent.name, ancestors.path || parent.id
  from district_ancestors ancestors
  join public.locations parent on parent.id = ancestors.parent_id
  where not parent.id = any(ancestors.path)
),
district_states as (
  select district_id,
         max(id) filter (where location_type = 'state') as location_state_id,
         max(name) filter (where location_type = 'state') as location_state_name
  from district_ancestors
  group by district_id
),
eligible_districts as (
  select district.id
  from public.locations district
  join district_states hierarchy on hierarchy.district_id = district.id
  join public.states state
    on state.id = hierarchy.location_state_id
   and lower(btrim(state.state_name)) = lower(btrim(hierarchy.location_state_name))
  where district.location_type = 'district'
    and district.rto_code is not null
    and not exists (
      select 1
      from public.rto_offices linked_office
      where linked_office.location_id = district.id
        and linked_office.state_id = state.id
        and linked_office.rto_code = upper(district.rto_code)
    )
    and not exists (
      select 1
      from public.rto_offices office
      where office.state_id = state.id
        and office.rto_code = upper(district.rto_code)
        and office.location_id is not null
        and office.location_id <> district.id
    )
)
update public.locations district
set rto_code = upper(district.rto_code)
from eligible_districts eligible
where district.id = eligible.id;
