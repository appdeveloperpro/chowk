create or replace function public.chowk_submit_reporter_application(
  target_state bigint,
  target_rto bigint,
  target_type bigint,
  accepted_version text,
  accepted_sha256 text,
  signer_name text,
  acceptance_statement text,
  details_confirmed boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  applicant uuid := (select auth.uid());
  application_id bigint;
begin
  if applicant is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = applicant and role = 'subscriber') then
    raise exception 'Only a subscriber account can submit a reporter application' using errcode = '42501';
  end if;
  if not coalesce(details_confirmed, false) then
    raise exception 'Confirm that your application details are accurate' using errcode = '22023';
  end if;
  if not exists (select 1 from public.states where id = target_state and is_active) then
    raise exception 'Select an active state' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.rto_offices
    where id = target_rto and state_id = target_state and is_active
  ) then
    raise exception 'Select an active RTO in the selected state' using errcode = '22023';
  end if;
  if not exists (select 1 from public.reporter_types where id = target_type and is_active) then
    raise exception 'Select an active reporter type' using errcode = '22023';
  end if;

  insert into public.reporter_applications (
    user_id, state_id, rto_office_id, reporter_type_id, applicant_details_confirmed,
    agreement_accepted, agreement_version, agreement_sha256, agreement_document_url,
    agreement_signer_name, agreement_acceptance_statement, agreement_accepted_at, status
  )
  values (
    applicant, target_state, target_rto, target_type, true,
    false, '', null, null, null, null, null, 'pending'
  )
  on conflict (user_id) do update
  set state_id = excluded.state_id,
      rto_office_id = excluded.rto_office_id,
      reporter_type_id = excluded.reporter_type_id,
      applicant_details_confirmed = true,
      agreement_accepted = false,
      agreement_version = '',
      agreement_sha256 = null,
      agreement_document_url = null,
      agreement_signer_name = null,
      agreement_acceptance_statement = null,
      agreement_accepted_at = null,
      status = 'pending',
      review_note = '',
      reviewed_by = null,
      reviewed_at = null
  where public.reporter_applications.status in ('rejected', 'needs_information')
  returning id into application_id;

  if application_id is null then
    raise exception 'An application already exists and cannot be resubmitted in its current state' using errcode = '23505';
  end if;

  return application_id;
end;
$$;

revoke all on function public.chowk_submit_reporter_application(bigint,bigint,bigint,text,text,text,text,boolean) from public, anon;
grant execute on function public.chowk_submit_reporter_application(bigint,bigint,bigint,text,text,text,text,boolean) to authenticated;

create or replace function public.chowk_admin_review_reporter_application_base_0034(
  target_application bigint,
  decision text,
  note text default '',
  signer_name text default '',
  signer_designation text default '',
  signature_accepted boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  application_row public.reporter_applications%rowtype;
  rto public.rto_offices%rowtype;
  state_row public.states%rowtype;
  reporter_type public.reporter_types%rowtype;
  issued_number integer;
  new_code text;
begin
  if actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if decision not in ('approved', 'rejected', 'needs_information') then
    raise exception 'Decision must be approved, rejected, or needs information' using errcode = '22023';
  end if;
  select * into application_row from public.reporter_applications
  where id = target_application for update;
  if not found or application_row.status not in ('pending', 'needs_information') then
    raise exception 'Only an application awaiting review can be reviewed' using errcode = '23514';
  end if;
  if decision in ('rejected', 'needs_information') and length(trim(coalesce(note, ''))) < 2 then
    raise exception 'A clear applicant-facing note is required for this decision' using errcode = '22023';
  end if;
  if decision = 'approved' then
    if length(trim(coalesce(signer_name, ''))) < 2
       or length(trim(coalesce(signer_designation, ''))) < 2
       or not coalesce(signature_accepted, false) then
      raise exception 'Company approver details and approval attestation are required' using errcode = '22023';
    end if;
    select * into rto from public.rto_offices where id = application_row.rto_office_id and is_active;
    select * into state_row from public.states where id = application_row.state_id and is_active;
    select * into reporter_type from public.reporter_types where id = application_row.reporter_type_id and is_active;
    if rto.id is null or state_row.id is null or reporter_type.id is null or rto.state_id <> state_row.id then
      raise exception 'Application location or reporter type is no longer active' using errcode = '23514';
    end if;
    insert into public.reporter_code_counters(rto_office_id, reporter_type_id)
    values (rto.id, reporter_type.id) on conflict do nothing;
    update public.reporter_code_counters set next_number = next_number + 1
    where rto_office_id = rto.id and reporter_type_id = reporter_type.id
    returning next_number - 1 into issued_number;
    if issued_number > 9999 then
      raise exception 'Reporter ID sequence is exhausted for this RTO and reporter type' using errcode = '22003';
    end if;
    new_code := lower(state_row.state_code || rto.rto_code || '-' || reporter_type.type_code || '-' || lpad(issued_number::text, 4, '0'));
    insert into public.reporter_profiles(user_id, reporter_code)
    values (application_row.user_id, new_code)
    on conflict (user_id) do nothing;
    if not exists (
      select 1 from public.reporter_assignments
      where user_id = application_row.user_id and effective_to is null
    ) then
      insert into public.reporter_assignments(user_id, rto_office_id, reporter_type_id, assigned_by)
      values (application_row.user_id, rto.id, reporter_type.id, actor);
    end if;
  end if;
  update public.reporter_applications
  set status = decision,
      review_note = trim(coalesce(note, '')),
      reviewed_by = actor,
      reviewed_at = now(),
      company_signer_name = case when decision = 'approved' then nullif(trim(coalesce(signer_name, '')), '') else null end,
      company_signer_designation = case when decision = 'approved' then nullif(trim(coalesce(signer_designation, '')), '') else null end,
      company_signature_accepted = decision = 'approved' and coalesce(signature_accepted, false),
      company_signed_at = case when decision = 'approved' then now() else null end,
      company_signature_statement = case when decision = 'approved'
        then 'Authorized approver attests to this application decision; this record is not a cryptographic signature.'
        else null end
  where id = target_application;
end;
$$;
revoke all on function public.chowk_admin_review_reporter_application_base_0034(
  bigint,text,text,text,text,boolean
) from public, anon, authenticated;

create or replace function public.chowk_admin_publish_reporter_service_agreement(target_agreement bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement_row public.reporter_service_agreement_versions%rowtype;
  remaining_tokens text;
begin
  if (select auth.uid()) is null
      or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select * into agreement_row
  from public.reporter_service_agreement_versions
  where id = target_agreement and status in ('draft', 'published')
  for update;
  if not found then
    raise exception 'Draft service agreement not found' using errcode = 'P0002';
  end if;
  if agreement_row.template_content is null then
    raise exception 'Only personalized service-agreement templates can be published'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.reporter_organization_profile
    where id is true and is_verified
  ) then
    raise exception 'Verify the organization legal profile before publishing personalized service agreements'
      using errcode = '23514';
  end if;
  if length(trim(agreement_row.template_content)) < 1000
      or agreement_row.template_content ~ '\[[^]]+\]' then
    raise exception 'Replace all square-bracket terms and complete the agreement before publishing'
      using errcode = '23514';
  end if;
  remaining_tokens := regexp_replace(
    agreement_row.template_content,
    '\{\{(agreement\.date|company\.(entity_type|legal_name|official_email|official_phone|registered_address|registration_number|trade_name|website_url)|reporter\.(city|email|full_name|phone|reporter_code|rto|state|father_first_name|father_last_name|permanent_address|permanent_address_line1|permanent_address_line2|permanent_address_city|permanent_address_district|permanent_address_state|permanent_address_postal_code|date_of_birth|mobile_number))\}\}',
    '',
    'g'
  );
  if remaining_tokens ~ '\{\{[^}]+\}\}' then
    raise exception 'The service agreement contains an unknown or unsupported server template field'
      using errcode = '23514';
  end if;
  update public.reporter_service_agreement_versions
  set status = 'archived'
  where status = 'published' and id <> target_agreement;
  update public.reporter_service_agreement_versions
  set status = 'published', published_by = (select auth.uid()), published_at = now()
  where id = target_agreement;
end;
$$;
revoke all on function public.chowk_admin_publish_reporter_service_agreement(bigint) from public, anon;
grant execute on function public.chowk_admin_publish_reporter_service_agreement(bigint) to authenticated;

revoke all on function public.chowk_accept_current_reporter_agreement_with_document(
  text,text,text,text,text,text
) from public, anon, authenticated;
revoke all on function public.chowk_accept_current_reporter_service_agreement(
  text,text,text,text
) from public, anon, authenticated;
revoke all on function public.chowk_accept_current_reporter_service_agreement_with_document(
  text,text,text,text,text,text
) from public, anon, authenticated;

create or replace function public.chowk_enforce_current_reporter_service_agreement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  application_row public.reporter_applications%rowtype;
  agreement public.reporter_service_agreement_versions%rowtype;
  accepted_current boolean;
begin
  if new.credential_type not in ('id_card', 'authority_letter') then
    return new;
  end if;
  select * into application_row
  from public.reporter_applications
  where user_id = new.subject_user_id_snapshot
    and status in ('approved', 'active');
  if not found then
    return new;
  end if;
  select * into agreement
  from public.reporter_service_agreement_versions
  where status = 'published';
  if not found or agreement.template_content is null then
    raise exception 'Publish a personalized service agreement before issuing reporter credentials'
      using errcode = '23514';
  end if;
  select exists (
    select 1
    from public.reporter_service_agreement_issues issue
    join public.reporter_service_agreement_acceptances acceptance
      on acceptance.issue_id = issue.id
     and acceptance.application_id = issue.application_id
     and acceptance.user_id = issue.user_id
     and acceptance.agreement_version = issue.agreement_version
     and acceptance.agreement_sha256 = issue.agreement_sha256
    where issue.id = application_row.service_agreement_issue_id
      and issue.application_id = application_row.id
      and issue.user_id = application_row.user_id
      and issue.status = 'published'
      and issue.agreement_version = agreement.version
      and issue.agreement_sha256 = agreement.sha256
      and acceptance.accepted_at is not null
  ) into accepted_current;
  if not accepted_current then
    raise exception 'The reporter must accept their current issued service agreement before credentials can be issued'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.chowk_reporter_acknowledge_credential(
  target_credential bigint, typed_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  credential public.staff_credentials%rowtype;
  person public.profiles%rowtype;
  service_agreement_current boolean;
begin
  select * into credential from public.staff_credentials where id = target_credential for update;
  if not found then raise exception 'Credential not found for this account' using errcode = 'P0002'; end if;
  select * into person from public.profiles where id = (select auth.uid()) for update;
  if person.id is null or credential.subject_user_id_snapshot is distinct from person.id then
    raise exception 'Credential not found for this account' using errcode = '42501';
  end if;
  if credential.credential_type <> 'authority_letter' or credential.status <> 'pending_acceptance' then
    raise exception 'Only a pending authority letter can be acknowledged' using errcode = '23514';
  end if;
  if lower(trim(coalesce(typed_name, ''))) <> lower(trim(person.full_name)) then
    raise exception 'Type your account name exactly to acknowledge this letter' using errcode = '22023';
  end if;
  if credential.valid_until < current_date or credential.valid_from > current_date then
    raise exception 'This authority letter is outside its validity period' using errcode = '23514';
  end if;
  select exists (
    select 1
    from public.reporter_applications application
    join public.reporter_service_agreement_versions agreement
      on agreement.status = 'published'
     and agreement.template_content is not null
     and agreement.version = application.service_agreement_version
     and agreement.sha256 = application.service_agreement_sha256
    join public.reporter_service_agreement_issues issue
      on issue.id = application.service_agreement_issue_id
     and issue.application_id = application.id
     and issue.user_id = application.user_id
     and issue.status = 'published'
     and issue.agreement_version = agreement.version
     and issue.agreement_sha256 = agreement.sha256
    join public.reporter_service_agreement_acceptances acceptance
      on acceptance.issue_id = issue.id
     and acceptance.application_id = issue.application_id
     and acceptance.user_id = issue.user_id
     and acceptance.agreement_version = issue.agreement_version
     and acceptance.agreement_sha256 = issue.agreement_sha256
    where application.user_id = person.id
      and application.status in ('approved', 'active')
      and application.service_agreement_accepted_at is not null
      and acceptance.accepted_at is not null
  ) into service_agreement_current;
  if exists (select 1 from public.reporter_applications where user_id = person.id and status in ('approved', 'active'))
      and not service_agreement_current then
    raise exception 'Accept the current issued reporter service agreement before acknowledging this authority letter' using errcode = '23514';
  end if;
  update public.staff_credentials set status = 'superseded'
  where subject_user_id_snapshot = person.id and credential_type = 'authority_letter' and status = 'active';
  update public.staff_credentials set status = 'active',
    acknowledged_name = trim(typed_name), acknowledged_at = now()
  where id = target_credential;
  update public.reporter_applications set status = 'active'
  where user_id = person.id and status = 'approved';
  update public.profiles set role = 'reporter'
  where id = person.id and role = 'subscriber'
    and exists (select 1 from public.reporter_applications where user_id = person.id and status = 'active');
end;
$$;
revoke all on function public.chowk_reporter_acknowledge_credential(bigint,text) from public, anon;
grant execute on function public.chowk_reporter_acknowledge_credential(bigint,text) to authenticated;
