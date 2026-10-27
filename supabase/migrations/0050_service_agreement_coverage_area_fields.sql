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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('chowk_reporter_service_agreement_publish')::bigint
  );

  select * into agreement_row
  from public.reporter_service_agreement_versions
  where id = target_agreement and status in ('draft', 'published')
  for update;
  if not found then
    raise exception 'Draft service agreement not found' using errcode = 'P0002';
  end if;
  if agreement_row.template_content is null then
    raise exception 'Only personalized service-agreement templates can be published'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.reporter_organization_profile
    where id is true and is_verified
  ) then
    raise exception 'Verify the organization legal profile before publishing personalized service agreements'
      using errcode = '23514';
  end if;
  if length(trim(agreement_row.template_content)) < 1000
      or agreement_row.template_content ~ '\[[^]]+\]' then
    raise exception 'Replace all square-bracket terms and complete the agreement before publishing'
      using errcode = '23514';
  end if;
  if position('{{reporter.designation}}' in agreement_row.template_content) = 0 then
    raise exception 'Add {{reporter.designation}} to the service agreement so the assigned position is included'
      using errcode = '23514';
  end if;

  remaining_tokens := regexp_replace(
    agreement_row.template_content,
    '\{\{(agreement\.date|company\.(entity_type|legal_name|official_email|official_phone|registered_address|registration_number|trade_name|website_url)|reporter\.(city|coverage_area|designation|district|email|full_name|phone|reporter_code|rto|state|father_first_name|father_last_name|permanent_address|permanent_address_line1|permanent_address_line2|permanent_address_city|permanent_address_district|permanent_address_state|permanent_address_postal_code|date_of_birth|mobile_number))\}\}',
    '',
    'g'
  );
  if remaining_tokens ~ '\{\{[^}]+\}\}' then
    raise exception 'The service agreement contains an unknown or unsupported server template field'
      using errcode = '23514';
  end if;

  update public.reporter_service_agreement_versions
  set status = 'archived'
  where status = 'published' and id <> target_agreement;
  update public.reporter_service_agreement_versions
  set status = 'published', published_by = (select auth.uid()), published_at = now()
  where id = target_agreement;
end;
$$;

revoke all on function public.chowk_admin_publish_reporter_service_agreement(bigint)
  from public, anon;
grant execute on function public.chowk_admin_publish_reporter_service_agreement(bigint)
  to authenticated;
