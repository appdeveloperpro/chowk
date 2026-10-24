alter table public.reporter_applications
  add column if not exists applicant_details_confirmed boolean not null default false;

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
  published_agreement public.reporter_agreement_versions%rowtype;
  agreement_is_published boolean := false;
  application_id bigint;
begin
  if applicant is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = applicant and role = 'subscriber') then
    raise exception 'Only a subscriber account can submit a reporter application' using errcode = '42501';
  end if;
  if not coalesce(details_confirmed, false) then
    raise exception 'Confirm that your application details are accurate' using errcode = '22023';
  end if;

  select * into published_agreement
  from public.reporter_agreement_versions
  where status = 'published'
  for share;
  agreement_is_published := found;

  if agreement_is_published then
    if accepted_version is distinct from published_agreement.version
        or accepted_sha256 is distinct from published_agreement.sha256
        or length(trim(coalesce(signer_name, ''))) < 2
        or length(trim(coalesce(acceptance_statement, ''))) < 10 then
      raise exception 'Review and accept the current published reporter agreement before applying' using errcode = '23514';
    end if;
  elsif nullif(trim(coalesce(accepted_version, '')), '') is not null
      or nullif(trim(coalesce(accepted_sha256, '')), '') is not null
      or nullif(trim(coalesce(signer_name, '')), '') is not null
      or nullif(trim(coalesce(acceptance_statement, '')), '') is not null then
    raise exception 'No reporter agreement is published; do not submit an agreement acceptance' using errcode = '23514';
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
    agreement_is_published,
    case when agreement_is_published then published_agreement.version else '' end,
    case when agreement_is_published then published_agreement.sha256 else null end,
    case when agreement_is_published then published_agreement.document_url else null end,
    case when agreement_is_published then trim(signer_name) else null end,
    case when agreement_is_published then trim(acceptance_statement) else null end,
    case when agreement_is_published then now() else null end,
    'pending'
  )
  on conflict (user_id) do update
  set state_id = excluded.state_id,
      rto_office_id = excluded.rto_office_id,
      reporter_type_id = excluded.reporter_type_id,
      applicant_details_confirmed = true,
      agreement_accepted = excluded.agreement_accepted,
      agreement_version = excluded.agreement_version,
      agreement_sha256 = excluded.agreement_sha256,
      agreement_document_url = excluded.agreement_document_url,
      agreement_signer_name = excluded.agreement_signer_name,
      agreement_acceptance_statement = excluded.agreement_acceptance_statement,
      agreement_accepted_at = excluded.agreement_accepted_at,
      status = 'pending',
      review_note = '',
      reviewed_by = null,
      reviewed_at = null
  where public.reporter_applications.status in ('rejected', 'needs_information')
  returning id into application_id;

  if application_id is null then
    raise exception 'An application already exists and cannot be resubmitted in its current state' using errcode = '23505';
  end if;

  if agreement_is_published then
    insert into public.reporter_agreement_acceptances (
      application_id, user_id, agreement_version, agreement_sha256, signer_name, acceptance_statement
    )
    values (
      application_id, applicant, published_agreement.version, published_agreement.sha256,
      trim(signer_name), trim(acceptance_statement)
    );
  end if;

  return application_id;
end;
$$;
revoke all on function public.chowk_submit_reporter_application(bigint,bigint,bigint,text,text,text,text,boolean) from public, anon;
grant execute on function public.chowk_submit_reporter_application(bigint,bigint,bigint,text,text,text,text,boolean) to authenticated;

create or replace function public.chowk_admin_review_reporter_application(
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
  select * into application_row
  from public.reporter_applications
  where id = target_application
  for update;
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
    select * into rto from public.rto_offices
      where id = application_row.rto_office_id and is_active;
    select * into state_row from public.states
      where id = application_row.state_id and is_active;
    select * into reporter_type from public.reporter_types
      where id = application_row.reporter_type_id and is_active;
    if rto.id is null or state_row.id is null or reporter_type.id is null
        or rto.state_id <> state_row.id then
      raise exception 'Application location or reporter type is no longer active' using errcode = '23514';
    end if;
    insert into public.reporter_code_counters(rto_office_id, reporter_type_id)
    values (rto.id, reporter_type.id)
    on conflict do nothing;
    update public.reporter_code_counters
    set next_number = next_number + 1
    where rto_office_id = rto.id and reporter_type_id = reporter_type.id
    returning next_number - 1 into issued_number;
    if issued_number > 9999 then
      raise exception 'Reporter ID sequence is exhausted for this RTO and reporter type' using errcode = '22003';
    end if;
    new_code := lower(
      state_row.state_code || rto.rto_code || '-' || reporter_type.type_code || '-'
      || lpad(issued_number::text, 4, '0')
    );
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
revoke all on function public.chowk_admin_review_reporter_application(bigint,text,text,text,text,boolean) from public, anon;
grant execute on function public.chowk_admin_review_reporter_application(bigint,text,text,text,text,boolean) to authenticated;
