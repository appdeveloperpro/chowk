create or replace function public.chowk_admin_delete_reporter_service_agreement(target_agreement bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement_row public.reporter_service_agreement_versions%rowtype;
begin
  if (select auth.uid()) is null
      or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select * into agreement_row
  from public.reporter_service_agreement_versions
  where id = target_agreement
  for update;
  if not found then
    raise exception 'Service agreement version not found' using errcode = 'P0002';
  end if;
  if agreement_row.status = 'published' then
    raise exception 'Archive the published service agreement before deleting it' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.reporter_service_agreement_acceptances acceptance
    where acceptance.agreement_version = agreement_row.version
      and acceptance.agreement_sha256 = agreement_row.sha256
  ) or exists (
    select 1 from public.reporter_service_agreement_issues issue
    where issue.agreement_version = agreement_row.version
      and issue.agreement_sha256 = agreement_row.sha256
  ) or exists (
    select 1 from public.reporter_applications application
    where application.service_agreement_version = agreement_row.version
  ) or exists (
    select 1 from public.staff_credentials credential
    where credential.service_agreement_version_snapshot = agreement_row.version
  ) then
    raise exception 'This version has reporter history and cannot be deleted; archive it to preserve the legal record'
      using errcode = '23514';
  end if;

  delete from public.reporter_service_agreement_versions
  where id = target_agreement;
  return agreement_row.storage_object_path;
end;
$$;
revoke all on function public.chowk_admin_delete_reporter_service_agreement(bigint) from public, anon;
grant execute on function public.chowk_admin_delete_reporter_service_agreement(bigint) to authenticated;
