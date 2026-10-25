alter table public.reporter_application_private_details
  add column if not exists mobile_number text,
  add column if not exists date_of_birth date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reporter_application_private_details'::regclass
      and conname = 'reporter_application_mobile_number_check'
  ) then
    alter table public.reporter_application_private_details
      add constraint reporter_application_mobile_number_check
      check (mobile_number is null or mobile_number ~ '^\+?[0-9]{7,15}$') not valid;
  end if;
end;
$$;

alter table public.reporter_applications
  add column if not exists review_requests jsonb not null default '[]'::jsonb;

do $$
begin
  if to_regprocedure(
    'public.chowk_submit_reporter_application_with_private_details_base_0034(bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb)'
  ) is null then
    alter function public.chowk_submit_reporter_application_with_private_details(
      bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb
    ) rename to chowk_submit_reporter_application_with_private_details_base_0034;
  end if;
end;
$$;

revoke all on function public.chowk_submit_reporter_application_with_private_details_base_0034(
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
  parsed_birth_date date;
begin
  if applicant is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if jsonb_typeof(private_details) is distinct from 'object'
      or coalesce(private_details ->> 'mobile_number', '') !~ '^\+?[0-9]{7,15}$'
      or coalesce(private_details ->> 'date_of_birth', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Enter a valid mobile number and date of birth' using errcode = '22023';
  end if;
  begin
    parsed_birth_date := (private_details ->> 'date_of_birth')::date;
  exception when others then
    raise exception 'Enter a valid date of birth' using errcode = '22023';
  end;
  if parsed_birth_date > current_date then
    raise exception 'Date of birth cannot be in the future' using errcode = '22023';
  end if;

  submitted_application_id := public.chowk_submit_reporter_application_with_private_details_base_0034(
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
  set mobile_number = trim(private_details ->> 'mobile_number'),
      date_of_birth = parsed_birth_date,
      updated_at = now()
  where application_id = submitted_application_id
    and user_id = applicant;

  update public.reporter_applications
  set review_requests = '[]'::jsonb
  where id = submitted_application_id
    and user_id = applicant;

  return submitted_application_id;
end;
$$;

revoke all on function public.chowk_submit_reporter_application_with_private_details(
  bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb
) from public, anon;
grant execute on function public.chowk_submit_reporter_application_with_private_details(
  bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb
) to authenticated;

do $$
begin
  if to_regprocedure(
    'public.chowk_admin_review_reporter_application_base_0034(bigint,text,text,text,text,boolean)'
  ) is null then
    alter function public.chowk_admin_review_reporter_application(
      bigint,text,text,text,text,boolean
    ) rename to chowk_admin_review_reporter_application_base_0034;
  end if;
end;
$$;

revoke all on function public.chowk_admin_review_reporter_application_base_0034(
  bigint,text,text,text,text,boolean
) from public, anon, authenticated;

create or replace function public.chowk_admin_review_reporter_application(
  target_application bigint,
  decision text,
  note text,
  signer_name text,
  signer_designation text,
  signature_accepted boolean,
  requested_fields jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_profile public.profiles%rowtype;
  item jsonb;
  derived_designation text;
begin
  if actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if jsonb_typeof(requested_fields) is distinct from 'array' then
    raise exception 'Review requests must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(requested_fields) > 40 then
    raise exception 'A review may contain no more than 40 field requests' using errcode = '22023';
  end if;
  if decision <> 'needs_information' and jsonb_array_length(requested_fields) > 0 then
    raise exception 'Field requests are only allowed when requesting more information' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(requested_fields)
  loop
    if jsonb_typeof(item) is distinct from 'object'
        or coalesce(item ->> 'field', '') not in (
          'state_id', 'rto_office_id',
          'mobile_number', 'date_of_birth', 'emergency_contact_name',
          'emergency_contact_relationship', 'emergency_contact_phone', 'blood_group',
          'preferred_language', 'coverage_area_id', 'coverage_localities',
          'experience_years', 'experience_summary', 'availability',
          'bank_account_holder', 'bank_name', 'bank_account_number', 'bank_ifsc',
          'profile_photo', 'aadhaar_front', 'aadhaar_back', 'pan_card', 'bank_proof'
        )
        or coalesce(item ->> 'kind', '') not in ('correction', 'reupload', 'other')
        or length(trim(coalesce(item ->> 'instruction', ''))) not between 2 and 500
        or (
          item ->> 'kind' = 'reupload'
          and item ->> 'field' not in ('profile_photo', 'aadhaar_front', 'aadhaar_back', 'pan_card', 'bank_proof')
        )
        or (
          item ->> 'kind' = 'correction'
          and item ->> 'field' in ('profile_photo', 'aadhaar_front', 'aadhaar_back', 'pan_card', 'bank_proof')
        ) then
      raise exception 'Each review request needs a valid field, action and instruction' using errcode = '22023';
    end if;
  end loop;
  if exists (
    select 1
    from jsonb_array_elements(requested_fields) as request(item)
    group by item ->> 'field'
    having count(*) > 1
  ) then
    raise exception 'Each field can only be requested once' using errcode = '22023';
  end if;

  select * into actor_profile from public.profiles where id = actor;
  if actor_profile.id is null or length(trim(coalesce(actor_profile.full_name, ''))) < 2 then
    raise exception 'The signed-in reviewer must have a full name in their account profile' using errcode = '22023';
  end if;
  derived_designation := case actor_profile.role
    when 'super_admin' then 'Super Administrator'
    else 'Administrator'
  end;

  perform public.chowk_admin_review_reporter_application_base_0034(
    target_application,
    decision,
    note,
    actor_profile.full_name,
    derived_designation,
    signature_accepted
  );

  update public.reporter_applications
  set review_requests = case when decision = 'needs_information' then requested_fields else '[]'::jsonb end
  where id = target_application;
end;
$$;

revoke all on function public.chowk_admin_review_reporter_application(
  bigint,text,text,text,text,boolean,jsonb
) from public, anon;
grant execute on function public.chowk_admin_review_reporter_application(
  bigint,text,text,text,text,boolean,jsonb
) to authenticated;
