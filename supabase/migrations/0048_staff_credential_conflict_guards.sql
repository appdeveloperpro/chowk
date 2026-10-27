with ranked_credentials as (
  select
    id,
    row_number() over (
      partition by subject_user_id_snapshot, credential_type, status
      order by issued_at desc, id desc
    ) as position
  from public.staff_credentials
  where status = 'active'
     or status = 'pending_acceptance'
)
update public.staff_credentials credential
set status = 'superseded'
from ranked_credentials ranked
where credential.id = ranked.id
  and ranked.position > 1;

create unique index if not exists staff_credentials_one_active_per_subject_type
  on public.staff_credentials(subject_user_id_snapshot, credential_type)
  where status = 'active';
create unique index if not exists staff_credentials_one_pending_per_subject_type
  on public.staff_credentials(subject_user_id_snapshot, credential_type)
  where status = 'pending_acceptance';

create or replace function public.chowk_serialize_staff_credential_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(new.subject_user_id_snapshot::text),
    pg_catalog.hashtext(new.credential_type)
  );

  update public.staff_credentials
  set status = 'superseded'
  where subject_user_id_snapshot = new.subject_user_id_snapshot
    and credential_type = new.credential_type
    and (
      status = 'pending_acceptance'
      or (new.credential_type = 'id_card' and status = 'active')
    );
  return new;
end;
$$;

drop trigger if exists chowk_serialize_staff_credential_issue
  on public.staff_credentials;
create trigger chowk_serialize_staff_credential_issue
before insert on public.staff_credentials
for each row execute function public.chowk_serialize_staff_credential_issue();

revoke all on function public.chowk_serialize_staff_credential_issue()
  from public, anon, authenticated;

create or replace function public.chowk_verify_staff_credential(verification_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  credential public.staff_credentials%rowtype;
  display_status text;
  profile_role text;
begin
  if verification_code !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid verification code' using errcode = '22023';
  end if;
  select * into credential
  from public.staff_credentials
  where verification_token = verification_code;
  if not found then return null; end if;

  display_status := credential.status;
  if credential.status in ('active', 'pending_acceptance') then
    if credential.valid_until < current_date then
      display_status := 'expired';
    elsif credential.valid_from > current_date then
      display_status := 'not_yet_valid';
    else
      select role into profile_role
      from public.profiles
      where id = credential.subject_user_id_snapshot;

      if profile_role is null then
        display_status := 'inactive';
      elsif credential.role_snapshot = 'reporter'
          and profile_role = 'subscriber'
          and exists (
            select 1
            from public.reporter_applications application
            where application.user_id = credential.subject_user_id_snapshot
              and application.status = 'approved'
          )
          and (
            credential.credential_type = 'id_card'
            or (
              credential.credential_type = 'authority_letter'
              and credential.status = 'pending_acceptance'
            )
          ) then
        display_status := 'pending_acceptance';
      elsif profile_role is distinct from credential.role_snapshot then
        display_status := 'inactive';
      elsif credential.role_snapshot = 'reporter' and not exists (
        select 1
        from public.reporter_assignments assignment
        join public.rto_offices rto on rto.id = assignment.rto_office_id
        join public.states state_row on state_row.id = rto.state_id
        join public.reporter_types reporter_type on reporter_type.id = assignment.reporter_type_id
        where assignment.user_id = credential.subject_user_id_snapshot
          and assignment.effective_to is null
          and state_row.state_code = credential.scope_snapshot->>'state_code'
          and rto.rto_code = credential.scope_snapshot->>'rto_code'
          and reporter_type.type_code = credential.scope_snapshot->>'reporter_type_code'
      ) then
        display_status := 'inactive';
      elsif credential.role_snapshot in ('editor', 'moderator')
          and credential.scope_snapshot ? 'coverage_location_id'
          and not exists (
            select 1
            from public.user_coverage_assignments coverage
            where coverage.user_id = credential.subject_user_id_snapshot
              and coverage.valid_to is null
              and coalesce(
                coverage.region_id,
                coverage.zone_id,
                coverage.district_id,
                coverage.city_id,
                coverage.coverage_area_id
              )::text = credential.scope_snapshot->>'coverage_location_id'
          ) then
        display_status := 'inactive';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'credential_type', credential.credential_type,
    'reference_code', credential.reference_code,
    'status', display_status,
    'name', credential.name_snapshot,
    'role', credential.role_snapshot,
    'reporter_code', credential.reporter_code_snapshot,
    'scope', credential.scope_snapshot,
    'valid_from', credential.valid_from,
    'valid_until', credential.valid_until
  );
end;
$$;
revoke all on function public.chowk_verify_staff_credential(text)
  from public, authenticated;
grant execute on function public.chowk_verify_staff_credential(text) to anon;

with ranked_service_agreements as (
  select
    id,
    row_number() over (
      order by published_at desc nulls last, id desc
    ) as position
  from public.reporter_service_agreement_versions
  where status = 'published'
)
update public.reporter_service_agreement_versions agreement
set status = 'archived'
from ranked_service_agreements ranked
where agreement.id = ranked.id
  and ranked.position > 1;

create unique index if not exists reporter_service_agreement_one_published_version
  on public.reporter_service_agreement_versions(status)
  where status = 'published';

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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('chowk_reporter_service_agreement_publish')::bigint
  );

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
  if position('{{reporter.designation}}' in agreement_row.template_content) = 0 then
    raise exception 'Add {{reporter.designation}} to the service agreement so the assigned position is included'
      using errcode = '23514';
  end if;

  remaining_tokens := regexp_replace(
    agreement_row.template_content,
    '\{\{(agreement\.date|company\.(entity_type|legal_name|official_email|official_phone|registered_address|registration_number|trade_name|website_url)|reporter\.(city|designation|email|full_name|phone|reporter_code|rto|state|father_first_name|father_last_name|permanent_address|permanent_address_line1|permanent_address_line2|permanent_address_city|permanent_address_district|permanent_address_state|permanent_address_postal_code|date_of_birth|mobile_number))\}\}',
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

revoke all on function public.chowk_admin_publish_reporter_service_agreement(bigint)
  from public, anon;
grant execute on function public.chowk_admin_publish_reporter_service_agreement(bigint)
  to authenticated;
