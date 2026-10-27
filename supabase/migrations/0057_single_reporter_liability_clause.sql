update public.reporter_organization_profile
set agreement_reporter_liability_summary = 'See Section 11.7.'
where id is true;

alter table public.reporter_organization_profile
  add constraint reporter_organization_profile_liability_reference_check_v0057
  check (
    agreement_reporter_liability_summary is not null
    and agreement_reporter_liability_summary = 'See Section 11.7.'
  );

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
  if exists (
    select 1
    from pg_catalog.unnest(array[
      '{{agreement.record_retention_period}}',
      '{{agreement.record_production_deadline}}',
      '{{agreement.payment_deadline}}',
      '{{agreement.payment_cycle}}',
      '{{agreement.legal_cost_reimbursement_deadline}}',
      '{{agreement.reporter_liability_clause}}',
      '{{agreement.story_exclusivity_period}}',
      '{{agreement.term_period}}',
      '{{agreement.termination_notice_period}}',
      '{{agreement.company_liability_lookback_period}}',
      '{{agreement.arbitrator_appointment_method}}',
      '{{agreement.arbitration_language}}',
      '{{agreement.controlling_language}}',
      '{{agreement.fee_terms}}',
      '{{agreement.insurance_terms}}'
    ]) as tokens(required_token)
    where pg_catalog.strpos(agreement_row.template_content, required_token) = 0
  ) then
    raise exception 'Include every required Admin-managed legal term in the agreement template before publishing'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.reporter_organization_profile profile
    where profile.id is true
      and agreement_row.legal_terms_snapshot is not null
      and jsonb_typeof(agreement_row.legal_terms_snapshot) = 'object'
      and nullif(trim(agreement_row.legal_terms_snapshot ->> 'agreement.record_retention_period'), '') = profile.agreement_record_retention_period
      and nullif(trim(agreement_row.legal_terms_snapshot ->> 'agreement.record_production_deadline'), '') = profile.agreement_record_production_deadline
      and nullif(trim(agreement_row.legal_terms_snapshot ->> 'agreement.payment_deadline'), '') = profile.agreement_payment_deadline
      and nullif(trim(agreement_row.legal_terms_snapshot ->> 'agreement.payment_cycle'), '') = profile.agreement_payment_cycle
      and nullif(trim(agreement_row.legal_terms_snapshot ->> 'agreement.legal_cost_reimbursement_deadline'), '') = profile.agreement_legal_cost_reimbursement_deadline
      and nullif(trim(agreement_row.legal_terms_snapshot ->> 'agreement.reporter_liability_clause'), '') = profile.agreement_reporter_liability_clause
      and nullif(trim(agreement_row.legal_terms_snapshot ->> 'agreement.reporter_liability_summary'), '') = profile.agreement_reporter_liability_summary
      and nullif(trim(agreement_row.legal_terms_snapshot ->> 'agreement.story_exclusivity_period'), '') = profile.agreement_story_exclusivity_period
      and nullif(trim(agreement_row.legal_terms_snapshot ->> 'agreement.term_period'), '') = profile.agreement_term_period
      and nullif(trim(agreement_row.legal_terms_snapshot ->> 'agreement.termination_notice_period'), '') = profile.agreement_termination_notice_period
      and nullif(trim(agreement_row.legal_terms_snapshot ->> 'agreement.company_liability_lookback_period'), '') = profile.agreement_company_liability_lookback_period
      and nullif(trim(agreement_row.legal_terms_snapshot ->> 'agreement.arbitrator_appointment_method'), '') = profile.agreement_arbitrator_appointment_method
      and nullif(trim(agreement_row.legal_terms_snapshot ->> 'agreement.arbitration_language'), '') = profile.agreement_arbitration_language
      and nullif(trim(agreement_row.legal_terms_snapshot ->> 'agreement.controlling_language'), '') = profile.agreement_controlling_language
      and nullif(trim(agreement_row.legal_terms_snapshot ->> 'agreement.fee_terms'), '') = profile.agreement_fee_terms
      and nullif(trim(agreement_row.legal_terms_snapshot ->> 'agreement.insurance_terms'), '') = profile.agreement_insurance_terms
  ) then
    raise exception 'Complete the agreement terms and save a new template draft before publishing'
      using errcode = '23514';
  end if;

  remaining_tokens := regexp_replace(
    agreement_row.template_content,
    '\{\{(agreement\.(date|record_retention_period|record_production_deadline|payment_deadline|payment_cycle|legal_cost_reimbursement_deadline|reporter_liability_clause|story_exclusivity_period|term_period|termination_notice_period|company_liability_lookback_period|arbitrator_appointment_method|arbitration_language|controlling_language|fee_terms|insurance_terms)|company\.(entity_type|legal_name|official_email|official_phone|registered_address|registration_number|trade_name|website_url)|reporter\.(city|coverage_area|designation|district|email|full_name|phone|reporter_code|rto|state|father_first_name|father_last_name|permanent_address|permanent_address_line1|permanent_address_line2|permanent_address_city|permanent_address_district|permanent_address_state|permanent_address_postal_code|date_of_birth|mobile_number))\}\}',
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
