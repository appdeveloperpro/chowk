alter table public.staff_onboarding
  drop constraint if exists staff_onboarding_status_check;
alter table public.staff_onboarding
  add constraint staff_onboarding_status_check
  check (status in (
    'invited', 'submitted', 'changes_requested', 'approved_pending_agreement', 'active', 'rejected'
  ));

create table if not exists public.staff_role_agreement_terms (
  role text primary key check (role in ('moderator', 'editor')),
  terms jsonb not null default '{}'::jsonb check (jsonb_typeof(terms) = 'object'),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.staff_role_agreement_terms(role, terms)
values ('moderator', '{}'::jsonb), ('editor', '{}'::jsonb)
on conflict (role) do nothing;

create table if not exists public.staff_role_agreement_versions (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('moderator', 'editor')),
  version text not null check (version ~ '^[A-Za-z0-9._-]{1,40}$'),
  template_content text not null check (length(template_content) between 1 and 50000),
  terms_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(terms_snapshot) = 'object'),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  published_by uuid,
  published_at timestamptz,
  unique (role, version)
);

create unique index if not exists staff_role_agreement_one_published_per_role
  on public.staff_role_agreement_versions(role) where status = 'published';
create index if not exists staff_role_agreement_versions_role_created_idx
  on public.staff_role_agreement_versions(role, created_at desc);

create table if not exists public.staff_role_agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role text not null check (role in ('moderator', 'editor')),
  agreement_version_id uuid not null references public.staff_role_agreement_versions(id) on delete restrict,
  agreement_version text not null,
  agreement_sha256 text not null check (agreement_sha256 ~ '^[a-f0-9]{64}$'),
  template_snapshot text not null,
  terms_snapshot jsonb not null check (jsonb_typeof(terms_snapshot) = 'object'),
  accepted_at timestamptz not null default now(),
  unique (user_id, role, agreement_version_id)
);

create index if not exists staff_role_agreement_acceptances_user_idx
  on public.staff_role_agreement_acceptances(user_id, role, accepted_at desc);

alter table public.staff_role_agreement_terms enable row level security;
alter table public.staff_role_agreement_versions enable row level security;
alter table public.staff_role_agreement_acceptances enable row level security;

drop policy if exists "Admins read staff agreement terms"
  on public.staff_role_agreement_terms;
create policy "Admins read staff agreement terms"
  on public.staff_role_agreement_terms for select to authenticated
  using ((select public.chowk_has_any_role(array['admin', 'super_admin'])));

drop policy if exists "Members and admins read published staff agreements"
  on public.staff_role_agreement_versions;
create policy "Members and admins read published staff agreements"
  on public.staff_role_agreement_versions for select to authenticated
  using (
    status = 'published'
    or (select public.chowk_has_any_role(array['admin', 'super_admin']))
  );

drop policy if exists "Members and admins read staff agreement acceptances"
  on public.staff_role_agreement_acceptances;
create policy "Members and admins read staff agreement acceptances"
  on public.staff_role_agreement_acceptances for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.chowk_has_any_role(array['admin', 'super_admin']))
  );

revoke all on public.staff_role_agreement_terms,
  public.staff_role_agreement_versions,
  public.staff_role_agreement_acceptances from anon, authenticated;
grant select on public.staff_role_agreement_terms,
  public.staff_role_agreement_versions,
  public.staff_role_agreement_acceptances to authenticated;

create or replace function public.chowk_protect_staff_role_agreement_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
      or new.version is distinct from old.version
      or new.template_content is distinct from old.template_content
      or new.terms_snapshot is distinct from old.terms_snapshot
      or new.sha256 is distinct from old.sha256
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
    raise exception 'Agreement wording and snapshots are immutable; create a new version'
      using errcode = '23514';
  end if;
  if old.status <> 'draft' and new.status is distinct from old.status
      and not (old.status = 'published' and new.status = 'archived') then
    raise exception 'Only a draft can be published and published versions can only be archived'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists chowk_protect_staff_role_agreement_version
  on public.staff_role_agreement_versions;
create trigger chowk_protect_staff_role_agreement_version
  before update on public.staff_role_agreement_versions
  for each row execute function public.chowk_protect_staff_role_agreement_version();

create or replace function public.chowk_protect_staff_role_agreement_acceptance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Staff agreement acceptances are immutable'
    using errcode = '23514';
end;
$$;

drop trigger if exists chowk_protect_staff_role_agreement_acceptance
  on public.staff_role_agreement_acceptances;
create trigger chowk_protect_staff_role_agreement_acceptance
  before update or delete on public.staff_role_agreement_acceptances
  for each row execute function public.chowk_protect_staff_role_agreement_acceptance();

create or replace function public.chowk_admin_set_staff_role_agreement_terms(
  target_role text,
  target_terms jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  term_item record;
begin
  if (select auth.uid()) is null
      or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if target_role not in ('moderator', 'editor')
      or jsonb_typeof(target_terms) is distinct from 'object'
      or jsonb_object_length(target_terms) > 100 then
    raise exception 'Choose a supported role and provide a structured terms object'
      using errcode = '22023';
  end if;
  for term_item in select key, value from jsonb_each(target_terms)
  loop
    if term_item.key !~ '^[a-z][a-z0-9_]{0,49}$'
        or jsonb_typeof(term_item.value) is distinct from 'string'
        or length(term_item.value #>> '{}') > 5000 then
      raise exception 'Term keys must be short identifiers and values must be text up to 5,000 characters'
        using errcode = '22023';
    end if;
  end loop;
  insert into public.staff_role_agreement_terms(role, terms, updated_by, updated_at)
  values (target_role, target_terms, (select auth.uid()), now())
  on conflict (role) do update
  set terms = excluded.terms, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.chowk_admin_set_staff_role_agreement_terms(text, jsonb)
  from public, anon;
grant execute on function public.chowk_admin_set_staff_role_agreement_terms(text, jsonb)
  to authenticated;

create or replace function public.chowk_superadmin_save_staff_role_agreement_draft(
  target_role text,
  target_version text,
  target_template text,
  target_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  current_terms jsonb;
begin
  if (select role from public.profiles where id = (select auth.uid())) is distinct from 'super_admin' then
    raise exception 'Only a super admin can edit agreement wording' using errcode = '42501';
  end if;
  if target_role not in ('moderator', 'editor')
      or target_version !~ '^[A-Za-z0-9._-]{1,40}$'
      or length(trim(coalesce(target_template, ''))) = 0
      or length(target_template) > 50000
      or target_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Provide a role, version label, non-empty template, and SHA-256 digest'
      using errcode = '22023';
  end if;
  select terms into current_terms from public.staff_role_agreement_terms where role = target_role;
  insert into public.staff_role_agreement_versions(
    role, version, template_content, terms_snapshot, sha256, created_by
  )
  values (
    target_role, target_version, target_template, coalesce(current_terms, '{}'::jsonb),
    target_sha256, (select auth.uid())
  )
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.chowk_superadmin_save_staff_role_agreement_draft(text, text, text, text)
  from public, anon;
grant execute on function public.chowk_superadmin_save_staff_role_agreement_draft(text, text, text, text)
  to authenticated;

create or replace function public.chowk_superadmin_publish_staff_role_agreement(target_version uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement public.staff_role_agreement_versions%rowtype;
begin
  if (select role from public.profiles where id = (select auth.uid())) is distinct from 'super_admin' then
    raise exception 'Only a super admin can publish agreement wording' using errcode = '42501';
  end if;
  select * into agreement
  from public.staff_role_agreement_versions
  where id = target_version and status = 'draft'
  for update;
  if not found or length(trim(agreement.template_content)) = 0 then
    raise exception 'A non-empty draft agreement is required before publishing' using errcode = '23514';
  end if;
  update public.staff_role_agreement_versions
  set status = 'archived'
  where role = agreement.role and status = 'published';
  update public.staff_role_agreement_versions
  set status = 'published', published_by = (select auth.uid()), published_at = now()
  where id = target_version;
end;
$$;

revoke all on function public.chowk_superadmin_publish_staff_role_agreement(uuid)
  from public, anon;
grant execute on function public.chowk_superadmin_publish_staff_role_agreement(uuid)
  to authenticated;

create or replace function public.chowk_accept_current_staff_role_agreement(
  target_version uuid,
  target_sha256 text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  applicant uuid := (select auth.uid());
  onboarding public.staff_onboarding%rowtype;
  agreement public.staff_role_agreement_versions%rowtype;
begin
  if applicant is null then
    raise exception 'Sign in to accept the staff agreement' using errcode = '42501';
  end if;
  select * into onboarding
  from public.staff_onboarding
  where user_id = applicant
    and status in ('invited', 'submitted', 'changes_requested', 'approved_pending_agreement')
  for update;
  if not found then
    raise exception 'No eligible staff onboarding record was found' using errcode = '42501';
  end if;
  select * into agreement
  from public.staff_role_agreement_versions
  where id = target_version
    and role = onboarding.requested_role
    and status = 'published'
    and sha256 = target_sha256;
  if not found then
    raise exception 'Review and accept the currently published agreement for your role'
      using errcode = '23514';
  end if;
  insert into public.staff_role_agreement_acceptances(
    user_id, role, agreement_version_id, agreement_version, agreement_sha256,
    template_snapshot, terms_snapshot
  )
  values (
    applicant, onboarding.requested_role, agreement.id, agreement.version, agreement.sha256,
    agreement.template_content, agreement.terms_snapshot
  )
  on conflict (user_id, role, agreement_version_id) do nothing;

  if onboarding.status = 'approved_pending_agreement' then
    update public.profiles set role = onboarding.requested_role where id = applicant and role = 'subscriber';
    if not found then
      raise exception 'Staff account role could not be activated' using errcode = '23514';
    end if;
    update public.staff_onboarding
    set status = 'active', updated_at = now()
    where user_id = applicant and status = 'approved_pending_agreement';
  end if;
end;
$$;

revoke all on function public.chowk_accept_current_staff_role_agreement(uuid, text)
  from public, anon;
grant execute on function public.chowk_accept_current_staff_role_agreement(uuid, text)
  to authenticated;

create or replace function public.chowk_admin_review_staff_onboarding(
  target_user uuid,
  decision text,
  review_message text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  onboarding public.staff_onboarding%rowtype;
  note_value text := trim(coalesce(review_message, ''));
  current_agreement_id uuid;
  current_agreement_sha256 text;
begin
  if actor is null
      or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if decision not in ('approve', 'request_changes', 'reject') then
    raise exception 'Choose approve, request changes, or reject' using errcode = '22023';
  end if;
  if decision in ('request_changes', 'reject') and length(note_value) not between 5 and 1000 then
    raise exception 'Provide a review note between 5 and 1,000 characters' using errcode = '22023';
  end if;
  select * into onboarding
  from public.staff_onboarding
  where user_id = target_user and status = 'submitted'
  for update;
  if not found then
    raise exception 'Submitted staff profile not found' using errcode = 'P0002';
  end if;

  if decision = 'approve' then
    select id, sha256 into current_agreement_id, current_agreement_sha256
    from public.staff_role_agreement_versions
    where role = onboarding.requested_role and status = 'published'
    order by published_at desc
    limit 1;
    if current_agreement_id is not null and exists (
      select 1 from public.staff_role_agreement_acceptances
      where user_id = target_user
        and role = onboarding.requested_role
        and agreement_version_id = current_agreement_id
        and agreement_sha256 = current_agreement_sha256
    ) then
      update public.profiles set role = onboarding.requested_role where id = target_user;
      update public.staff_onboarding
      set status = 'active', review_note = '', reviewed_by = actor, reviewed_at = now(), updated_at = now()
      where user_id = target_user;
    else
      update public.staff_onboarding
      set status = 'approved_pending_agreement', review_note = '',
          reviewed_by = actor, reviewed_at = now(), updated_at = now()
      where user_id = target_user;
    end if;
  elsif decision = 'request_changes' then
    update public.staff_onboarding
    set status = 'changes_requested', review_note = note_value,
        reviewed_by = actor, reviewed_at = now(), updated_at = now()
    where user_id = target_user;
  else
    update public.staff_onboarding
    set status = 'rejected', review_note = note_value,
        reviewed_by = actor, reviewed_at = now(), updated_at = now()
    where user_id = target_user;
  end if;
end;
$$;

revoke all on function public.chowk_admin_review_staff_onboarding(uuid, text, text)
  from public, anon;
grant execute on function public.chowk_admin_review_staff_onboarding(uuid, text, text)
  to authenticated;

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
  if (select role from public.profiles where id = (select auth.uid())) is distinct from 'super_admin' then
    raise exception 'Only a super admin can publish agreement wording' using errcode = '42501';
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

create or replace function public.chowk_admin_publish_reporter_agreement(target_agreement bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select role from public.profiles where id = (select auth.uid())) is distinct from 'super_admin' then
    raise exception 'Only a super admin can publish agreement wording' using errcode = '42501';
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
  if not found then
    raise exception 'Draft reporter agreement not found' using errcode = 'P0002';
  end if;
  update public.reporter_agreement_versions
  set status = 'archived'
  where status = 'published' and id <> target_agreement;
  update public.reporter_agreement_versions
  set status = 'published', published_by = (select auth.uid()), published_at = now()
  where id = target_agreement;
end;
$$;
revoke all on function public.chowk_admin_publish_reporter_agreement(bigint)
  from public, anon;
grant execute on function public.chowk_admin_publish_reporter_agreement(bigint)
  to authenticated;

revoke update on public.reporter_organization_profile from authenticated;
grant update (
  legal_name, trade_name, entity_type, registered_address, registration_number,
  official_email, official_phone, website_url, is_verified, updated_by,
  agreement_record_retention_period, agreement_record_production_deadline,
  agreement_payment_deadline, agreement_payment_cycle,
  agreement_legal_cost_reimbursement_deadline, agreement_reporter_liability_summary,
  agreement_story_exclusivity_period, agreement_term_period,
  agreement_termination_notice_period, agreement_company_liability_lookback_period,
  agreement_arbitrator_appointment_method, agreement_arbitration_language,
  agreement_controlling_language, agreement_fee_terms, agreement_insurance_terms
) on public.reporter_organization_profile to authenticated;

create or replace function public.chowk_superadmin_set_reporter_liability_clause(target_clause text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select role from public.profiles where id = (select auth.uid())) is distinct from 'super_admin' then
    raise exception 'Only a super admin can change agreement wording' using errcode = '42501';
  end if;
  if length(trim(coalesce(target_clause, ''))) not between 1 and 2000 then
    raise exception 'Provide approved liability wording up to 2,000 characters'
      using errcode = '22023';
  end if;
  update public.reporter_organization_profile
  set agreement_reporter_liability_clause = trim(target_clause),
      updated_by = (select auth.uid())
  where id is true;
  if not found then
    raise exception 'The reporter organization profile could not be found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.chowk_superadmin_set_reporter_liability_clause(text)
  from public, anon;
grant execute on function public.chowk_superadmin_set_reporter_liability_clause(text)
  to authenticated;

drop policy if exists "Admins manage reporter agreements"
  on public.reporter_agreement_versions;
drop policy if exists "Admins manage service agreements"
  on public.reporter_service_agreement_versions;

create policy "Super admins insert reporter agreement wording"
  on public.reporter_agreement_versions for insert to authenticated
  with check ((select public.chowk_has_any_role(array['super_admin'])));
create policy "Super admins update reporter agreement wording"
  on public.reporter_agreement_versions for update to authenticated
  using ((select public.chowk_has_any_role(array['super_admin'])))
  with check ((select public.chowk_has_any_role(array['super_admin'])));
create policy "Super admins delete reporter agreement wording"
  on public.reporter_agreement_versions for delete to authenticated
  using ((select public.chowk_has_any_role(array['super_admin'])));

create policy "Super admins insert reporter service agreement wording"
  on public.reporter_service_agreement_versions for insert to authenticated
  with check ((select public.chowk_has_any_role(array['super_admin'])));
create policy "Super admins update reporter service agreement wording"
  on public.reporter_service_agreement_versions for update to authenticated
  using ((select public.chowk_has_any_role(array['super_admin'])))
  with check ((select public.chowk_has_any_role(array['super_admin'])));
create policy "Super admins delete reporter service agreement wording"
  on public.reporter_service_agreement_versions for delete to authenticated
  using ((select public.chowk_has_any_role(array['super_admin'])));
