create or replace function public.chowk_snapshot_staff_credential_designation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  designation_name text;
  designation_code_value text;
begin
  select designation.name, designation.designation_code
  into designation_name, designation_code_value
  from public.reporter_designations designation
  where designation.id = coalesce(
    (
      select assignment.reporter_designation_id
      from public.reporter_assignments assignment
      where assignment.user_id = new.subject_user_id_snapshot
        and assignment.effective_to is null
      order by assignment.effective_from desc
      limit 1
    ),
    (
      select application.reporter_designation_id
      from public.reporter_applications application
      where application.user_id = new.subject_user_id_snapshot
        and application.status in ('approved', 'active')
      order by application.created_at desc
      limit 1
    )
  )
    and designation.is_active;

  if designation_name is not null then
    new.scope_snapshot := coalesce(new.scope_snapshot, '{}'::jsonb)
      || jsonb_build_object(
        'designation', designation_name,
        'designation_code', designation_code_value
      );
  end if;
  return new;
end;
$$;

drop trigger if exists chowk_snapshot_staff_credential_designation
  on public.staff_credentials;
create trigger chowk_snapshot_staff_credential_designation
before insert on public.staff_credentials
for each row execute function public.chowk_snapshot_staff_credential_designation();

revoke all on function public.chowk_snapshot_staff_credential_designation()
  from public, anon, authenticated;
