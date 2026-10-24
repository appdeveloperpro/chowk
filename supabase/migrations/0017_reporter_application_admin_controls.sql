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
  if application_row.status not in ('pending', 'needs_information', 'rejected') then
    raise exception 'Applications cannot be deleted after approval to preserve reporter access and credential history'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.profiles
    where id = application_row.user_id and role = 'reporter'
  ) or exists (
    select 1 from public.reporter_profiles
    where user_id = application_row.user_id
  ) or exists (
    select 1 from public.reporter_assignments
    where user_id = application_row.user_id
  ) or exists (
    select 1 from public.staff_credentials
    where subject_user_id_snapshot = application_row.user_id
  ) then
    raise exception 'This applicant has reporter access or onboarding records; use the reporter offboarding process'
      using errcode = '23514';
  end if;

  select coalesce(array_agg(storage_path), array[]::text[])
  into application_document_paths
  from public.reporter_application_documents
  where application_id = target_application;

  select coalesce(array_agg(document_storage_path), array[]::text[])
  into agreement_document_paths
  from public.reporter_agreement_acceptances
  where application_id = target_application
    and document_storage_path is not null;

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
