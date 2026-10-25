alter table public.reporter_service_agreement_versions
  add column if not exists template_content text;

alter table public.reporter_service_agreement_acceptances
  add column if not exists generated_document_sha256 text,
  add column if not exists document_storage_path text;

alter table public.reporter_service_agreement_acceptances
  drop constraint if exists reporter_service_acceptance_generated_document_sha256_check;
alter table public.reporter_service_agreement_acceptances
  add constraint reporter_service_acceptance_generated_document_sha256_check
  check (generated_document_sha256 is null or generated_document_sha256 ~ '^[a-f0-9]{64}$');
alter table public.reporter_service_agreement_acceptances
  drop constraint if exists reporter_service_acceptance_document_storage_path_check;
alter table public.reporter_service_agreement_acceptances
  add constraint reporter_service_acceptance_document_storage_path_check
  check (
    document_storage_path is null
    or document_storage_path ~ (
      '^acceptance/' || user_id::text || '/[0-9a-f-]{36}\.pdf$'
    )
  );
alter table public.reporter_service_agreement_acceptances
  drop constraint if exists reporter_service_acceptance_document_pair_check;
alter table public.reporter_service_agreement_acceptances
  add constraint reporter_service_acceptance_document_pair_check
  check ((generated_document_sha256 is null) = (document_storage_path is null));

create or replace function public.chowk_protect_reporter_service_agreement_template()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.template_content is distinct from old.template_content then
    raise exception 'Published service agreement templates are immutable; create a new version instead'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists chowk_protect_reporter_service_agreement_template
  on public.reporter_service_agreement_versions;
create trigger chowk_protect_reporter_service_agreement_template
  before update on public.reporter_service_agreement_versions
  for each row execute function public.chowk_protect_reporter_service_agreement_template();

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
  if agreement_row.template_content is not null then
    if not exists (
      select 1 from public.reporter_organization_profile
      where id and is_verified
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
      '\{\{(agreement\.date|company\.(entity_type|legal_name|registered_address|registration_number|trade_name)|reporter\.(city|email|full_name|phone|reporter_code|rto|state|type|father_first_name|father_last_name|permanent_address|permanent_address_line1|permanent_address_line2|permanent_address_city|permanent_address_district|permanent_address_state|permanent_address_postal_code|date_of_birth|mobile_number))\}\}',
      '',
      'g'
    );
    if remaining_tokens ~ '\{\{[^}]+\}\}' then
      raise exception 'The service agreement contains an unknown server template field'
        using errcode = '23514';
    end if;
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

create or replace function public.chowk_accept_current_reporter_service_agreement(
  accepted_version text,
  accepted_sha256 text,
  signer_name text,
  acceptance_statement text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  applicant uuid := (select auth.uid());
  application_row public.reporter_applications%rowtype;
  agreement public.reporter_service_agreement_versions%rowtype;
begin
  if applicant is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  select * into application_row
  from public.reporter_applications
  where user_id = applicant
  for update;
  if not found or application_row.status not in ('approved', 'active') then
    raise exception 'Only an approved or active reporter can accept reporter service terms'
      using errcode = '23514';
  end if;
  select * into agreement
  from public.reporter_service_agreement_versions
  where status = 'published'
  for share;
  if not found or accepted_version is distinct from agreement.version
      or accepted_sha256 is distinct from agreement.sha256 then
    raise exception 'The service agreement changed. Review and accept the current version.'
      using errcode = '23514';
  end if;
  if agreement.template_content is not null then
    raise exception 'Use the personalized service agreement acceptance flow for this version'
      using errcode = '23514';
  end if;
  if length(trim(coalesce(signer_name, ''))) < 2
      or lower(trim(coalesce(signer_name, '')))
        <> lower(trim((select full_name from public.profiles where id = applicant)))
      or length(trim(coalesce(acceptance_statement, ''))) < 10 then
    raise exception 'Enter your account name and explicit service agreement acceptance'
      using errcode = '22023';
  end if;
  update public.reporter_applications set
    service_agreement_version = agreement.version,
    service_agreement_sha256 = agreement.sha256,
    service_agreement_document_url = agreement.document_url,
    service_agreement_signer_name = trim(signer_name),
    service_agreement_accepted_at = now()
  where id = application_row.id;
  insert into public.reporter_service_agreement_acceptances(
    application_id, user_id, agreement_version, agreement_sha256, signer_name, acceptance_statement
  ) values (
    application_row.id, applicant, agreement.version, agreement.sha256,
    trim(signer_name), trim(acceptance_statement)
  );
end;
$$;
revoke all on function public.chowk_accept_current_reporter_service_agreement(
  text,text,text,text
) from public, anon;
grant execute on function public.chowk_accept_current_reporter_service_agreement(
  text,text,text,text
) to authenticated;

create or replace function public.chowk_accept_current_reporter_service_agreement_with_document(
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
  agreement public.reporter_service_agreement_versions%rowtype;
  acceptance_id bigint;
begin
  if applicant is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  select * into application_row
  from public.reporter_applications
  where user_id = applicant
  for update;
  if not found or application_row.status not in ('approved', 'active') then
    raise exception 'Only an approved or active reporter can accept reporter service terms'
      using errcode = '23514';
  end if;
  select * into agreement
  from public.reporter_service_agreement_versions
  where status = 'published'
  for share;
  if not found or agreement.template_content is null
      or accepted_version is distinct from agreement.version
      or accepted_sha256 is distinct from agreement.sha256 then
    raise exception 'The personalized service agreement changed. Review and accept the current version.'
      using errcode = '23514';
  end if;
  if length(trim(coalesce(signer_name, ''))) < 2
      or lower(trim(coalesce(signer_name, '')))
        <> lower(trim((select full_name from public.profiles where id = applicant)))
      or length(trim(coalesce(acceptance_statement, ''))) < 10 then
    raise exception 'Enter your account name and explicit service agreement acceptance'
      using errcode = '22023';
  end if;
  if target_document_sha256 is null
      or target_document_sha256 !~ '^[a-f0-9]{64}$'
      or target_document_path is null
      or target_document_path !~ (
        '^acceptance/' || applicant::text || '/[0-9a-f-]{36}\.pdf$'
      )
      or not exists (
        select 1 from storage.objects
        where bucket_id = 'chowk-reporter-agreements'
          and name = target_document_path
      ) then
    raise exception 'The generated service agreement copy is invalid'
      using errcode = '22023';
  end if;

  insert into public.reporter_service_agreement_acceptances(
    application_id, user_id, agreement_version, agreement_sha256, signer_name,
    acceptance_statement, generated_document_sha256, document_storage_path
  ) values (
    application_row.id, applicant, agreement.version, agreement.sha256, trim(signer_name),
    trim(acceptance_statement), target_document_sha256, target_document_path
  ) returning id into acceptance_id;

  update public.reporter_applications set
    service_agreement_version = agreement.version,
    service_agreement_sha256 = agreement.sha256,
    service_agreement_document_url =
      '/api/reporter/service-agreement-accepted-document?acceptance_id=' || acceptance_id::text,
    service_agreement_signer_name = trim(signer_name),
    service_agreement_accepted_at = now()
  where id = application_row.id;
end;
$$;
revoke all on function public.chowk_accept_current_reporter_service_agreement_with_document(
  text,text,text,text,text,text
) from public, anon;
grant execute on function public.chowk_accept_current_reporter_service_agreement_with_document(
  text,text,text,text,text,text
) to authenticated;

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
      or exists (
        select 1 from public.reporter_service_agreement_acceptances acceptance
        where acceptance.document_storage_path = storage.objects.name
          and acceptance.user_id = (select auth.uid())
      )
    )
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
    and not exists (
      select 1 from public.reporter_service_agreement_acceptances acceptance
      where acceptance.document_storage_path = storage.objects.name
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
    and not exists (
      select 1 from public.reporter_service_agreement_acceptances acceptance
      where acceptance.document_storage_path = storage.objects.name
    )
  );
