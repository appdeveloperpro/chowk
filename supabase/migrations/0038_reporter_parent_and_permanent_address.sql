alter table public.reporter_application_private_details
  add column if not exists father_first_name text,
  add column if not exists father_last_name text,
  add column if not exists permanent_address_line1 text,
  add column if not exists permanent_address_line2 text,
  add column if not exists permanent_address_city text,
  add column if not exists permanent_address_district text,
  add column if not exists permanent_address_state text,
  add column if not exists permanent_address_postal_code text;

do $$
begin
  if to_regprocedure(
    'public.chowk_submit_reporter_application_with_private_details_base_0038(bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb)'
  ) is null then
    alter function public.chowk_submit_reporter_application_with_private_details(
      bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb
    ) rename to chowk_submit_reporter_application_with_private_details_base_0038;
  end if;
  if to_regprocedure(
    'public.chowk_resubmit_reporter_application_base_0038(bigint,bigint,bigint,jsonb,jsonb)'
  ) is null then
    alter function public.chowk_resubmit_reporter_application(
      bigint,bigint,bigint,jsonb,jsonb
    ) rename to chowk_resubmit_reporter_application_base_0038;
  end if;
  if to_regprocedure(
    'public.chowk_admin_review_reporter_application_base_0038(bigint,text,text,text,text,boolean,jsonb)'
  ) is null then
    alter function public.chowk_admin_review_reporter_application(
      bigint,text,text,text,text,boolean,jsonb
    ) rename to chowk_admin_review_reporter_application_base_0038;
  end if;
end;
$$;

revoke all on function public.chowk_submit_reporter_application_with_private_details_base_0038(
  bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb
) from public, anon, authenticated;
revoke all on function public.chowk_resubmit_reporter_application_base_0038(
  bigint,bigint,bigint,jsonb,jsonb
) from public, anon, authenticated;
revoke all on function public.chowk_admin_review_reporter_application_base_0038(
  bigint,text,text,text,text,boolean,jsonb
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
begin
  if applicant is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if jsonb_typeof(private_details) is distinct from 'object'
      or length(trim(coalesce(private_details ->> 'father_first_name', ''))) not between 1 and 80
      or length(trim(coalesce(private_details ->> 'father_last_name', ''))) not between 1 and 80
      or length(trim(coalesce(private_details ->> 'permanent_address_line1', ''))) not between 2 and 160
      or length(trim(coalesce(private_details ->> 'permanent_address_line2', ''))) > 160
      or length(trim(coalesce(private_details ->> 'permanent_address_city', ''))) not between 2 and 100
      or length(trim(coalesce(private_details ->> 'permanent_address_district', ''))) not between 2 and 100
      or length(trim(coalesce(private_details ->> 'permanent_address_state', ''))) not between 2 and 100
      or coalesce(private_details ->> 'permanent_address_postal_code', '') !~ '^[0-9]{6}$' then
    raise exception 'Enter the father name and complete permanent address, including a valid 6-digit PIN/ZIP code' using errcode = '22023';
  end if;

  submitted_application_id := public.chowk_submit_reporter_application_with_private_details_base_0038(
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
  set father_first_name = trim(private_details ->> 'father_first_name'),
      father_last_name = trim(private_details ->> 'father_last_name'),
      permanent_address_line1 = trim(private_details ->> 'permanent_address_line1'),
      permanent_address_line2 = nullif(trim(coalesce(private_details ->> 'permanent_address_line2', '')), ''),
      permanent_address_city = trim(private_details ->> 'permanent_address_city'),
      permanent_address_district = trim(private_details ->> 'permanent_address_district'),
      permanent_address_state = trim(private_details ->> 'permanent_address_state'),
      permanent_address_postal_code = private_details ->> 'permanent_address_postal_code',
      updated_at = now()
  where application_id = submitted_application_id
    and user_id = applicant;
  if not found then
    raise exception 'Father name and permanent address could not be saved' using errcode = '23514';
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

create or replace function public.chowk_resubmit_reporter_application(
  target_application bigint,
  target_state bigint,
  target_rto bigint,
  private_details jsonb,
  application_documents jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  applicant uuid := (select auth.uid());
  request_row public.reporter_applications%rowtype;
  requested_names text[];
  existing_field_names text[];
begin
  if applicant is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  select * into request_row
  from public.reporter_applications
  where id = target_application
    and user_id = applicant
    and status = 'needs_information'
  for update;
  if request_row.id is null then
    raise exception 'This application is not waiting for requested updates' using errcode = '22023';
  end if;

  requested_names := array(
    select request.value ->> 'field'
    from jsonb_array_elements(request_row.review_requests) as request(value)
  );
  if coalesce(array_length(requested_names, 1), 0) = 0 then
    raise exception 'No field-specific updates were requested' using errcode = '22023';
  end if;
  existing_field_names := array(
    select request.value ->> 'field'
    from jsonb_array_elements(request_row.review_requests) as request(value)
    where request.value ->> 'field' not in (
      'father_first_name', 'father_last_name', 'permanent_address_line1',
      'permanent_address_line2', 'permanent_address_city',
      'permanent_address_district', 'permanent_address_state',
      'permanent_address_postal_code'
    )
  );
  if 'father_first_name' = any(requested_names)
      and length(trim(coalesce(private_details ->> 'father_first_name', ''))) not between 1 and 80
      or 'father_last_name' = any(requested_names)
      and length(trim(coalesce(private_details ->> 'father_last_name', ''))) not between 1 and 80
      or 'permanent_address_line1' = any(requested_names)
      and length(trim(coalesce(private_details ->> 'permanent_address_line1', ''))) not between 2 and 160
      or 'permanent_address_line2' = any(requested_names)
      and length(trim(coalesce(private_details ->> 'permanent_address_line2', ''))) > 160
      or 'permanent_address_city' = any(requested_names)
      and length(trim(coalesce(private_details ->> 'permanent_address_city', ''))) not between 2 and 100
      or 'permanent_address_district' = any(requested_names)
      and length(trim(coalesce(private_details ->> 'permanent_address_district', ''))) not between 2 and 100
      or 'permanent_address_state' = any(requested_names)
      and length(trim(coalesce(private_details ->> 'permanent_address_state', ''))) not between 2 and 100
      or 'permanent_address_postal_code' = any(requested_names)
      and coalesce(private_details ->> 'permanent_address_postal_code', '') !~ '^[0-9]{6}$' then
    raise exception 'One or more requested father-name or permanent-address fields are invalid' using errcode = '22023';
  end if;

  if coalesce(array_length(existing_field_names, 1), 0) > 0 then
    update public.reporter_applications
    set review_requests = coalesce((
      select jsonb_agg(request.value)
      from jsonb_array_elements(request_row.review_requests) as request(value)
      where request.value ->> 'field' not in (
        'father_first_name', 'father_last_name', 'permanent_address_line1',
        'permanent_address_line2', 'permanent_address_city',
        'permanent_address_district', 'permanent_address_state',
        'permanent_address_postal_code'
      )
    ), '[]'::jsonb)
    where id = target_application
      and user_id = applicant;

    perform public.chowk_resubmit_reporter_application_base_0038(
      target_application,
      target_state,
      target_rto,
      private_details,
      application_documents
    );
  elsif jsonb_typeof(application_documents) is distinct from 'array'
      or jsonb_array_length(application_documents) <> 0 then
    raise exception 'No document replacement was requested' using errcode = '22023';
  end if;

  if requested_names && array[
    'father_first_name', 'father_last_name', 'permanent_address_line1',
    'permanent_address_line2', 'permanent_address_city',
    'permanent_address_district', 'permanent_address_state',
    'permanent_address_postal_code'
  ] then
    update public.reporter_application_private_details details
    set father_first_name = case when 'father_first_name' = any(requested_names)
          then trim(private_details ->> 'father_first_name') else details.father_first_name end,
        father_last_name = case when 'father_last_name' = any(requested_names)
          then trim(private_details ->> 'father_last_name') else details.father_last_name end,
        permanent_address_line1 = case when 'permanent_address_line1' = any(requested_names)
          then trim(private_details ->> 'permanent_address_line1') else details.permanent_address_line1 end,
        permanent_address_line2 = case when 'permanent_address_line2' = any(requested_names)
          then nullif(trim(coalesce(private_details ->> 'permanent_address_line2', '')), '')
          else details.permanent_address_line2 end,
        permanent_address_city = case when 'permanent_address_city' = any(requested_names)
          then trim(private_details ->> 'permanent_address_city') else details.permanent_address_city end,
        permanent_address_district = case when 'permanent_address_district' = any(requested_names)
          then trim(private_details ->> 'permanent_address_district') else details.permanent_address_district end,
        permanent_address_state = case when 'permanent_address_state' = any(requested_names)
          then trim(private_details ->> 'permanent_address_state') else details.permanent_address_state end,
        permanent_address_postal_code = case when 'permanent_address_postal_code' = any(requested_names)
          then private_details ->> 'permanent_address_postal_code' else details.permanent_address_postal_code end,
        updated_at = now()
    where details.application_id = target_application
      and details.user_id = applicant;
    if not found then
      raise exception 'Requested father-name or permanent-address fields could not be saved' using errcode = '23514';
    end if;
  end if;

  if coalesce(array_length(existing_field_names, 1), 0) = 0 then
    update public.reporter_applications
    set applicant_details_confirmed = true,
        status = 'pending',
        review_note = '',
        review_requests = '[]'::jsonb,
        reviewed_by = null,
        reviewed_at = null
    where id = target_application
      and user_id = applicant
      and status = 'needs_information';
  end if;
end;
$$;

revoke all on function public.chowk_resubmit_reporter_application(
  bigint,bigint,bigint,jsonb,jsonb
) from public, anon;
grant execute on function public.chowk_resubmit_reporter_application(
  bigint,bigint,bigint,jsonb,jsonb
) to authenticated;

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
  item jsonb;
  existing_fields jsonb;
begin
  if jsonb_typeof(requested_fields) is distinct from 'array'
      or jsonb_array_length(requested_fields) > 40 then
    raise exception 'Review requests must be a list of no more than 40 fields' using errcode = '22023';
  end if;
  if decision <> 'needs_information' and jsonb_array_length(requested_fields) > 0 then
    raise exception 'Field requests are only allowed when requesting more information' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(requested_fields)
  loop
    if jsonb_typeof(item) is distinct from 'object'
        or coalesce(item ->> 'field', '') not in (
          'state_id', 'rto_office_id', 'mobile_number', 'date_of_birth',
          'emergency_contact_name', 'emergency_contact_relationship',
          'emergency_contact_phone', 'blood_group', 'preferred_language',
          'coverage_area_id', 'coverage_localities', 'experience_years',
          'experience_summary', 'availability', 'bank_account_holder',
          'bank_name', 'bank_account_number', 'bank_ifsc', 'profile_photo',
          'aadhaar_front', 'aadhaar_back', 'pan_card', 'bank_proof',
          'father_first_name', 'father_last_name', 'permanent_address_line1',
          'permanent_address_line2', 'permanent_address_city',
          'permanent_address_district', 'permanent_address_state',
          'permanent_address_postal_code'
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
    from jsonb_array_elements(requested_fields) as request(value)
    group by request.value ->> 'field'
    having count(*) > 1
  ) then
    raise exception 'Each field can only be requested once' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(request.value), '[]'::jsonb)
  into existing_fields
  from jsonb_array_elements(requested_fields) as request(value)
  where request.value ->> 'field' not in (
    'father_first_name', 'father_last_name', 'permanent_address_line1',
    'permanent_address_line2', 'permanent_address_city',
    'permanent_address_district', 'permanent_address_state',
    'permanent_address_postal_code'
  );

  perform public.chowk_admin_review_reporter_application_base_0038(
    target_application,
    decision,
    note,
    signer_name,
    signer_designation,
    signature_accepted,
    existing_fields
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
