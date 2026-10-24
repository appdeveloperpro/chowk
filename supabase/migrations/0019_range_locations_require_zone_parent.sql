create or replace function public.chowk_validate_location_hierarchy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_type text;
begin
  if new.parent_id is null then
    if new.location_type <> 'state' then
      raise exception 'Only a state can be a top-level location' using errcode='23514';
    end if;
    return new;
  end if;
  if new.parent_id=new.id then
    raise exception 'A location cannot be its own parent' using errcode='23514';
  end if;
  select location_type into parent_type
  from public.locations
  where id=new.parent_id and is_active;
  if parent_type is null then
    raise exception 'Choose an active parent location' using errcode='23514';
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
