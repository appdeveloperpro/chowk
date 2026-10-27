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
    and status in ('approved', 'active')
  for update;
  if not found then
    return new;
  end if;

  select * into agreement
  from public.reporter_service_agreement_versions
  where status = 'published'
  for share;
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

create or replace function public.chowk_supersede_credentials_on_service_agreement_reissue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.service_agreement_issue_id is distinct from old.service_agreement_issue_id then
    update public.staff_credentials
    set status = 'superseded'
    where subject_user_id_snapshot = new.user_id
      and status in ('active', 'pending_acceptance');
  end if;
  return new;
end;
$$;

drop trigger if exists chowk_supersede_credentials_on_service_agreement_reissue
  on public.reporter_applications;
create trigger chowk_supersede_credentials_on_service_agreement_reissue
after update of service_agreement_issue_id on public.reporter_applications
for each row execute function public.chowk_supersede_credentials_on_service_agreement_reissue();

revoke all on function public.chowk_supersede_credentials_on_service_agreement_reissue()
  from public, anon, authenticated;

create or replace function public.chowk_reporter_acknowledge_credential(
  target_credential bigint,
  typed_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  applicant uuid := (select auth.uid());
  application_row public.reporter_applications%rowtype;
  application_found boolean;
  credential public.staff_credentials%rowtype;
  person public.profiles%rowtype;
  service_agreement_current boolean;
begin
  if applicant is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  select * into application_row
  from public.reporter_applications
  where user_id = applicant
    and status in ('approved', 'active')
  order by created_at desc
  limit 1
  for update;
  application_found := found;

  select * into credential
  from public.staff_credentials
  where id = target_credential
  for update;
  if not found then
    raise exception 'Credential not found for this account' using errcode = 'P0002';
  end if;

  select * into person
  from public.profiles
  where id = applicant
  for update;
  if person.id is null or credential.subject_user_id_snapshot is distinct from person.id then
    raise exception 'Credential not found for this account' using errcode = '42501';
  end if;
  if credential.credential_type <> 'authority_letter'
      or credential.status <> 'pending_acceptance' then
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
      and (not application_found or application.id = application_row.id)
  ) into service_agreement_current;

  if application_found and not service_agreement_current then
    raise exception 'Accept the current issued reporter service agreement before acknowledging this authority letter'
      using errcode = '23514';
  end if;

  update public.staff_credentials
  set status = 'superseded'
  where subject_user_id_snapshot = person.id
    and credential_type = 'authority_letter'
    and status = 'active';
  update public.staff_credentials
  set status = 'active',
      acknowledged_name = trim(typed_name),
      acknowledged_at = now()
  where id = target_credential;

  update public.reporter_applications
  set status = 'active'
  where user_id = person.id and status = 'approved';
  update public.profiles
  set role = 'reporter'
  where id = person.id and role = 'subscriber'
    and exists (
      select 1
      from public.reporter_applications
      where user_id = person.id and status = 'active'
    );
end;
$$;

revoke all on function public.chowk_reporter_acknowledge_credential(bigint, text)
  from public, anon;
grant execute on function public.chowk_reporter_acknowledge_credential(bigint, text)
  to authenticated;
