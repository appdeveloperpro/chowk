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

  for item in
    select request_value.value
    from jsonb_array_elements(requested_fields) as request_value(value)
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
    from jsonb_array_elements(requested_fields) as request_value(value)
    group by request_value.value ->> 'field'
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
