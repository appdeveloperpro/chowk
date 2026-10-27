alter table public.reporter_application_private_details
  add column if not exists coverage_area_id bigint,
  add column if not exists mobile_number text,
  add column if not exists date_of_birth date,
  add column if not exists age_at_application smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reporter_application_private_details'::regclass
      and conname = 'reporter_application_private_details_coverage_area_id_fkey'
  ) then
    alter table public.reporter_application_private_details
      add constraint reporter_application_private_details_coverage_area_id_fkey
      foreign key (coverage_area_id) references public.locations(id)
      on delete restrict not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reporter_application_private_details'::regclass
      and conname = 'reporter_application_mobile_number_check'
  ) then
    alter table public.reporter_application_private_details
      add constraint reporter_application_mobile_number_check
      check (mobile_number is null or mobile_number ~ '^\+?[0-9]{7,15}$')
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reporter_application_private_details'::regclass
      and conname = 'reporter_application_age_at_application_check'
  ) then
    alter table public.reporter_application_private_details
      add constraint reporter_application_age_at_application_check
      check (age_at_application is null or age_at_application between 0 and 130);
  end if;
end;
$$;

create or replace function public.chowk_set_reporter_application_age()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  application_date date;
begin
  if new.date_of_birth is null then
    new.age_at_application := null;
  elsif tg_op = 'INSERT' or new.date_of_birth is distinct from old.date_of_birth then
    select (application.created_at at time zone 'Asia/Kolkata')::date
      into application_date
    from public.reporter_applications application
    where application.id = new.application_id;

    if application_date is null then
      raise exception 'Reporter application date is required to calculate age'
        using errcode = '23514';
    end if;

    new.age_at_application :=
      extract(year from age(application_date, new.date_of_birth))::smallint;
  end if;

  return new;
end;
$$;

drop trigger if exists chowk_set_reporter_application_age
  on public.reporter_application_private_details;
create trigger chowk_set_reporter_application_age
  before insert or update on public.reporter_application_private_details
  for each row execute function public.chowk_set_reporter_application_age();

do $$
begin
  if to_regprocedure(
    'public.chowk_submit_reporter_application_with_private_details_base_0051(bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb)'
  ) is null then
    if to_regprocedure(
      'public.chowk_submit_reporter_application_with_private_details(bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb)'
    ) is null then
      raise exception 'Reporter application submission function is missing';
    end if;

    alter function public.chowk_submit_reporter_application_with_private_details(
      bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb
    ) rename to chowk_submit_reporter_application_with_private_details_base_0051;
  end if;
end;
$$;

revoke all on function public.chowk_submit_reporter_application_with_private_details_base_0051(
  bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb
) from public, anon, authenticated;

create or replace function public.chowk_submit_reporter_application_with_private_details(
  target_state bigint,
  target_rto bigint,
  target_type bigint,
  accepted_version text,
  accepted_sha256 text,
  signer_name text,
  acceptance_statement text,
  details_confirmed boolean,
  target_document_sha256 text,
  target_document_path text,
  private_details jsonb,
  application_documents jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  applicant uuid := (select auth.uid());
  submitted_application_id bigint;
  selected_coverage_area_id bigint;
  parsed_birth_date date;
begin
  if applicant is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  if jsonb_typeof(private_details) is distinct from 'object'
      or coalesce(private_details ->> 'mobile_number', '') !~ '^\+?[0-9]{7,15}$'
      or coalesce(private_details ->> 'date_of_birth', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(private_details ->> 'coverage_area_id', '') !~ '^[1-9][0-9]{0,18}$' then
    raise exception 'Enter a valid mobile number and date of birth, and choose a Coverage Area'
      using errcode = '22023';
  end if;

  begin
    parsed_birth_date := (private_details ->> 'date_of_birth')::date;
    selected_coverage_area_id := (private_details ->> 'coverage_area_id')::bigint;
  exception when others then
    raise exception 'Enter a valid date of birth and Coverage Area'
      using errcode = '22023';
  end;

  if parsed_birth_date > current_date then
    raise exception 'Date of birth cannot be in the future' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.locations coverage_area
    join public.rto_offices office
      on office.location_id = coverage_area.parent_id
     and office.id = target_rto
     and office.state_id = target_state
     and office.is_active
    where coverage_area.id = selected_coverage_area_id
      and coverage_area.location_type = 'coverage_area'
      and coverage_area.is_active
  ) then
    raise exception 'Choose an active Coverage Area within the selected District'
      using errcode = '23514';
  end if;

  submitted_application_id :=
    public.chowk_submit_reporter_application_with_private_details_base_0051(
      target_state,
      target_rto,
      target_type,
      accepted_version,
      accepted_sha256,
      signer_name,
      acceptance_statement,
      details_confirmed,
      target_document_sha256,
      target_document_path,
      private_details,
      application_documents
    );

  update public.reporter_application_private_details
  set coverage_area_id = selected_coverage_area_id,
      mobile_number = trim(private_details ->> 'mobile_number'),
      date_of_birth = parsed_birth_date,
      updated_at = now()
  where application_id = submitted_application_id
    and user_id = applicant;

  if not found then
    raise exception 'Reporter mobile, date of birth, and Coverage Area could not be saved'
      using errcode = '23514';
  end if;

  return submitted_application_id;
end;
$$;

revoke all on function public.chowk_submit_reporter_application_with_private_details(
  bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb
) from public, anon;
grant execute on function public.chowk_submit_reporter_application_with_private_details(
  bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb
) to authenticated;

update public.reporter_application_private_details details
set age_at_application = extract(year from age(
  (application.created_at at time zone 'Asia/Kolkata')::date,
  details.date_of_birth
))::smallint
from public.reporter_applications application
where application.id = details.application_id
  and details.date_of_birth is not null;
