create or replace function public.chowk_require_district_rto_code()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  state_record record;
  normalized_rto_code text;
begin
  if new.location_type = 'district' and new.rto_code is null then
    if tg_op = 'INSERT' or old.location_type is distinct from 'district' then
      raise exception 'Enter an RTO code when creating a District'
        using errcode = '23514';
    end if;
  end if;

  if new.location_type = 'district' and new.rto_code is not null then
    with recursive ancestors(id, parent_id, location_type, name, path) as (
      select parent.id, parent.parent_id, parent.location_type, parent.name, array[new.id, parent.id]
      from public.locations parent
      where parent.id = new.parent_id
      union all
      select parent.id, parent.parent_id, parent.location_type, parent.name, ancestors.path || parent.id
      from ancestors
      join public.locations parent on parent.id = ancestors.parent_id
      where not parent.id = any(ancestors.path)
    )
    select state.id, state.state_code
    into state_record
    from ancestors location_state
    join public.states state
      on lower(btrim(state.state_name)) = lower(btrim(location_state.name))
    where location_state.location_type = 'state'
    limit 1;

    if state_record.id is null then
      raise exception 'The District must belong to a State before its RTO code can be saved'
        using errcode = '23514';
    end if;

    normalized_rto_code := upper(btrim(new.rto_code));
    if left(normalized_rto_code, length(state_record.state_code)) = upper(state_record.state_code)
       and length(normalized_rto_code) - length(state_record.state_code) between 2 and 8 then
      normalized_rto_code := substr(normalized_rto_code, length(state_record.state_code) + 1);
    end if;
    if normalized_rto_code !~ '^[A-Z0-9]{2,8}$' then
      raise exception 'Enter a valid RTO code without the State prefix'
        using errcode = '23514';
    end if;
    new.rto_code := normalized_rto_code;
  end if;

  return new;
end;
$$;

create or replace function public.chowk_sync_district_rto_office()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  state_record record;
  normalized_rto_code text;
begin
  if tg_op = 'UPDATE' then
    if old.location_type in ('region', 'zone', 'range')
       and new.parent_id is distinct from old.parent_id then
      with recursive descendants(id, location_type, parent_id, visited) as (
        select child.id, child.location_type, child.parent_id, array[new.id, child.id]
        from public.locations child
        where child.parent_id = new.id
        union all
        select child.id, child.location_type, child.parent_id, descendants.visited || child.id
        from descendants
        join public.locations child on child.parent_id = descendants.id
        where not child.id = any(descendants.visited)
      )
      update public.locations district
      set rto_code = district.rto_code
      from descendants
      where descendants.id = district.id
        and descendants.location_type = 'district'
        and district.rto_code is not null;
      return new;
    end if;
  end if;

  if new.location_type <> 'district' or new.rto_code is null then
    if tg_op = 'UPDATE' and old.location_type = 'district' and old.rto_code is not null then
      update public.rto_offices
      set is_active = false, location_id = null
      where location_id = old.id;
    end if;
    return new;
  end if;

  with recursive ancestors(id, parent_id, location_type, name, path) as (
    select parent.id, parent.parent_id, parent.location_type, parent.name, array[new.id, parent.id]
    from public.locations parent
    where parent.id = new.parent_id
    union all
    select parent.id, parent.parent_id, parent.location_type, parent.name, ancestors.path || parent.id
    from ancestors
    join public.locations parent on parent.id = ancestors.parent_id
    where not parent.id = any(ancestors.path)
  )
  select state.id, state.state_code
  into state_record
  from ancestors location_state
  join public.states state
    on lower(btrim(state.state_name)) = lower(btrim(location_state.name))
  where location_state.location_type = 'state'
  limit 1;

  if state_record.id is null then
    raise exception 'The District must belong to a State record before its RTO code can be saved'
      using errcode = '23514';
  end if;

  normalized_rto_code := upper(btrim(new.rto_code));
  if left(normalized_rto_code, length(state_record.state_code)) = upper(state_record.state_code)
     and length(normalized_rto_code) - length(state_record.state_code) between 2 and 8 then
    normalized_rto_code := substr(normalized_rto_code, length(state_record.state_code) + 1);
  end if;

  if normalized_rto_code !~ '^[A-Z0-9]{2,8}$' then
    raise exception 'Enter a valid RTO code without the State prefix'
      using errcode = '23514';
  end if;

  update public.rto_offices office
  set is_active = false, location_id = null
  where office.location_id = new.id
    and (office.state_id <> state_record.id or office.rto_code <> normalized_rto_code);

  if exists (
    select 1
    from public.rto_offices office
    where office.state_id = state_record.id
      and office.rto_code = normalized_rto_code
      and office.location_id is not null
      and office.location_id <> new.id
  ) then
    raise exception 'This RTO code is already assigned to another District in the same State'
      using errcode = '23505';
  end if;

  insert into public.rto_offices(state_id, rto_code, city_name, is_active, location_id)
  values (state_record.id, normalized_rto_code, new.name, new.is_active, new.id)
  on conflict (state_id, rto_code) do update
    set city_name = excluded.city_name,
        is_active = excluded.is_active,
        location_id = excluded.location_id;

  return new;
end;
$$;

do $$
declare
  district_record record;
  canonical_office_id bigint;
  old_office record;
begin
  for district_record in
    with recursive district_ancestors(district_id, id, parent_id, location_type, name, path) as (
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
    )
    select district.id as district_id,
           district.name as district_name,
           district.rto_code,
           district.is_active as district_active,
           state.id as state_id,
           state.state_code,
           coalesce(
             case
               when left(upper(btrim(district.rto_code)), length(state.state_code)) = upper(state.state_code)
                 then substr(upper(btrim(district.rto_code)), length(state.state_code) + 1)
               else upper(btrim(district.rto_code))
             end,
             (
               select min(candidate.normalized_code)
               from (
                 select distinct case
                   when left(upper(btrim(office.rto_code)), length(state.state_code)) = upper(state.state_code)
                     then substr(upper(btrim(office.rto_code)), length(state.state_code) + 1)
                   else upper(btrim(office.rto_code))
                 end as normalized_code
                 from public.rto_offices office
                 where (office.state_id = state.id or office.location_id = district.id)
                   and lower(btrim(office.city_name)) = lower(btrim(district.name))
                   and office.is_active
               ) candidate
               having count(*) = 1
             )
           ) as normalized_rto_code
    from public.locations district
    join district_ancestors hierarchy on hierarchy.district_id = district.id
    join public.locations location_state
      on location_state.id = hierarchy.id
     and hierarchy.location_type = 'state'
    join public.states state
      on lower(btrim(state.state_name)) = lower(btrim(location_state.name))
    where district.location_type = 'district'
      and (
        district.rto_code is not null
        or exists (
          select 1 from public.rto_offices office
          where office.location_id = district.id
        )
        or exists (
          select 1 from public.rto_offices office
          where office.state_id = state.id
            and lower(btrim(office.city_name)) = lower(btrim(district.name))
            and office.is_active
        )
      )
    order by district.id
  loop
    if district_record.normalized_rto_code is null
       or district_record.normalized_rto_code !~ '^[A-Z0-9]{2,8}$' then
      raise exception 'Could not safely resolve the RTO code for District %', district_record.district_name
        using errcode = '23514';
    end if;

    if exists (
      select 1
      from public.rto_offices office
      where office.state_id = district_record.state_id
        and office.rto_code = district_record.normalized_rto_code
        and office.location_id is not null
        and office.location_id <> district_record.district_id
    ) then
      raise exception 'RTO code % is already linked to another District in State %',
        district_record.normalized_rto_code, district_record.state_id
        using errcode = '23505';
    end if;

    insert into public.rto_offices(state_id, rto_code, city_name, is_active, location_id)
    values (
      district_record.state_id,
      district_record.normalized_rto_code,
      district_record.district_name,
      district_record.district_active,
      null
    )
    on conflict (state_id, rto_code) do update
      set city_name = excluded.city_name,
          is_active = excluded.is_active
    returning id into canonical_office_id;

    for old_office in
      select id
      from public.rto_offices
      where location_id = district_record.district_id
        and id <> canonical_office_id
    loop
      insert into public.reporter_code_counters(rto_office_id, reporter_type_id, next_number)
      select canonical_office_id, reporter_type_id, next_number
      from public.reporter_code_counters
      where rto_office_id = old_office.id
      on conflict (rto_office_id, reporter_type_id) do update
        set next_number = greatest(
          public.reporter_code_counters.next_number,
          excluded.next_number
        );

      delete from public.reporter_code_counters
      where rto_office_id = old_office.id;

      update public.reporter_applications
      set state_id = district_record.state_id,
          rto_office_id = canonical_office_id
      where rto_office_id = old_office.id;

      update public.reporter_assignments
      set rto_office_id = canonical_office_id
      where rto_office_id = old_office.id;

      update public.rto_offices
      set is_active = false,
          location_id = null
      where id = old_office.id;
    end loop;

    update public.rto_offices
    set city_name = district_record.district_name,
        is_active = district_record.district_active,
        location_id = district_record.district_id
    where id = canonical_office_id;

    update public.locations
    set rto_code = district_record.normalized_rto_code
    where id = district_record.district_id
      and rto_code is distinct from district_record.normalized_rto_code;
  end loop;
end;
$$;
