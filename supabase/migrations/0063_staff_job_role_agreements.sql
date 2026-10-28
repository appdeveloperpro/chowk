alter table public.staff_role_agreement_terms
  drop constraint if exists staff_role_agreement_terms_role_check;
alter table public.staff_role_agreement_versions
  drop constraint if exists staff_role_agreement_versions_role_check;
alter table public.staff_role_agreement_acceptances
  drop constraint if exists staff_role_agreement_acceptances_role_check;

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
  if not exists (
    select 1 from public.staff_role_definitions where role_key = target_role
  ) or jsonb_typeof(target_terms) is distinct from 'object'
      or jsonb_object_length(target_terms) > 100 then
    raise exception 'Choose a supported staff job role and provide a structured terms object'
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
  if not exists (
    select 1 from public.staff_role_definitions where role_key = target_role
  ) or target_version !~ '^[A-Za-z0-9._-]{1,40}$'
      or length(trim(coalesce(target_template, ''))) = 0
      or length(target_template) > 50000
      or target_sha256 !~ '^[a-f0-9]{64}$'
      or encode(extensions.digest(convert_to(target_template, 'UTF8'), 'sha256'), 'hex') <> target_sha256 then
    raise exception 'Provide a supported staff job role, version label, non-empty template, and matching SHA-256 digest'
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

create or replace function public.chowk_accept_current_staff_role_agreement(
  target_version uuid,
  target_sha256 text,
  target_rendered_content text,
  target_rendered_sha256 text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  applicant uuid := (select auth.uid());
  onboarding public.staff_onboarding%rowtype;
  role_definition public.staff_role_definitions%rowtype;
  agreement public.staff_role_agreement_versions%rowtype;
  applicant_profile public.profiles%rowtype;
  resolved_copy text;
  rendered_hash text;
begin
  if applicant is null then
    raise exception 'Sign in to accept the staff agreement' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('chowk_staff_role_agreement_publish')::bigint
  );
  select * into onboarding
  from public.staff_onboarding
  where user_id = applicant
    and status in ('submitted', 'approved_pending_agreement')
  for update;
  if not found then
    raise exception 'Submit your staff profile before accepting its personalized agreement'
      using errcode = '42501';
  end if;
  select * into role_definition
  from public.staff_role_definitions
  where id = onboarding.staff_role_id and access_profile = onboarding.requested_role;
  if not found then
    raise exception 'The assigned staff job role could not be verified' using errcode = '23514';
  end if;
  select * into applicant_profile from public.profiles where id = applicant;
  if not found then
    raise exception 'Staff profile details could not be loaded' using errcode = 'P0002';
  end if;
  select * into agreement
  from public.staff_role_agreement_versions
  where id = target_version
    and role = role_definition.role_key
    and status = 'published'
    and sha256 = target_sha256;
  if not found then
    raise exception 'Review and accept the currently published agreement for your assigned job role'
      using errcode = '23514';
  end if;

  resolved_copy := public.chowk_render_staff_role_agreement(
    agreement.template_content,
    agreement.terms_snapshot,
    applicant_profile.full_name,
    applicant_profile.email,
    applicant_profile.phone,
    role_definition.display_name,
    concat_ws(', ',
      nullif(trim(onboarding.permanent_address_line1), ''),
      nullif(trim(onboarding.permanent_address_line2), ''),
      nullif(trim(onboarding.permanent_address_city), ''),
      nullif(trim(onboarding.permanent_address_district), ''),
      nullif(trim(onboarding.permanent_address_state), ''),
      nullif(trim(onboarding.permanent_address_postal_code), '')
    ),
    onboarding.permanent_address_line1,
    onboarding.permanent_address_line2,
    onboarding.permanent_address_city,
    onboarding.permanent_address_district,
    onboarding.permanent_address_state,
    onboarding.permanent_address_postal_code,
    onboarding.date_of_birth::text
  );
  rendered_hash := encode(extensions.digest(convert_to(resolved_copy, 'UTF8'), 'sha256'), 'hex');
  if target_rendered_content is distinct from resolved_copy
      or target_rendered_sha256 is distinct from rendered_hash then
    raise exception 'The reviewed agreement copy changed. Review the current personalized version again.'
      using errcode = '23514';
  end if;

  insert into public.staff_role_agreement_acceptances(
    user_id, role, agreement_version_id, agreement_version, agreement_sha256,
    template_snapshot, terms_snapshot, rendered_content, rendered_sha256
  )
  values (
    applicant, role_definition.role_key, agreement.id, agreement.version, agreement.sha256,
    agreement.template_content, agreement.terms_snapshot, resolved_copy, rendered_hash
  )
  on conflict (user_id, role, agreement_version_id, rendered_sha256)
  where rendered_sha256 is not null
  do nothing;

  if not exists (
    select 1 from public.staff_role_agreement_acceptances acceptance
    where acceptance.user_id = applicant
      and acceptance.role = role_definition.role_key
      and acceptance.agreement_version_id = agreement.id
      and acceptance.agreement_sha256 = agreement.sha256
      and acceptance.rendered_content = resolved_copy
      and acceptance.rendered_sha256 = rendered_hash
  ) then
    raise exception 'The personalized agreement could not be recorded; review the current copy and try again'
      using errcode = '23514';
  end if;

  if onboarding.status = 'approved_pending_agreement' then
    update public.profiles set role = onboarding.requested_role
    where id = applicant and role = 'subscriber';
    if not found then
      raise exception 'Staff account role could not be activated' using errcode = '23514';
    end if;
    update public.staff_onboarding
    set status = 'active', updated_at = now()
    where user_id = applicant and status = 'approved_pending_agreement';
  end if;
end;
$$;
revoke all on function public.chowk_accept_current_staff_role_agreement(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.chowk_accept_current_staff_role_agreement(uuid, text, text, text)
  to authenticated;

create or replace function public.chowk_staff_role_agreement_is_accepted(
  target_user uuid,
  target_role text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  onboarding public.staff_onboarding%rowtype;
  role_definition public.staff_role_definitions%rowtype;
  applicant_profile public.profiles%rowtype;
  agreement public.staff_role_agreement_versions%rowtype;
  resolved_copy text;
  rendered_hash text;
begin
  select * into onboarding
  from public.staff_onboarding
  where user_id = target_user;
  if not found then return false; end if;
  select * into role_definition
  from public.staff_role_definitions
  where id = onboarding.staff_role_id
    and role_key = target_role
    and access_profile = onboarding.requested_role;
  if not found then return false; end if;
  select * into applicant_profile from public.profiles where id = target_user;
  if not found then return false; end if;
  select * into agreement
  from public.staff_role_agreement_versions
  where role = role_definition.role_key and status = 'published'
  order by published_at desc
  limit 1;
  if not found then return false; end if;

  resolved_copy := public.chowk_render_staff_role_agreement(
    agreement.template_content,
    agreement.terms_snapshot,
    applicant_profile.full_name,
    applicant_profile.email,
    applicant_profile.phone,
    role_definition.display_name,
    concat_ws(', ',
      nullif(trim(onboarding.permanent_address_line1), ''),
      nullif(trim(onboarding.permanent_address_line2), ''),
      nullif(trim(onboarding.permanent_address_city), ''),
      nullif(trim(onboarding.permanent_address_district), ''),
      nullif(trim(onboarding.permanent_address_state), ''),
      nullif(trim(onboarding.permanent_address_postal_code), '')
    ),
    onboarding.permanent_address_line1,
    onboarding.permanent_address_line2,
    onboarding.permanent_address_city,
    onboarding.permanent_address_district,
    onboarding.permanent_address_state,
    onboarding.permanent_address_postal_code,
    onboarding.date_of_birth::text
  );
  rendered_hash := encode(extensions.digest(convert_to(resolved_copy, 'UTF8'), 'sha256'), 'hex');
  return exists (
    select 1 from public.staff_role_agreement_acceptances acceptance
    where acceptance.user_id = target_user
      and acceptance.role = role_definition.role_key
      and acceptance.agreement_version_id = agreement.id
      and acceptance.agreement_sha256 = agreement.sha256
      and acceptance.rendered_content = resolved_copy
      and acceptance.rendered_sha256 = rendered_hash
  );
end;
$$;
revoke all on function public.chowk_staff_role_agreement_is_accepted(uuid, text)
  from public, anon, authenticated;

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
  role_definition public.staff_role_definitions%rowtype;
  note_value text := trim(coalesce(review_message, ''));
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
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('chowk_staff_role_agreement_publish')::bigint
  );
  select * into onboarding
  from public.staff_onboarding
  where user_id = target_user and status = 'submitted'
  for update;
  if not found then
    raise exception 'Submitted staff profile not found' using errcode = 'P0002';
  end if;
  select * into role_definition
  from public.staff_role_definitions
  where id = onboarding.staff_role_id and access_profile = onboarding.requested_role;
  if not found then
    raise exception 'The assigned staff job role could not be verified' using errcode = '23514';
  end if;

  if decision = 'approve' then
    if public.chowk_staff_role_agreement_is_accepted(target_user, role_definition.role_key) then
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

create or replace function public.chowk_reporter_staff_role_agreement_is_accepted(
  target_user uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  applicant_profile public.profiles%rowtype;
  agreement public.staff_role_agreement_versions%rowtype;
  resolved_copy text;
  rendered_hash text;
begin
  if not exists (
    select 1 from public.reporter_applications
    where user_id = target_user and status in ('approved', 'active')
  ) then return false; end if;
  select * into applicant_profile from public.profiles where id = target_user;
  if not found then return false; end if;
  select * into agreement
  from public.staff_role_agreement_versions
  where role = 'reporter' and status = 'published'
  order by published_at desc
  limit 1;
  if not found then return false; end if;

  resolved_copy := public.chowk_render_staff_role_agreement(
    agreement.template_content,
    agreement.terms_snapshot,
    applicant_profile.full_name,
    applicant_profile.email,
    applicant_profile.phone,
    'Reporter',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    ''
  );
  rendered_hash := encode(extensions.digest(convert_to(resolved_copy, 'UTF8'), 'sha256'), 'hex');
  return exists (
    select 1 from public.staff_role_agreement_acceptances acceptance
    where acceptance.user_id = target_user
      and acceptance.role = 'reporter'
      and acceptance.agreement_version_id = agreement.id
      and acceptance.agreement_sha256 = agreement.sha256
      and acceptance.rendered_content = resolved_copy
      and acceptance.rendered_sha256 = rendered_hash
  );
end;
$$;
revoke all on function public.chowk_reporter_staff_role_agreement_is_accepted(uuid)
  from public, anon, authenticated;

create or replace function public.chowk_accept_current_reporter_staff_role_agreement(
  target_version uuid,
  target_sha256 text,
  target_rendered_content text,
  target_rendered_sha256 text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  applicant uuid := (select auth.uid());
  applicant_profile public.profiles%rowtype;
  agreement public.staff_role_agreement_versions%rowtype;
  resolved_copy text;
  rendered_hash text;
begin
  if applicant is null or not exists (
    select 1 from public.reporter_applications
    where user_id = applicant and status in ('approved', 'active')
  ) then
    raise exception 'An approved reporter application is required to accept this agreement'
      using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('chowk_staff_role_agreement_publish')::bigint
  );
  select * into applicant_profile
  from public.profiles
  where id = applicant;
  if not found then
    raise exception 'Reporter profile could not be loaded' using errcode = 'P0002';
  end if;
  select * into agreement
  from public.staff_role_agreement_versions
  where id = target_version
    and role = 'reporter'
    and status = 'published'
    and sha256 = target_sha256;
  if not found then
    raise exception 'Review and accept the current published Reporter agreement'
      using errcode = '23514';
  end if;

  resolved_copy := public.chowk_render_staff_role_agreement(
    agreement.template_content,
    agreement.terms_snapshot,
    applicant_profile.full_name,
    applicant_profile.email,
    applicant_profile.phone,
    'Reporter',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    ''
  );
  rendered_hash := encode(extensions.digest(convert_to(resolved_copy, 'UTF8'), 'sha256'), 'hex');
  if target_rendered_content is distinct from resolved_copy
      or target_rendered_sha256 is distinct from rendered_hash then
    raise exception 'The reviewed agreement copy changed. Review the current personalized version again.'
      using errcode = '23514';
  end if;
  insert into public.staff_role_agreement_acceptances(
    user_id, role, agreement_version_id, agreement_version, agreement_sha256,
    template_snapshot, terms_snapshot, rendered_content, rendered_sha256
  )
  values (
    applicant, 'reporter', agreement.id, agreement.version, agreement.sha256,
    agreement.template_content, agreement.terms_snapshot, resolved_copy, rendered_hash
  )
  on conflict (user_id, role, agreement_version_id, rendered_sha256)
  where rendered_sha256 is not null
  do nothing;
  if not public.chowk_reporter_staff_role_agreement_is_accepted(applicant) then
    raise exception 'The Reporter agreement could not be recorded; review the current copy and try again'
      using errcode = '23514';
  end if;
end;
$$;
revoke all on function public.chowk_accept_current_reporter_staff_role_agreement(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.chowk_accept_current_reporter_staff_role_agreement(uuid, text, text, text)
  to authenticated;

create or replace function public.chowk_enforce_current_reporter_service_agreement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.credential_type in ('id_card', 'authority_letter')
      and exists (
        select 1 from public.reporter_applications
        where user_id = new.subject_user_id_snapshot and status in ('approved', 'active')
      )
      and not public.chowk_reporter_staff_role_agreement_is_accepted(new.subject_user_id_snapshot) then
    raise exception 'The reporter must accept the current published Reporter job agreement before credentials can be issued'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.chowk_reporter_acknowledge_credential(
  target_credential bigint,
  typed_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  credential public.staff_credentials%rowtype;
  person public.profiles%rowtype;
begin
  select * into credential
  from public.staff_credentials
  where id = target_credential
  for update;
  if not found then
    raise exception 'Credential not found for this account' using errcode = 'P0002';
  end if;
  select * into person from public.profiles where id = (select auth.uid()) for update;
  if person.id is null or credential.subject_user_id_snapshot is distinct from person.id then
    raise exception 'Credential not found for this account' using errcode = '42501';
  end if;
  if credential.credential_type <> 'authority_letter' or credential.status <> 'pending_acceptance' then
    raise exception 'Only a pending authority letter can be acknowledged' using errcode = '23514';
  end if;
  if lower(trim(coalesce(typed_name, ''))) <> lower(trim(person.full_name)) then
    raise exception 'Type your account name exactly to acknowledge this letter' using errcode = '22023';
  end if;
  if credential.valid_until < current_date or credential.valid_from > current_date then
    raise exception 'This authority letter is outside its validity period' using errcode = '23514';
  end if;
  if not public.chowk_reporter_staff_role_agreement_is_accepted(person.id) then
    raise exception 'Accept the current published Reporter job agreement before acknowledging this authority letter'
      using errcode = '23514';
  end if;
  update public.staff_credentials
  set status = 'superseded'
  where subject_user_id_snapshot = person.id
    and credential_type = 'authority_letter'
    and status = 'active';
  update public.staff_credentials
  set status = 'active', acknowledged_name = trim(typed_name), acknowledged_at = now()
  where id = target_credential;
  update public.reporter_applications
  set status = 'active'
  where user_id = person.id and status = 'approved';
  update public.profiles
  set role = 'reporter'
  where id = person.id and role = 'subscriber'
    and exists (
      select 1 from public.reporter_applications
      where user_id = person.id and status = 'active'
    );
end;
$$;
revoke all on function public.chowk_reporter_acknowledge_credential(bigint, text)
  from public, anon;
grant execute on function public.chowk_reporter_acknowledge_credential(bigint, text)
  to authenticated;
