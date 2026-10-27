do $$
declare
  reference_record record;
begin
  for reference_record in
    select constraint_row.conrelid::regclass as table_name,
           constraint_row.conname as constraint_name,
           attribute.attname as column_name
    from pg_constraint constraint_row
    join pg_attribute attribute
      on attribute.attrelid = constraint_row.conrelid
     and attribute.attnum = constraint_row.conkey[1]
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.profiles'::regclass
      and constraint_row.confdeltype = 'r'
      and array_length(constraint_row.conkey, 1) = 1
      and attribute.attname = 'user_id'
  loop
    execute format(
      'alter table %s drop constraint %I',
      reference_record.table_name,
      reference_record.constraint_name
    );
    execute format(
      'alter table %s add constraint %I foreign key (%I) references public.profiles(id) on delete cascade',
      reference_record.table_name,
      reference_record.constraint_name,
      reference_record.column_name
    );
  end loop;
end;
$$;

alter table public.reporter_service_agreement_acceptances
  drop constraint if exists reporter_service_agreement_acceptances_issue_id_fkey;
alter table public.reporter_service_agreement_acceptances
  add constraint reporter_service_agreement_acceptances_issue_id_fkey
  foreign key (issue_id)
  references public.reporter_service_agreement_issues(id)
  on delete cascade;

create or replace function public.chowk_admin_user_deletion_assets(target_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_role text;
  target_role text;
  application_paths text[];
  agreement_paths text[];
begin
  select role into actor_role
  from public.profiles
  where id = actor;
  if actor is null or actor_role is null
      or actor_role not in ('admin', 'super_admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if target_user is null or target_user = actor then
    raise exception 'You cannot delete your own account' using errcode = '22023';
  end if;

  select role into target_role
  from public.profiles
  where id = target_user;
  if target_role is null then
    raise exception 'User account not found' using errcode = 'P0002';
  end if;
  if target_role = 'super_admin' then
    raise exception 'Super admin accounts cannot be deleted here' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct storage_path), array[]::text[])
  into application_paths
  from public.reporter_application_documents
  where user_id = target_user;

  select coalesce(array_agg(distinct document_path), array[]::text[])
  into agreement_paths
  from (
    select document_storage_path as document_path
    from public.reporter_agreement_acceptances
    where user_id = target_user
      and document_storage_path is not null
    union
    select document_storage_path
    from public.reporter_service_agreement_acceptances
    where user_id = target_user
      and document_storage_path is not null
    union
    select document_storage_path
    from public.reporter_service_agreement_issues
    where user_id = target_user
  ) user_documents;

  return jsonb_build_object(
    'user_id', target_user,
    'role', target_role,
    'application_document_paths', to_jsonb(application_paths),
    'agreement_document_paths', to_jsonb(agreement_paths)
  );
end;
$$;

revoke all on function public.chowk_admin_user_deletion_assets(uuid)
  from public, anon;
grant execute on function public.chowk_admin_user_deletion_assets(uuid)
  to authenticated;
