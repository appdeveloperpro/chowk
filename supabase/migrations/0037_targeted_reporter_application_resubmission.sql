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
  application_row public.reporter_applications%rowtype;
  requested_names text[];
  document_record jsonb;
  requested_reupload_count integer;
begin
  if applicant is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  select * into application_row
  from public.reporter_applications
  where id = target_application
    and user_id = applicant
  for update;
  if application_row.id is null or application_row.status <> 'needs_information' then
    raise exception 'This application is not waiting for requested updates' using errcode = '22023';
  end if;
  if jsonb_typeof(application_row.review_requests) is distinct from 'array'
      or jsonb_typeof(private_details) is distinct from 'object'
      or jsonb_typeof(application_documents) is distinct from 'array' then
    raise exception 'Requested application updates are invalid' using errcode = '22023';
  end if;

  requested_names := array(
    select request.value ->> 'field'
    from jsonb_array_elements(application_row.review_requests) as request(value)
  );
  if coalesce(array_length(requested_names, 1), 0) = 0 then
    raise exception 'No field-specific updates were requested' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(application_row.review_requests) as request(value)
    where coalesce(request.value ->> 'field', '') not in (
      'state_id', 'rto_office_id',
      'mobile_number', 'date_of_birth', 'emergency_contact_name',
      'emergency_contact_relationship', 'emergency_contact_phone', 'blood_group',
      'preferred_language', 'coverage_area_id', 'coverage_localities',
      'experience_years', 'experience_summary', 'availability',
      'bank_account_holder', 'bank_name', 'bank_account_number', 'bank_ifsc',
      'profile_photo', 'aadhaar_front', 'aadhaar_back', 'pan_card', 'bank_proof'
    )
  ) then
    raise exception 'The application contains an unsupported update request' using errcode = '22023';
  end if;

  if ('mobile_number' = any(requested_names)
      and coalesce(private_details ->> 'mobile_number', '') !~ '^\+?[0-9]{7,15}$')
      or ('date_of_birth' = any(requested_names)
        and (
          coalesce(private_details ->> 'date_of_birth', '') !~ '^\d{4}-\d{2}-\d{2}$'
          or (private_details ->> 'date_of_birth')::date > current_date
        ))
      or ('emergency_contact_name' = any(requested_names)
        and length(trim(coalesce(private_details ->> 'emergency_contact_name', ''))) not between 2 and 120)
      or ('emergency_contact_relationship' = any(requested_names)
        and length(trim(coalesce(private_details ->> 'emergency_contact_relationship', ''))) not between 2 and 80)
      or ('emergency_contact_phone' = any(requested_names)
        and coalesce(private_details ->> 'emergency_contact_phone', '') !~ '^[+0-9() .-]{7,30}$')
      or ('blood_group' = any(requested_names)
        and coalesce(private_details ->> 'blood_group', '') not in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Prefer not to say'))
      or ('preferred_language' = any(requested_names)
        and length(coalesce(private_details ->> 'preferred_language', '')) > 80)
      or ('coverage_localities' = any(requested_names)
        and length(trim(coalesce(private_details ->> 'coverage_localities', ''))) > 0
        and length(trim(private_details ->> 'coverage_localities')) not between 2 and 1000)
      or ('experience_years' = any(requested_names)
        and nullif(private_details ->> 'experience_years', '')::numeric not between 0 and 80)
      or ('experience_summary' = any(requested_names)
        and length(coalesce(private_details ->> 'experience_summary', '')) > 2000)
      or ('availability' = any(requested_names)
        and length(coalesce(private_details ->> 'availability', '')) > 120)
      or ('bank_account_holder' = any(requested_names)
        and length(trim(coalesce(private_details ->> 'bank_account_holder', ''))) not between 2 and 120)
      or ('bank_name' = any(requested_names)
        and length(trim(coalesce(private_details ->> 'bank_name', ''))) not between 2 and 160)
      or ('bank_account_number' = any(requested_names)
        and coalesce(private_details ->> 'bank_account_number', '') !~ '^[0-9]{6,24}$')
      or ('bank_ifsc' = any(requested_names)
        and upper(coalesce(private_details ->> 'bank_ifsc', '')) !~ '^[A-Z]{4}0[A-Z0-9]{6}$') then
    raise exception 'One or more requested fields contain invalid values' using errcode = '22023';
  end if;

  if requested_names && array['state_id', 'rto_office_id', 'coverage_area_id'] then
    if not exists (
      select 1
      from public.states state
      join public.rto_offices office
        on office.state_id = state.id
       and office.id = case when 'rto_office_id' = any(requested_names)
         then target_rto else application_row.rto_office_id end
      join public.locations district
        on district.id = office.location_id
       and district.location_type = 'district'
       and district.is_active
      where state.id = case when 'state_id' = any(requested_names)
        then target_state else application_row.state_id end
        and state.is_active
        and office.is_active
    ) then
      raise exception 'Choose an active District within the selected State' using errcode = '23514';
    end if;
    if not exists (
      select 1
      from public.rto_offices office
      join public.locations coverage_area
        on coverage_area.parent_id = office.location_id
       and coverage_area.location_type = 'coverage_area'
       and coverage_area.is_active
      where office.id = case when 'rto_office_id' = any(requested_names)
        then target_rto else application_row.rto_office_id end
        and office.state_id = case when 'state_id' = any(requested_names)
          then target_state else application_row.state_id end
        and coverage_area.id = case when private_details ? 'coverage_area_id'
          then nullif(private_details ->> 'coverage_area_id', '')::bigint
          else (select details.coverage_area_id
                from public.reporter_application_private_details details
                where details.application_id = target_application
                  and details.user_id = applicant) end
    ) then
      raise exception 'Choose a Coverage Area within the selected District' using errcode = '23514';
    end if;
  end if;

  if requested_names && array[
    'mobile_number', 'date_of_birth', 'emergency_contact_name',
    'emergency_contact_relationship', 'emergency_contact_phone', 'blood_group',
    'preferred_language', 'coverage_area_id', 'coverage_localities',
    'experience_years', 'experience_summary', 'availability',
    'bank_account_holder', 'bank_name', 'bank_account_number', 'bank_ifsc'
  ] then
    update public.reporter_application_private_details details
    set mobile_number = case when 'mobile_number' = any(requested_names)
          then trim(private_details ->> 'mobile_number') else details.mobile_number end,
        date_of_birth = case when 'date_of_birth' = any(requested_names)
          then (private_details ->> 'date_of_birth')::date else details.date_of_birth end,
        emergency_contact_name = case when 'emergency_contact_name' = any(requested_names)
          then trim(private_details ->> 'emergency_contact_name') else details.emergency_contact_name end,
        emergency_contact_relationship = case when 'emergency_contact_relationship' = any(requested_names)
          then trim(private_details ->> 'emergency_contact_relationship') else details.emergency_contact_relationship end,
        emergency_contact_phone = case when 'emergency_contact_phone' = any(requested_names)
          then trim(private_details ->> 'emergency_contact_phone') else details.emergency_contact_phone end,
        blood_group = case when 'blood_group' = any(requested_names)
          then private_details ->> 'blood_group' else details.blood_group end,
        preferred_language = case when 'preferred_language' = any(requested_names)
          then coalesce(trim(private_details ->> 'preferred_language'), '') else details.preferred_language end,
        coverage_area_id = case when 'coverage_area_id' = any(requested_names)
            or 'state_id' = any(requested_names) or 'rto_office_id' = any(requested_names)
          then nullif(private_details ->> 'coverage_area_id', '')::bigint else details.coverage_area_id end,
        coverage_localities = case when 'coverage_localities' = any(requested_names)
          then coalesce(trim(private_details ->> 'coverage_localities'), '') else details.coverage_localities end,
        experience_years = case when 'experience_years' = any(requested_names)
          then nullif(private_details ->> 'experience_years', '')::numeric else details.experience_years end,
        experience_summary = case when 'experience_summary' = any(requested_names)
          then coalesce(trim(private_details ->> 'experience_summary'), '') else details.experience_summary end,
        availability = case when 'availability' = any(requested_names)
          then coalesce(trim(private_details ->> 'availability'), '') else details.availability end,
        bank_account_holder = case when 'bank_account_holder' = any(requested_names)
          then trim(private_details ->> 'bank_account_holder') else details.bank_account_holder end,
        bank_name = case when 'bank_name' = any(requested_names)
          then trim(private_details ->> 'bank_name') else details.bank_name end,
        bank_account_number = case when 'bank_account_number' = any(requested_names)
          then regexp_replace(coalesce(private_details ->> 'bank_account_number', ''), '\s', '', 'g')
          else details.bank_account_number end,
        bank_ifsc = case when 'bank_ifsc' = any(requested_names)
          then upper(trim(private_details ->> 'bank_ifsc')) else details.bank_ifsc end,
        updated_at = now()
    where details.application_id = target_application
      and details.user_id = applicant;
    if not found then
      raise exception 'Application details could not be updated' using errcode = '23514';
    end if;
  end if;

  select count(*) into requested_reupload_count
  from jsonb_array_elements(application_row.review_requests) as request(value)
  where request.value ->> 'kind' = 'reupload';
  if jsonb_array_length(application_documents) <> requested_reupload_count then
    raise exception 'Upload each document requested for reupload, and no other documents' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(application_row.review_requests) as request(value)
    where request.value ->> 'kind' = 'reupload'
      and (
        select count(*)
        from jsonb_array_elements(application_documents) as submitted(value)
        where submitted.value ->> 'document_type' = request.value ->> 'field'
      ) <> 1
  ) then
    raise exception 'Upload each requested document exactly once' using errcode = '22023';
  end if;

  for document_record in
    select submitted.value
    from jsonb_array_elements(application_documents) as submitted(value)
  loop
    if not exists (
      select 1
      from jsonb_array_elements(application_row.review_requests) as request(value)
      where request.value ->> 'kind' = 'reupload'
        and request.value ->> 'field' = document_record ->> 'document_type'
    )
        or coalesce(document_record ->> 'storage_path', '') !~
          ('^applications/' || applicant::text || '/' || (document_record ->> 'document_type')
            || '/[0-9a-f-]{36}\.(jpg|png|pdf)$')
        or coalesce(document_record ->> 'sha256', '') !~ '^[a-f0-9]{64}$'
        or coalesce(document_record ->> 'mime_type', '') not in ('image/jpeg', 'image/png', 'application/pdf')
        or ((document_record ->> 'document_type') = 'profile_photo'
          and document_record ->> 'mime_type' = 'application/pdf')
        or not exists (
          select 1
          from storage.objects stored_object
          where stored_object.bucket_id = 'chowk-reporter-applications'
            and stored_object.name = document_record ->> 'storage_path'
        ) then
      raise exception 'A requested replacement document is missing or invalid' using errcode = '22023';
    end if;
  end loop;

  insert into public.reporter_application_documents(
    application_id, user_id, document_type, storage_path, mime_type, sha256
  )
  select
    target_application,
    applicant,
    submitted.value ->> 'document_type',
    submitted.value ->> 'storage_path',
    submitted.value ->> 'mime_type',
    submitted.value ->> 'sha256'
  from jsonb_array_elements(application_documents) as submitted(value)
  on conflict (application_id, document_type) do update
  set user_id = excluded.user_id,
      storage_path = excluded.storage_path,
      mime_type = excluded.mime_type,
      sha256 = excluded.sha256,
      created_at = now();

  update public.reporter_applications
  set state_id = case when 'state_id' = any(requested_names) then target_state else state_id end,
      rto_office_id = case when 'rto_office_id' = any(requested_names)
          or 'state_id' = any(requested_names) then target_rto else rto_office_id end,
      applicant_details_confirmed = true,
      status = 'pending',
      review_note = '',
      review_requests = '[]'::jsonb,
      reviewed_by = null,
      reviewed_at = null
  where id = target_application
    and user_id = applicant
    and status = 'needs_information';
end;
$$;

revoke all on function public.chowk_resubmit_reporter_application(
  bigint,bigint,bigint,jsonb,jsonb
) from public, anon;
grant execute on function public.chowk_resubmit_reporter_application(
  bigint,bigint,bigint,jsonb,jsonb
) to authenticated;
