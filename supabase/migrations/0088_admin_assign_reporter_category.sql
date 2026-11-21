-- Run this entire migration as one script; later statements depend on functions defined above.
begin;

update public.reporter_applications
set reporter_type_id = null
where status in ('pending', 'needs_information', 'rejected')
  and reporter_type_id is not null;

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
  if target_type is not null then
    raise exception 'The reporting category is assigned by the review team' using errcode = '22023';
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

  insert into public.reporter_applications (
    user_id, state_id, rto_office_id, reporter_type_id, applicant_details_confirmed,
    agreement_accepted, agreement_version, agreement_sha256, agreement_document_url,
    agreement_signer_name, agreement_acceptance_statement, agreement_accepted_at, status
  )
  values (
    applicant, target_state, target_rto, null, true,
    false, '', null, null, null, null, null, 'pending'
  )
  on conflict (user_id) do update
  set state_id = excluded.state_id,
      rto_office_id = excluded.rto_office_id,
      reporter_type_id = null,
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

revoke all on function public.chow_submit_reporter_application(
  bigint, bigint, bigint, text, text, text, text, boolean
) from public, anon, authenticated;

create or replace function public.chowk_admin_review_reporter_application_scoped(
  target_application bigint,
  decision text,
  note text,
  signer_name text,
  signer_designation text,
  signature_accepted boolean,
  requested_fields jsonb,
  target_designation bigint,
  target_type bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null or not public.chowk_user_can_review_reporter_application(target_application) then
    raise exception 'You are not assigned to review this application location'
      using errcode = '42501';
  end if;
  if decision is null or decision not in ('approved', 'rejected', 'needs_information') then
    raise exception 'Choose a valid review decision' using errcode = '22023';
  end if;

  if decision = 'approved' then
    if target_type is null or not exists (
      select 1 from public.reporter_types
      where id = target_type and is_active
    ) then
      raise exception 'Choose an active reporting category before approving' using errcode = '22023';
    end if;
    update public.reporter_applications
    set reporter_type_id = target_type
    where id = target_application and status in ('pending', 'needs_information');
    if not found then
      raise exception 'Only an application awaiting review can be approved' using errcode = '23514';
    end if;
  elsif target_type is not null then
    raise exception 'A reporting category can only be assigned when approving' using errcode = '22023';
  end if;

  perform public.chowk_admin_review_reporter_application_scoped(
    target_application,
    decision,
    note,
    signer_name,
    signer_designation,
    signature_accepted,
    requested_fields,
    target_designation
  );
end;
$$;

revoke all on function public.chowk_admin_review_reporter_application_scoped(
  bigint, text, text, text, text, boolean, jsonb, bigint
) from public, anon, authenticated;
revoke all on function public.chowk_admin_review_reporter_application_scoped(
  bigint, text, text, text, text, boolean, jsonb, bigint, bigint
) from public, anon;
grant execute on function public.chowk_admin_review_reporter_application_scoped(
  bigint, text, text, text, text, boolean, jsonb, bigint, bigint
) to authenticated;

commit;
