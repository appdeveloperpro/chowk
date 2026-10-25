alter table public.reporter_application_private_details
  drop constraint if exists reporter_application_preferred_locations_check;

alter table public.reporter_application_private_details
  add constraint reporter_application_preferred_locations_check
  check (
    length(trim(coverage_localities)) = 0
    or length(trim(coverage_localities)) between 2 and 1000
  )
  not valid;

alter table public.reporter_application_documents
  drop constraint if exists reporter_application_documents_document_type_check,
  drop constraint if exists reporter_application_documents_storage_path_check;

alter table public.reporter_application_documents
  add constraint reporter_application_documents_document_type_check
    check (document_type in (
      'profile_photo', 'masked_aadhaar', 'aadhaar_front', 'aadhaar_back', 'pan_card', 'bank_proof'
    )),
  add constraint reporter_application_documents_storage_path_check
    check (
      storage_path ~ (
        '^applications/[0-9a-f-]{36}/(profile_photo|masked_aadhaar|aadhaar_front|aadhaar_back|pan_card|bank_proof)/[0-9a-f-]{36}\.(jpg|png|pdf)$'
      )
    );

drop policy if exists "Applicants upload own reporter application documents" on storage.objects;
create policy "Applicants upload own reporter application documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chowk-reporter-applications'
    and split_part(name, '/', 1) = 'applications'
    and split_part(name, '/', 2) = (select auth.uid())::text
    and name ~ (
      '^applications/' || (select auth.uid())::text
      || '/(profile_photo|masked_aadhaar|aadhaar_front|aadhaar_back|pan_card|bank_proof)/[0-9a-f-]{36}\.(jpg|png|pdf)$'
    )
  );

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
  document_record jsonb;
  document_count integer;
begin
  if applicant is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if jsonb_typeof(private_details) is distinct from 'object'
      or jsonb_typeof(application_documents) is distinct from 'array' then
    raise exception 'Reporter contact, coverage and document details are required' using errcode = '22023';
  end if;
  if private_details ->> 'masked_aadhaar_confirmed' is distinct from 'true'
      or private_details ->> 'document_processing_consent' is distinct from 'true' then
    raise exception 'Confirm the Aadhaar masking and document privacy notice' using errcode = '22023';
  end if;

  document_count := jsonb_array_length(application_documents);
  if document_count <> 5
      or (select count(distinct item ->> 'document_type')
          from jsonb_array_elements(application_documents) as docs(item)) <> 5
      or exists (
        select 1 from jsonb_array_elements(application_documents) as docs(item)
        where item ->> 'document_type' not in (
          'profile_photo', 'aadhaar_front', 'aadhaar_back', 'pan_card', 'bank_proof'
        )
      )
      or not exists (
        select 1 from jsonb_array_elements(application_documents) as docs(item)
        where item ->> 'document_type' = 'aadhaar_front'
      )
      or not exists (
        select 1 from jsonb_array_elements(application_documents) as docs(item)
        where item ->> 'document_type' = 'aadhaar_back'
      ) then
    raise exception 'Upload a profile photo, both Aadhaar sides, PAN card and bank proof'
      using errcode = '22023';
  end if;

  for document_record in select item from jsonb_array_elements(application_documents) as docs(item)
  loop
    if coalesce(document_record ->> 'storage_path', '') !~
        ('^applications/' || applicant::text || '/' || (document_record ->> 'document_type')
          || '/[0-9a-f-]{36}\.(jpg|png|pdf)$')
        or coalesce(document_record ->> 'sha256', '') !~ '^[a-f0-9]{64}$'
        or coalesce(document_record ->> 'mime_type', '') not in ('image/jpeg', 'image/png', 'application/pdf')
        or not exists (
          select 1 from storage.objects
          where bucket_id = 'chowk-reporter-applications'
            and name = document_record ->> 'storage_path'
        ) then
      raise exception 'A reporter application document is missing or invalid' using errcode = '22023';
    end if;
  end loop;

  submitted_application_id := public.chowk_submit_reporter_application_with_document(
    target_state,
    target_rto,
    target_type,
    accepted_version,
    accepted_sha256,
    signer_name,
    acceptance_statement,
    details_confirmed,
    target_document_sha256,
    target_document_path
  );

  insert into public.reporter_application_private_details (
    application_id, user_id, emergency_contact_name, emergency_contact_relationship,
    emergency_contact_phone, blood_group, masked_aadhaar_confirmed, document_processing_consent,
    preferred_language, coverage_localities,
    experience_years, experience_summary, availability, bank_account_holder,
    bank_name, bank_account_number, bank_ifsc
  )
  values (
    submitted_application_id,
    applicant,
    trim(private_details ->> 'emergency_contact_name'),
    trim(private_details ->> 'emergency_contact_relationship'),
    trim(private_details ->> 'emergency_contact_phone'),
    private_details ->> 'blood_group',
    true,
    true,
    coalesce(trim(private_details ->> 'preferred_language'), ''),
    coalesce(trim(private_details ->> 'coverage_localities'), ''),
    nullif(private_details ->> 'experience_years', '')::numeric,
    coalesce(trim(private_details ->> 'experience_summary'), ''),
    coalesce(trim(private_details ->> 'availability'), ''),
    trim(private_details ->> 'bank_account_holder'),
    trim(private_details ->> 'bank_name'),
    regexp_replace(coalesce(private_details ->> 'bank_account_number', ''), '\s', '', 'g'),
    upper(trim(private_details ->> 'bank_ifsc'))
  )
  on conflict (application_id) do update set
    user_id = excluded.user_id,
    emergency_contact_name = excluded.emergency_contact_name,
    emergency_contact_relationship = excluded.emergency_contact_relationship,
    emergency_contact_phone = excluded.emergency_contact_phone,
    blood_group = excluded.blood_group,
    masked_aadhaar_confirmed = excluded.masked_aadhaar_confirmed,
    document_processing_consent = excluded.document_processing_consent,
    preferred_language = excluded.preferred_language,
    coverage_localities = excluded.coverage_localities,
    experience_years = excluded.experience_years,
    experience_summary = excluded.experience_summary,
    availability = excluded.availability,
    bank_account_holder = excluded.bank_account_holder,
    bank_name = excluded.bank_name,
    bank_account_number = excluded.bank_account_number,
    bank_ifsc = excluded.bank_ifsc,
    updated_at = now();

  insert into public.reporter_application_documents (
    application_id, user_id, document_type, storage_path, mime_type, sha256
  )
  select
    submitted_application_id,
    applicant,
    item ->> 'document_type',
    item ->> 'storage_path',
    item ->> 'mime_type',
    item ->> 'sha256'
  from jsonb_array_elements(application_documents) as docs(item)
  on conflict (application_id, document_type) do update set
    user_id = excluded.user_id,
    storage_path = excluded.storage_path,
    mime_type = excluded.mime_type,
    sha256 = excluded.sha256,
    created_at = now();

  return submitted_application_id;
end;
$$;

revoke all on function public.chowk_submit_reporter_application_with_private_details(
  bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb
) from public, anon;
grant execute on function public.chowk_submit_reporter_application_with_private_details(
  bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb
) to authenticated;
