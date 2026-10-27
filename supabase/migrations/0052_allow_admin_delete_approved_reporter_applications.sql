create or replace function public.chowk_admin_delete_reporter_application(
  target_application bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  application_row public.reporter_applications%rowtype;
  application_document_paths text[];
  agreement_document_paths text[];
begin
  if actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select * into application_row
  from public.reporter_applications
  where id = target_application
  for update;
  if not found then
    raise exception 'Reporter application not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(storage_path), array[]::text[])
  into application_document_paths
  from public.reporter_application_documents
  where application_id = target_application;

  select coalesce(array_agg(distinct document_path), array[]::text[])
  into agreement_document_paths
  from (
    select document_storage_path as document_path
    from public.reporter_agreement_acceptances
    where application_id = target_application
      and document_storage_path is not null
    union
    select acceptance.document_storage_path
    from public.reporter_service_agreement_acceptances acceptance
    join public.reporter_service_agreement_issues issue
      on issue.id = acceptance.issue_id
    where issue.application_id = target_application
      and acceptance.document_storage_path is not null
    union
    select document_storage_path
    from public.reporter_service_agreement_issues
    where application_id = target_application
  ) agreement_documents;

  update public.staff_credentials
  set status = 'revoked',
      revoked_by = actor,
      revoked_at = now(),
      revoked_reason = 'Reporter application deleted by an administrator'
  where subject_user_id_snapshot = application_row.user_id
    and status <> 'revoked';

  update public.reporter_assignments
  set effective_to = greatest(now(), effective_from + interval '1 microsecond')
  where user_id = application_row.user_id
    and effective_to is null;

  update public.user_coverage_assignments
  set valid_to = greatest(now(), valid_from + interval '1 microsecond')
  where user_id = application_row.user_id
    and valid_to is null;

  delete from public.reporter_profiles
  where user_id = application_row.user_id;

  update public.profiles
  set role = 'subscriber'
  where id = application_row.user_id
    and role = 'reporter';

  delete from public.reporter_applications
  where id = target_application;

  return jsonb_build_object(
    'application_id', target_application,
    'user_id', application_row.user_id,
    'application_document_paths', to_jsonb(application_document_paths),
    'agreement_document_paths', to_jsonb(agreement_document_paths)
  );
end;
$$;

revoke all on function public.chowk_admin_delete_reporter_application(bigint)
  from public, anon;
grant execute on function public.chowk_admin_delete_reporter_application(bigint)
  to authenticated;
