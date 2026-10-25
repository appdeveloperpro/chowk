alter table public.reporter_application_private_details
  add column if not exists coverage_area_id bigint
  constraint reporter_application_private_details_coverage_area_id_fkey
  references public.locations(id) on delete restrict;

alter function public.chowk_submit_reporter_application_with_private_details(
  bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb
) rename to chowk_submit_reporter_application_with_private_details_base_0033;

revoke all on function public.chowk_submit_reporter_application_with_private_details_base_0033(
  bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb
) from public, anon, authenticated;

create or replace function public.chowk_submit_reporter_application_with_private_details(
  target_state bigint,
  target_rto bigint,
  target_type bigint,
  accepted_version text,
  accepted_sha256 text,
  signer_name text,
  acceptance_statement text,
  details_confirmed boolean,
  target_document_sha256 text,
  target_document_path text,
  private_details jsonb,
  application_documents jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  applicant uuid := (select auth.uid());
  selected_coverage_area_id bigint;
  submitted_application_id bigint;
begin
  if applicant is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  if jsonb_typeof(private_details) is distinct from 'object'
      or coalesce(private_details ->> 'coverage_area_id', '') !~ '^[1-9][0-9]{0,18}$' then
    raise exception 'Choose an active Coverage Area within the selected District'
      using errcode = '22023';
  end if;
  selected_coverage_area_id := (private_details ->> 'coverage_area_id')::bigint;

  if not exists (
    select 1
    from public.locations coverage_area
    join public.rto_offices office
      on office.location_id = coverage_area.parent_id
     and office.id = target_rto
     and office.state_id = target_state
     and office.is_active
    where coverage_area.id = selected_coverage_area_id
      and coverage_area.location_type = 'coverage_area'
      and coverage_area.is_active
  ) then
    raise exception 'Choose an active Coverage Area within the selected District'
      using errcode = '23514';
  end if;

  submitted_application_id := public.chowk_submit_reporter_application_with_private_details_base_0033(
    target_state,
    target_rto,
    target_type,
    accepted_version,
    accepted_sha256,
    signer_name,
    acceptance_statement,
    details_confirmed,
    target_document_sha256,
    target_document_path,
    private_details,
    application_documents
  );

  update public.reporter_application_private_details
  set coverage_area_id = selected_coverage_area_id
  where application_id = submitted_application_id
    and user_id = applicant;

  return submitted_application_id;
end;
$$;

revoke all on function public.chowk_submit_reporter_application_with_private_details(
  bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb
) from public, anon;
grant execute on function public.chowk_submit_reporter_application_with_private_details(
  bigint,bigint,bigint,text,text,text,text,boolean,text,text,jsonb,jsonb
) to authenticated;
