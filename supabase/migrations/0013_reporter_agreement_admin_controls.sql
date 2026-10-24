alter table public.reporter_agreement_versions
  add column if not exists storage_object_path text;
alter table public.reporter_service_agreement_versions
  add column if not exists storage_object_path text;

alter table public.reporter_agreement_versions
  drop constraint if exists reporter_agreement_storage_object_path_check;
alter table public.reporter_agreement_versions
  add constraint reporter_agreement_storage_object_path_check
  check (storage_object_path is null or storage_object_path ~ '^application/[0-9a-f-]{36}\.pdf$');
alter table public.reporter_service_agreement_versions
  drop constraint if exists reporter_service_agreement_storage_object_path_check;
alter table public.reporter_service_agreement_versions
  add constraint reporter_service_agreement_storage_object_path_check
  check (storage_object_path is null or storage_object_path ~ '^service/[0-9a-f-]{36}\.pdf$');

revoke update, delete on public.reporter_agreement_versions,
  public.reporter_service_agreement_versions from authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'chowk-reporter-agreements',
  'chowk-reporter-agreements',
  false,
  8388608,
  array['application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public reporter agreement documents are readable" on storage.objects;
drop policy if exists "Admins view reporter agreement documents" on storage.objects;
create policy "Admins view reporter agreement documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chowk-reporter-agreements'
    and (select public.chowk_has_any_role(array['admin', 'super_admin']))
  );
drop policy if exists "Published or accepted reporter agreements are readable" on storage.objects;
drop policy if exists "Published reporter agreement documents are readable" on storage.objects;
create policy "Published reporter agreement documents are readable"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'chowk-reporter-agreements'
    and (
      exists (
        select 1 from public.reporter_agreement_versions agreement
        where agreement.storage_object_path = storage.objects.name
          and agreement.status = 'published'
      )
      or exists (
        select 1 from public.reporter_service_agreement_versions agreement
        where agreement.storage_object_path = storage.objects.name
          and agreement.status = 'published'
      )
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
    )
  );

drop policy if exists "Users view accepted reporter agreement versions"
  on public.reporter_agreement_versions;
create policy "Users view accepted reporter agreement versions"
  on public.reporter_agreement_versions for select to authenticated
  using (
    exists (
      select 1 from public.reporter_agreement_acceptances acceptance
      where acceptance.user_id = (select auth.uid())
        and acceptance.agreement_version = reporter_agreement_versions.version
        and acceptance.agreement_sha256 = reporter_agreement_versions.sha256
    )
  );

drop policy if exists "Users view accepted reporter service agreement versions"
  on public.reporter_service_agreement_versions;
create policy "Users view accepted reporter service agreement versions"
  on public.reporter_service_agreement_versions for select to authenticated
  using (
    exists (
      select 1 from public.reporter_service_agreement_acceptances acceptance
      where acceptance.user_id = (select auth.uid())
        and acceptance.agreement_version = reporter_service_agreement_versions.version
        and acceptance.agreement_sha256 = reporter_service_agreement_versions.sha256
    )
  );

drop policy if exists "Admins upload reporter agreement documents" on storage.objects;
create policy "Admins upload reporter agreement documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chowk-reporter-agreements'
    and (select public.chowk_has_any_role(array['admin', 'super_admin']))
  );

drop policy if exists "Admins replace reporter agreement drafts" on storage.objects;
drop policy if exists "Admins remove reporter agreement documents" on storage.objects;
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
  );

create or replace function public.chowk_protect_reporter_agreement_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version is distinct from old.version
      or new.sha256 is distinct from old.sha256
      or new.document_url is distinct from old.document_url
      or new.storage_object_path is distinct from old.storage_object_path
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
    raise exception 'Agreement content and version metadata are immutable; create a new version instead'
      using errcode = '23514';
  end if;
  if old.status = 'archived' or new.status not in ('draft', 'published', 'archived') then
    raise exception 'Archived agreement versions cannot be changed' using errcode = '23514';
  end if;
  if old.status = 'published' and new.status = 'draft' then
    raise exception 'Published agreement versions cannot return to draft' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists chowk_protect_reporter_agreement_version
  on public.reporter_agreement_versions;
create trigger chowk_protect_reporter_agreement_version
  before update on public.reporter_agreement_versions
  for each row execute function public.chowk_protect_reporter_agreement_version();

drop trigger if exists chowk_protect_reporter_service_agreement_version
  on public.reporter_service_agreement_versions;
create trigger chowk_protect_reporter_service_agreement_version
  before update on public.reporter_service_agreement_versions
  for each row execute function public.chowk_protect_reporter_agreement_version();

create or replace function public.chowk_admin_publish_reporter_agreement(target_agreement bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
      or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.reporter_organization_profile
    where id and is_verified
  ) then
    raise exception 'Verify the organization legal profile before publishing reporter agreements'
      using errcode = '23514';
  end if;
  perform 1 from public.reporter_agreement_versions
  where id = target_agreement and status in ('draft', 'published') for update;
  if not found then raise exception 'Draft reporter agreement not found' using errcode = 'P0002'; end if;
  update public.reporter_agreement_versions
  set status = 'archived'
  where status = 'published' and id <> target_agreement;
  update public.reporter_agreement_versions
  set status = 'published', published_by = (select auth.uid()), published_at = now()
  where id = target_agreement;
end;
$$;
revoke all on function public.chowk_admin_publish_reporter_agreement(bigint) from public, anon;
grant execute on function public.chowk_admin_publish_reporter_agreement(bigint) to authenticated;

create or replace function public.chowk_admin_archive_reporter_agreement(target_agreement bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
      or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  update public.reporter_agreement_versions
  set status = 'archived'
  where id = target_agreement and status in ('draft', 'published');
  if not found then
    raise exception 'Active reporter agreement version not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.chowk_admin_archive_reporter_agreement(bigint) from public, anon;
grant execute on function public.chowk_admin_archive_reporter_agreement(bigint) to authenticated;

create or replace function public.chowk_admin_archive_reporter_service_agreement(target_agreement bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
      or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  update public.reporter_service_agreement_versions
  set status = 'archived'
  where id = target_agreement and status in ('draft', 'published');
  if not found then
    raise exception 'Active reporter service agreement version not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.chowk_admin_archive_reporter_service_agreement(bigint) from public, anon;
grant execute on function public.chowk_admin_archive_reporter_service_agreement(bigint) to authenticated;
