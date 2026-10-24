alter table public.reporter_agreement_versions
  add column if not exists template_content text;

alter table public.reporter_agreement_versions
  drop constraint if exists reporter_agreement_template_content_check;
alter table public.reporter_agreement_versions
  add constraint reporter_agreement_template_content_check
  check (template_content is null or length(template_content) between 1000 and 50000);

alter table public.reporter_agreement_acceptances
  add column if not exists generated_document_sha256 text,
  add column if not exists document_storage_path text,
  add column if not exists organization_snapshot jsonb,
  add column if not exists reporter_snapshot jsonb;

alter table public.reporter_agreement_acceptances
  drop constraint if exists reporter_agreement_acceptances_document_sha256_check;
alter table public.reporter_agreement_acceptances
  add constraint reporter_agreement_acceptances_document_sha256_check
  check (generated_document_sha256 is null or generated_document_sha256 ~ '^[a-f0-9]{64}$');

alter table public.reporter_agreement_acceptances
  drop constraint if exists reporter_agreement_acceptances_document_storage_path_check;
alter table public.reporter_agreement_acceptances
  add constraint reporter_agreement_acceptances_document_storage_path_check
  check (
    document_storage_path is null
    or document_storage_path ~ '^acceptance/[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'
  );

update public.reporter_agreement_versions
set status = 'archived'
where status = 'published' and template_content is null;

grant select on public.reporter_agreement_versions to anon, authenticated;
drop policy if exists "Users view published reporter agreement templates"
  on public.reporter_agreement_versions;
create policy "Users view published reporter agreement templates"
  on public.reporter_agreement_versions for select to anon, authenticated
  using (status = 'published' and template_content is not null);

grant select on public.reporter_organization_profile to authenticated;
drop policy if exists "Users view verified reporter organization profile"
  on public.reporter_organization_profile;
create policy "Users view verified reporter organization profile"
  on public.reporter_organization_profile for select to authenticated
  using (is_verified);

drop policy if exists "Users upload own reporter agreement acceptance documents"
  on storage.objects;
create policy "Users upload own reporter agreement acceptance documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chowk-reporter-agreements'
    and split_part(name, '/', 1) = 'acceptance'
    and split_part(name, '/', 2) = (select auth.uid())::text
    and name ~ ('^acceptance/' || (select auth.uid())::text || '/[0-9a-f-]{36}\.pdf$')
  );

drop policy if exists "Users remove unrecorded reporter agreement acceptance documents"
  on storage.objects;
create policy "Users remove unrecorded reporter agreement acceptance documents"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chowk-reporter-agreements'
    and split_part(name, '/', 1) = 'acceptance'
    and split_part(name, '/', 2) = (select auth.uid())::text
    and not exists (
      select 1 from public.reporter_agreement_acceptances acceptance
      where acceptance.document_storage_path = storage.objects.name
    )
  );

drop policy if exists "Accepted reporter agreement documents are readable" on storage.objects;
create policy "Accepted reporter agreement documents are readable"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chowk-reporter-agreements'
    and (
      exists (
        select 1 from public.reporter_agreement_versions agreement
        join public.reporter_agreement_acceptances acceptance
          on acceptance.agreement_version = agreement.version
          and acceptance.agreement_sha256 = agreement.sha256
        where agreement.storage_object_path = storage.objects.name
          and acceptance.user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.reporter_service_agreement_versions agreement
        join public.reporter_service_agreement_acceptances acceptance
          on acceptance.agreement_version = agreement.version
          and acceptance.agreement_sha256 = agreement.sha256
        where agreement.storage_object_path = storage.objects.name
          and acceptance.user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.reporter_agreement_acceptances acceptance
        where acceptance.document_storage_path = storage.objects.name
          and acceptance.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "Admins remove unregistered reporter agreement uploads" on storage.objects;
create policy "Admins remove unregistered reporter agreement uploads"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chowk-reporter-agreements'
    and (select public.chowk_has_any_role(array['admin', 'super_admin']))
    and not exists (
      select 1 from public.reporter_agreement_versions agreement
      where agreement.storage_object_path = storage.objects.name
    )
    and not exists (
      select 1 from public.reporter_service_agreement_versions agreement
      where agreement.storage_object_path = storage.objects.name
    )
    and not exists (
      select 1 from public.reporter_agreement_acceptances acceptance
      where acceptance.document_storage_path = storage.objects.name
    )
  );

create or replace function public.chow_protect_reporter_agreement_template()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.template_content is distinct from old.template_content then
    raise exception 'Published agreement templates are immutable; create a new version instead'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists chow_protect_reporter_agreement_template
  on public.reporter_agreement_versions;
create trigger chow_protect_reporter_agreement_template
  before update on public.reporter_agreement_versions
  for each row execute function public.chow_protect_reporter_agreement_template();

create or replace function public.chow_admin_publish_reporter_agreement(target_agreement bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement_row public.reporter_agreement_versions%rowtype;
  remaining_tokens text;
begin
  if (select auth.uid()) is null
      or not (select public.chow_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.reporter_organization_profile
    where id and is_verified
  ) then
    raise exception 'Verify the organization legal profile before publishing reporter agreements'
      using errcode = '23514';
  end if;
  select * into agreement_row
  from public.reporter_agreement_versions
  where id = target_agreement and status in ('draft', 'published')
  for update;
  if not found or agreement_row.template_content is null then
    raise exception 'A server-generated agreement template is required' using errcode = 'P0002';
  end if;
  if length(trim(agreement_row.template_content)) < 1000
      or agreement_row.template_content ~ '\[[^]]+\]' then
    raise exception 'Replace all square-bracket terms and complete the agreement before publishing'
      using errcode = '23514';
  end if;
  remaining_tokens := regexp_replace(
    agreement_row.template_content,
    '\{\{(agreement\.date|company\.(entity_type|legal_name|registered_address|registration_number|trade_name)|reporter\.(city|email|full_name|phone|reporter_code|rto|state|type))\}\}',
    '',
    'g'
  );
  if remaining_tokens ~ '\{\{[^}]+\}\}' then
    raise exception 'The agreement contains an unknown server template field' using errcode = '23514';
  end if;
  update public.reporter_agreement_versions
  set status = 'archived'
  where status = 'published' and id <> target_agreement;
  update public.reporter_agreement_versions
  set status = 'published', published_by = (select auth.uid()), published_at = now()
  where id = target_agreement;
end;
$$;
revoke all on function public.chow_admin_publish_reporter_agreement(bigint) from public, anon;
grant execute on function public.chow_admin_publish_reporter_agreement(bigint) to authenticated;

create or replace function public.chowk_submit_reporter_application_with_document(
  target_state bigint,
  target_rto bigint,
  target_type bigint,
  accepted_version text,
  accepted_sha256 text,
  signer_name text,
  acceptance_statement text,
  details_confirmed boolean,
  target_document_sha256 text,
  target_document_path text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  applicant uuid := (select auth.uid());
  submitted_application_id bigint;
  application_row public.reporter_applications%rowtype;
  organization_row public.reporter_organization_profile%rowtype;
  reporter_row public.profiles%rowtype;
  selected_state public.states%rowtype;
  selected_rto public.rto_offices%rowtype;
  selected_type public.reporter_types%rowtype;
begin
  if applicant is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if nullif(trim(coalesce(accepted_version, '')), '') is null then
    if nullif(trim(coalesce(target_document_sha256, '')), '') is not null
        or nullif(trim(coalesce(target_document_path, '')), '') is not null then
      raise exception 'No agreement is published; no generated acceptance document can be recorded'
        using errcode = '23514';
    end if;
    return public.chowk_submit_reporter_application(
      target_state, target_rto, target_type, accepted_version, accepted_sha256,
      signer_name, acceptance_statement, details_confirmed
    );
  end if;
  if target_document_sha256 is null
      or target_document_path is null
      or target_document_sha256 !~ '^[a-f0-9]{64}$'
      or target_document_path !~ ('^acceptance/' || applicant::text || '/[0-9a-f-]{36}\.pdf$') then
    raise exception 'The generated agreement document reference is invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'chowk-reporter-agreements'
      and name = target_document_path
  ) then
    raise exception 'The generated agreement document was not stored' using errcode = '23514';
  end if;

  submitted_application_id := public.chowk_submit_reporter_application(
    target_state, target_rto, target_type, accepted_version, accepted_sha256,
    signer_name, acceptance_statement, details_confirmed
  );
  select * into application_row
  from public.reporter_applications where id = submitted_application_id;
  select * into organization_row
  from public.reporter_organization_profile where id;
  select * into reporter_row
  from public.profiles where id = applicant;
  select * into selected_state from public.states where id = application_row.state_id;
  select * into selected_rto from public.rto_offices where id = application_row.rto_office_id;
  select * into selected_type from public.reporter_types where id = application_row.reporter_type_id;

  update public.reporter_agreement_acceptances
  set generated_document_sha256 = target_document_sha256,
      document_storage_path = target_document_path,
      organization_snapshot = jsonb_build_object(
        'legal_name', organization_row.legal_name,
        'trade_name', organization_row.trade_name,
        'entity_type', organization_row.entity_type,
        'registered_address', organization_row.registered_address,
        'registration_number', organization_row.registration_number,
        'official_email', organization_row.official_email,
        'official_phone', organization_row.official_phone,
        'website_url', organization_row.website_url
      ),
      reporter_snapshot = jsonb_build_object(
        'full_name', reporter_row.full_name,
        'email', (select auth.jwt() ->> 'email'),
        'phone', reporter_row.phone,
        'state', selected_state.state_name,
        'rto', selected_rto.rto_code,
        'city', selected_rto.city_name,
        'reporter_type', selected_type.name
      )
  where id = (
    select acceptance.id from public.reporter_agreement_acceptances acceptance
    where acceptance.application_id = submitted_application_id
      and acceptance.user_id = applicant
      and acceptance.agreement_version = accepted_version
    order by acceptance.accepted_at desc, acceptance.id desc
    limit 1
  );
  if not found then
    raise exception 'Agreement acceptance record could not be linked to its generated document'
      using errcode = '23514';
  end if;
  update public.reporter_applications
  set agreement_document_url = '/api/reporter/agreement-accepted-document'
  where id = submitted_application_id;
  return submitted_application_id;
end;
$$;
revoke all on function public.chowk_submit_reporter_application(bigint,bigint,bigint,text,text,text,text,boolean)
  from public, anon, authenticated;
revoke all on function public.chowk_submit_reporter_application_with_document(
  bigint,bigint,bigint,text,text,text,text,boolean,text,text
) from public, anon;
grant execute on function public.chowk_submit_reporter_application_with_document(
  bigint,bigint,bigint,text,text,text,text,boolean,text,text
) to authenticated;

create or replace function public.chowk_accept_current_reporter_agreement_with_document(
  accepted_version text,
  accepted_sha256 text,
  signer_name text,
  acceptance_statement text,
  target_document_sha256 text,
  target_document_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  applicant uuid := (select auth.uid());
  application_row public.reporter_applications%rowtype;
  organization_row public.reporter_organization_profile%rowtype;
  reporter_row public.profiles%rowtype;
  selected_state public.states%rowtype;
  selected_rto public.rto_offices%rowtype;
  selected_type public.reporter_types%rowtype;
begin
  if applicant is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if target_document_sha256 is null
      or target_document_path is null
      or target_document_sha256 !~ '^[a-f0-9]{64}$'
      or target_document_path !~ ('^acceptance/' || applicant::text || '/[0-9a-f-]{36}\.pdf$')
      or not exists (
        select 1 from storage.objects
        where bucket_id = 'chowk-reporter-agreements'
          and name = target_document_path
      ) then
    raise exception 'The generated agreement document reference is invalid' using errcode = '22023';
  end if;

  perform public.chowk_accept_current_reporter_agreement(
    accepted_version, accepted_sha256, signer_name, acceptance_statement
  );
  select * into application_row from public.reporter_applications
  where user_id = applicant;
  select * into organization_row from public.reporter_organization_profile where id;
  select * into reporter_row from public.profiles where id = applicant;
  select * into selected_state from public.states where id = application_row.state_id;
  select * into selected_rto from public.rto_offices where id = application_row.rto_office_id;
  select * into selected_type from public.reporter_types where id = application_row.reporter_type_id;

  update public.reporter_agreement_acceptances
  set generated_document_sha256 = target_document_sha256,
      document_storage_path = target_document_path,
      organization_snapshot = jsonb_build_object(
        'legal_name', organization_row.legal_name,
        'trade_name', organization_row.trade_name,
        'entity_type', organization_row.entity_type,
        'registered_address', organization_row.registered_address,
        'registration_number', organization_row.registration_number,
        'official_email', organization_row.official_email,
        'official_phone', organization_row.official_phone,
        'website_url', organization_row.website_url
      ),
      reporter_snapshot = jsonb_build_object(
        'full_name', reporter_row.full_name,
        'email', (select auth.jwt() ->> 'email'),
        'phone', reporter_row.phone,
        'state', selected_state.state_name,
        'rto', selected_rto.rto_code,
        'city', selected_rto.city_name,
        'reporter_type', selected_type.name
      )
  where id = (
    select acceptance.id from public.reporter_agreement_acceptances acceptance
    where acceptance.application_id = application_row.id
      and acceptance.user_id = applicant
      and acceptance.agreement_version = accepted_version
    order by acceptance.accepted_at desc, acceptance.id desc
    limit 1
  );
  if not found then
    raise exception 'Agreement acceptance record could not be linked to its generated document'
      using errcode = '23514';
  end if;
  update public.reporter_applications
  set agreement_document_url = '/api/reporter/agreement-accepted-document'
  where id = application_row.id;
end;
$$;
revoke all on function public.chowk_accept_current_reporter_agreement(text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.chowk_accept_current_reporter_agreement_with_document(
  text,text,text,text,text,text
) from public, anon;
grant execute on function public.chowk_accept_current_reporter_agreement_with_document(
  text,text,text,text,text,text
) to authenticated;

create or replace function public.chowk_reporter_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'application', (select to_jsonb(a) || jsonb_build_object(
      'state', jsonb_build_object('id', s.id, 'state_code', s.state_code, 'state_name', s.state_name),
      'rto', jsonb_build_object('id', r.id, 'rto_code', r.rto_code, 'city_name', r.city_name),
      'reporter_type', jsonb_build_object('id', t.id, 'type_code', t.type_code, 'name', t.name),
      'reviewer_name', reviewer.full_name,
      'acceptances', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', receipt.id,
          'agreement_version', receipt.agreement_version,
          'agreement_sha256', receipt.agreement_sha256,
          'generated_document_sha256', receipt.generated_document_sha256,
          'document_storage_path', receipt.document_storage_path,
          'signer_name', receipt.signer_name,
          'acceptance_statement', receipt.acceptance_statement,
          'accepted_at', receipt.accepted_at
        ) order by receipt.accepted_at desc)
        from public.reporter_agreement_acceptances receipt where receipt.application_id = a.id
      ), '[]'::jsonb),
      'service_acceptances', coalesce((
        select jsonb_agg(jsonb_build_object(
          'agreement_version', receipt.agreement_version,
          'agreement_sha256', receipt.agreement_sha256,
          'signer_name', receipt.signer_name,
          'acceptance_statement', receipt.acceptance_statement,
          'accepted_at', receipt.accepted_at
        ) order by receipt.accepted_at desc)
        from public.reporter_service_agreement_acceptances receipt where receipt.application_id = a.id
      ), '[]'::jsonb)
    )
      from public.reporter_applications a
      left join public.states s on s.id = a.state_id
      left join public.rto_offices r on r.id = a.rto_office_id
      left join public.reporter_types t on t.id = a.reporter_type_id
      left join public.profiles reviewer on reviewer.id = a.reviewed_by
      where a.user_id = (select auth.uid())),
    'reporter', (select jsonb_build_object(
      'reporter_code', rp.reporter_code, 'assignments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', ra.id, 'effective_from', ra.effective_from, 'effective_to', ra.effective_to,
          'state_name', s.state_name, 'rto_code', ro.rto_code, 'city_name', ro.city_name,
          'type_name', rt.name, 'type_code', rt.type_code
        ) order by ra.effective_from desc)
        from public.reporter_assignments ra
        join public.rto_offices ro on ro.id = ra.rto_office_id
        join public.states s on s.id = ro.state_id
        join public.reporter_types rt on rt.id = ra.reporter_type_id
        where ra.user_id = rp.user_id
      ), '[]'::jsonb))
      from public.reporter_profiles rp where rp.user_id = (select auth.uid())),
    'credentials', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'credential_type', c.credential_type, 'reference_code', c.reference_code,
      'status', c.status, 'valid_from', c.valid_from, 'valid_until', c.valid_until,
      'verification_token', c.verification_token, 'scope', c.scope_snapshot,
      'name', c.name_snapshot, 'role', c.role_snapshot, 'reporter_code', c.reporter_code_snapshot,
      'issued_at', c.issued_at, 'issued_by_name', c.issued_by_name_snapshot,
      'authorized_signer_name', c.authorized_signer_name,
      'authorized_signer_designation', c.authorized_signer_designation,
      'return_address', c.return_address, 'acknowledged_at', c.acknowledged_at,
      'service_agreement_version', c.service_agreement_version_snapshot
    ) order by c.issued_at desc)
      from public.staff_credentials c
      where c.subject_user_id_snapshot = (select auth.uid())), '[]'::jsonb)
  );
$$;
revoke all on function public.chowk_reporter_status() from public, anon;
grant execute on function public.chowk_reporter_status() to authenticated;
