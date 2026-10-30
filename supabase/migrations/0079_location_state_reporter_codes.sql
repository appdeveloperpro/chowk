begin;

alter table public.locations
  add column state_code text;

alter table public.states
  add column location_id bigint;

do $$
declare
  duplicate_codes text;
  conflicting_slugs text;
begin
  select string_agg(format('%s (%s)', state_code, state_names), '; ')
  into duplicate_codes
  from (
    select upper(btrim(state_code)) as state_code,
           string_agg(state_name, ', ' order by state_name) as state_names
    from public.states
    group by upper(btrim(state_code))
    having count(*) > 1
    order by upper(btrim(state_code))
    limit 25
  ) duplicated;

  if duplicate_codes is not null then
    raise exception 'Reporter State codes must be unique before creating missing Location States.'
      using detail = duplicate_codes;
  end if;

  select string_agg(format('%s (slug %s)', state.state_name, expected.slug), '; ')
  into conflicting_slugs
  from public.states state
  cross join lateral (
    select 'reporter-state-' || lower(btrim(state.state_code)) as slug
  ) expected
  join public.locations existing on existing.slug = expected.slug
  where not exists (
    select 1
    from public.locations location
    where location.location_type = 'state'
      and lower(btrim(location.name)) = lower(btrim(state.state_name))
  );

  if conflicting_slugs is not null then
    raise exception 'A generated Location slug for a missing reporter State is already in use.'
      using detail = conflicting_slugs;
  end if;
end;
$$;

insert into public.locations(name, slug, location_type, state_code, is_active)
select state.state_name,
       'reporter-state-' || lower(btrim(state.state_code)),
       'state',
       upper(btrim(state.state_code)),
       state.is_active
from public.states state
where not exists (
  select 1
  from public.locations location
  where location.location_type = 'state'
    and lower(btrim(location.name)) = lower(btrim(state.state_name))
)
order by state.state_name;

do $$
declare
  unmatched_states text;
  unmatched_locations text;
  duplicate_codes text;
begin
  select string_agg(format('%s (%s matches)', state_name, match_count), ', ')
  into unmatched_states
  from (
    select state.state_name, count(location.id) as match_count
    from public.states state
    left join public.locations location
      on location.location_type = 'state'
     and lower(btrim(location.name)) = lower(btrim(state.state_name))
    group by state.id, state.state_name
    having count(location.id) <> 1
    order by state.state_name
    limit 25
  ) unmatched;

  select string_agg(format('%s (%s matches)', location_name, match_count), ', ')
  into unmatched_locations
  from (
    select location.name as location_name, count(state.id) as match_count
    from public.locations location
    left join public.states state
      on lower(btrim(state.state_name)) = lower(btrim(location.name))
    where location.location_type = 'state'
    group by location.id, location.name
    having count(state.id) <> 1
    order by location.name
    limit 25
  ) unmatched;

  select string_agg(format('%s: %s', state_code, state_names), '; ')
  into duplicate_codes
  from (
    select upper(btrim(state_code)) as state_code,
           string_agg(state_name, ', ' order by state_name) as state_names
    from public.states
    group by upper(btrim(state_code))
    having count(*) > 1
    order by upper(btrim(state_code))
    limit 25
  ) duplicated;

  if unmatched_states is not null
      or unmatched_locations is not null
      or duplicate_codes is not null then
    raise exception 'Reporter state codes could not be linked safely to Locations.'
      using detail = format(
        'Legacy state rows without exactly one matching Location state: %s. Location states without exactly one legacy state row: %s. Duplicate state codes ignoring case: %s. Resolve these records, then retry.',
        coalesce(unmatched_states, 'none'),
        coalesce(unmatched_locations, 'none'),
        coalesce(duplicate_codes, 'none')
      );
  end if;
end;
$$;

update public.states state
set location_id = location.id,
    state_code = upper(btrim(state.state_code)),
    state_name = location.name,
    updated_at = now()
from public.locations location
where location.location_type = 'state'
  and lower(btrim(location.name)) = lower(btrim(state.state_name));

update public.locations location
set state_code = upper(btrim(state.state_code))
from public.states state
where state.location_id = location.id;

alter table public.states
  alter column location_id set not null;

alter table public.locations
  add constraint locations_state_code_by_type_check
  check (
    (location_type = 'state' and state_code is not null and state_code ~ '^[A-Z0-9]{2}$')
    or (location_type <> 'state' and state_code is null)
  );

create unique index locations_state_code_unique_idx
  on public.locations (state_code)
  where location_type = 'state';

alter table public.states
  add constraint states_location_id_fkey
  foreign key (location_id) references public.locations(id) on delete restrict,
  add constraint states_location_id_key unique (location_id);

drop policy if exists "Admins manage states" on public.states;
drop policy if exists "Admins manage RTOs" on public.rto_offices;
revoke insert, update, delete on table public.states, public.rto_offices from authenticated;

create or replace function public.chowk_normalize_location_state_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.location_type = 'state' then
    new.state_code := upper(btrim(new.state_code));
  elsif new.state_code is not null then
    raise exception 'Reporter state codes can only be set on State locations'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger chowk_locations_normalize_state_code
before insert or update of location_type, state_code on public.locations
for each row execute function public.chowk_normalize_location_state_code();

create or replace function public.chowk_sync_location_reporter_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.location_type = 'state' then
    insert into public.states (location_id, state_code, state_name, is_active)
    values (new.id, new.state_code, new.name, new.is_active)
    on conflict (location_id) do update
      set state_code = excluded.state_code,
          state_name = excluded.state_name,
          is_active = excluded.is_active,
          updated_at = now();
  else
    if tg_op = 'UPDATE' then
      if old.location_type = 'state' then
        raise exception 'A State location linked to reporter IDs cannot be changed to another location level'
          using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger chowk_locations_sync_reporter_state
after insert or update of name, location_type, state_code, is_active on public.locations
for each row execute function public.chowk_sync_location_reporter_state();

commit;
