create or replace function public.chowk_admin_review_reporter_application_with_designation(
  target_application bigint,
  decision text,
  note text,
  signer_name text,
  signer_designation text,
  signature_accepted boolean,
  requested_fields jsonb,
  target_designation bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(requested_fields) is distinct from 'array' then
    raise exception 'Review requests must be provided as a list'
      using errcode = '22023';
  end if;
  if decision = 'needs_information' and jsonb_array_length(requested_fields) = 0 then
    raise exception 'Select at least one field to request. If no changes are needed, choose Approve.'
      using errcode = '22023';
  end if;

  if decision = 'approved' then
    if target_designation is null then
      raise exception 'Choose a reporter designation before approving the application'
        using errcode = '22023';
    end if;
    perform public.chowk_admin_set_reporter_designation(target_application, target_designation);
  end if;

  perform public.chowk_admin_review_reporter_application(
    target_application,
    decision,
    note,
    signer_name,
    signer_designation,
    signature_accepted,
    requested_fields
  );
end;
$$;

revoke all on function public.chowk_admin_review_reporter_application_with_designation(
  bigint, text, text, text, text, boolean, jsonb, bigint
) from public, anon;
grant execute on function public.chowk_admin_review_reporter_application_with_designation(
  bigint, text, text, text, text, boolean, jsonb, bigint
) to authenticated;
