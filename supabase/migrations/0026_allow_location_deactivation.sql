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
  if tg_op = 'UPDATE'
     and new.range_id is not distinct from old.range_id
     and new.district_id is not distinct from old.district_id
     and new.valid_from is not distinct from old.valid_from
     and new.assigned_by is not distinct from old.assigned_by
     and new.created_at is not distinct from old.created_at
     and old.valid_to is null
     and new.valid_to is not null then
    if not exists (
      select 1
      from public.locations range_location
      where range_location.id = new.range_id
        and range_location.location_type = 'range'
    ) then
      raise exception 'The range history must reference an existing range' using errcode = '23514';
    end if;
    if not exists (
      select 1
      from public.locations district_location
      where district_location.id = new.district_id
        and district_location.location_type = 'district'
    ) then
      raise exception 'The range history must reference an existing district' using errcode = '23514';
    end if;
    return new;
  end if;

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

  if tg_op = 'UPDATE'
     and (new.district_id is distinct from old.district_id
       or new.range_id is distinct from old.range_id) then
    raise exception 'A district/range history row cannot be moved to another location'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
     and (new.valid_from is distinct from old.valid_from
       or (old.valid_to is not null and new.valid_to is distinct from old.valid_to)) then
    raise exception 'District/range mapping history cannot be rewritten'
      using errcode = '23514';
  end if;

  return new;
end;
$$;
