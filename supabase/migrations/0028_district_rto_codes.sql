alter table public.locations
  add column if not exists rto_code text;

alter table public.locations
  drop constraint if exists locations_rto_code_check;

alter table public.locations
  add constraint locations_rto_code_check
  check (
    rto_code is null
    or (location_type = 'district' and rto_code ~ '^[A-Za-z0-9]{2,8}$')
  );

alter table public.rto_offices
  add column if not exists location_id bigint references public.locations(id) on delete set null;

create unique index if not exists rto_offices_location_id_unique_idx
  on public.rto_offices(location_id)
  where location_id is not null;

create or replace function public.chowk_require_district_rto_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.location_type = 'district' and new.rto_code is null then
    if tg_op = 'INSERT' then
      raise exception 'Enter an RTO code when creating a District' using errcode = '23514';
    elsif old.location_type is distinct from 'district' then
      raise exception 'Enter an RTO code when creating a District' using errcode = '23514';
    end if;
  end if;
  if new.location_type = 'district' and new.rto_code is not null then
    new.rto_code := upper(new.rto_code);
  end if;
  return new;
end;
$$;

drop trigger if exists chowk_locations_require_district_rto_code on public.locations;
create trigger chowk_locations_require_district_rto_code
before insert or update of location_type, rto_code on public.locations
for each row execute function public.chowk_require_district_rto_code();

create or replace function public.chowk_sync_district_rto_office()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  state_id_value bigint;
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
    if tg_op = 'UPDATE' then
      if old.location_type = 'district' and old.rto_code is not null then
        update public.rto_offices
        set is_active = false, location_id = null
        where location_id = old.id;
      end if;
    end if;
    return new;
  end if;

  with recursive ancestors(id, parent_id, location_type, visited) as (
    select parent.id, parent.parent_id, parent.location_type, array[new.id, parent.id]
    from public.locations parent
    where parent.id = new.parent_id
    union all
    select parent.id, parent.parent_id, parent.location_type, ancestors.visited || parent.id
    from ancestors
    join public.locations parent on parent.id = ancestors.parent_id
    where not parent.id = any(ancestors.visited)
  )
  select id into state_id_value
  from ancestors
  where location_type = 'state'
  limit 1;

  if state_id_value is null then
    raise exception 'The District must belong to a State before its RTO code can be saved'
      using errcode = '23514';
  end if;

  update public.rto_offices office
  set is_active = false, location_id = null
  where office.location_id = new.id
    and (office.state_id <> state_id_value or office.rto_code <> upper(new.rto_code));

  if exists (
    select 1
    from public.rto_offices office
    where office.state_id = state_id_value
      and office.rto_code = upper(new.rto_code)
      and office.location_id is not null
      and office.location_id <> new.id
  ) then
    raise exception 'This RTO code is already assigned to another District in the same State'
      using errcode = '23505';
  end if;

  insert into public.rto_offices(state_id, rto_code, city_name, is_active, location_id)
  values (state_id_value, upper(new.rto_code), new.name, new.is_active, new.id)
  on conflict (state_id, rto_code) do update
    set city_name = excluded.city_name,
        is_active = excluded.is_active,
        location_id = excluded.location_id;

  return new;
end;
$$;

drop trigger if exists chowk_locations_sync_district_rto_office on public.locations;
create trigger chowk_locations_sync_district_rto_office
after insert or update of name, location_type, rto_code, parent_id, is_active on public.locations
for each row execute function public.chowk_sync_district_rto_office();
