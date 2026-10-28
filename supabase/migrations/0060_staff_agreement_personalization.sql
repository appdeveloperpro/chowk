create extension if not exists pgcrypto with schema extensions;

alter table public.staff_role_agreement_acceptances
  add column if not exists rendered_content text,
  add column if not exists rendered_sha256 text;

alter table public.staff_role_agreement_acceptances
  drop constraint if exists staff_role_agreement_acceptances_rendered_sha256_check;
alter table public.staff_role_agreement_acceptances
  add constraint staff_role_agreement_acceptances_rendered_sha256_check
  check (rendered_sha256 is null or rendered_sha256 ~ '^[a-f0-9]{64}$');
alter table public.staff_role_agreement_acceptances
  drop constraint if exists staff_role_agreement_acceptances_rendered_pair_check;
alter table public.staff_role_agreement_acceptances
  add constraint staff_role_agreement_acceptances_rendered_pair_check
  check ((rendered_content is null) = (rendered_sha256 is null));

revoke all on function public.chowk_accept_current_staff_role_agreement(uuid, text)
  from public, anon, authenticated;
drop function public.chowk_accept_current_staff_role_agreement(uuid, text);

create or replace function public.chowk_render_staff_role_agreement(
  target_template text,
  target_terms jsonb,
  target_full_name text,
  target_email text,
  target_phone text,
  target_role text,
  target_address text,
  target_address_line1 text,
  target_address_line2 text,
  target_city text,
  target_district text,
  target_state text,
  target_postal_code text,
  target_date_of_birth text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  rendered text := target_template;
  token_match text[];
  token_key text;
  term_key text;
  token_value text;
begin
  if jsonb_typeof(target_terms) is distinct from 'object' then
    raise exception 'Agreement terms snapshot is invalid' using errcode = '22023';
  end if;

  for token_match in
    select regexp_matches(target_template, '\{\{([^{}]+)\}\}', 'g')
  loop
    token_key := token_match[1];
    token_value := case token_key
      when 'staff.full_name' then coalesce(target_full_name, '')
      when 'staff.email' then coalesce(target_email, '')
      when 'staff.phone' then coalesce(target_phone, '')
      when 'staff.role' then coalesce(target_role, '')
      when 'staff.address' then coalesce(target_address, '')
      when 'staff.address_line1' then coalesce(target_address_line1, '')
      when 'staff.address_line2' then coalesce(target_address_line2, '')
      when 'staff.city' then coalesce(target_city, '')
      when 'staff.district' then coalesce(target_district, '')
      when 'staff.state' then coalesce(target_state, '')
      when 'staff.postal_code' then coalesce(target_postal_code, '')
      when 'staff.date_of_birth' then coalesce(target_date_of_birth, '')
      else null
    end;

    if token_value is null and left(token_key, 6) = 'terms.' then
      term_key := substring(token_key from 7);
      if term_key !~ '^[a-z][a-z0-9_]{0,49}$'
          or not (target_terms ? term_key)
          or jsonb_typeof(target_terms -> term_key) is distinct from 'string'
          or length(trim(target_terms ->> term_key)) = 0 then
        raise exception 'Agreement contains an unknown or unresolved term placeholder: {{%}}', token_key
          using errcode = '23514';
      end if;
      token_value := target_terms ->> term_key;
    end if;

    if token_value is null then
      raise exception 'Agreement contains an unknown placeholder: {{%}}', token_key
        using errcode = '23514';
    end if;
    rendered := replace(rendered, '{{' || token_key || '}}', token_value);
  end loop;

  if position('{{' in rendered) > 0 or position('}}' in rendered) > 0 then
    raise exception 'Agreement contains an unresolved or malformed placeholder'
      using errcode = '23514';
  end if;
  if length(rendered) > 200000 then
    raise exception 'The personalized agreement exceeds the maximum supported size'
      using errcode = '22023';
  end if;
  return rendered;
end;
$$;
revoke all on function public.chowk_render_staff_role_agreement(
  text,jsonb,text,text,text,text,text,text,text,text,text,text,text,text
) from public, anon, authenticated;

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
      or target_sha256 !~ '^[a-f0-9]{64}$'
      or encode(extensions.digest(convert_to(target_template, 'UTF8'), 'sha256'), 'hex') <> target_sha256 then
    raise exception 'Provide a role, version label, non-empty template, and matching SHA-256 digest'
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
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('chowk_staff_role_agreement_publish')::bigint
  );
  select * into agreement
  from public.staff_role_agreement_versions
  where id = target_version and status = 'draft'
  for update;
  if not found or length(trim(agreement.template_content)) = 0 then
    raise exception 'A non-empty draft agreement is required before publishing' using errcode = '23514';
  end if;
  if encode(extensions.digest(convert_to(agreement.template_content, 'UTF8'), 'sha256'), 'hex')
      <> agreement.sha256 then
    raise exception 'Agreement wording digest does not match the saved draft'
      using errcode = '23514';
  end if;

  perform public.chowk_render_staff_role_agreement(
    agreement.template_content,
    agreement.terms_snapshot,
    'Staff full name', 'staff@example.invalid', '+10000000000',
    agreement.role, 'Staff address', 'Address line 1', '', 'City',
    'District', 'State', '000000', '2000-01-01'
  );

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
  select * into applicant_profile from public.profiles where id = applicant;
  if not found then
    raise exception 'Staff profile details could not be loaded' using errcode = 'P0002';
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

  resolved_copy := public.chowk_render_staff_role_agreement(
    agreement.template_content,
    agreement.terms_snapshot,
    applicant_profile.full_name,
    applicant_profile.email,
    applicant_profile.phone,
    onboarding.requested_role,
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
    applicant, onboarding.requested_role, agreement.id, agreement.version, agreement.sha256,
    agreement.template_content, agreement.terms_snapshot, resolved_copy, rendered_hash
  )
  on conflict (user_id, role, agreement_version_id) do nothing;

  if not exists (
    select 1 from public.staff_role_agreement_acceptances acceptance
    where acceptance.user_id = applicant
      and acceptance.role = onboarding.requested_role
      and acceptance.agreement_version_id = agreement.id
      and acceptance.agreement_sha256 = agreement.sha256
      and acceptance.rendered_content = resolved_copy
      and acceptance.rendered_sha256 = rendered_hash
  ) then
    raise exception 'An immutable acceptance already exists for a different agreement copy; ask an admin to publish a new version'
      using errcode = '23514';
  end if;

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
revoke all on function public.chowk_accept_current_staff_role_agreement(uuid, text, text, text)
  from public, anon;
grant execute on function public.chowk_accept_current_staff_role_agreement(uuid, text, text, text)
  to authenticated;

create or replace function public.chowk_staff_role_agreement_is_accepted(
  target_user uuid,
  target_role text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_role_agreement_versions agreement
    join public.staff_role_agreement_acceptances acceptance
      on acceptance.agreement_version_id = agreement.id
      and acceptance.agreement_sha256 = agreement.sha256
    where agreement.role = target_role
      and agreement.status = 'published'
      and acceptance.user_id = target_user
      and acceptance.role = target_role
      and acceptance.rendered_content is not null
      and acceptance.rendered_sha256 ~ '^[a-f0-9]{64}$'
  );
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

  select * into onboarding
  from public.staff_onboarding
  where user_id = target_user and status = 'submitted'
  for update;
  if not found then
    raise exception 'Submitted staff profile not found' using errcode = 'P0002';
  end if;

  if decision = 'approve' then
    if public.chowk_staff_role_agreement_is_accepted(target_user, onboarding.requested_role) then
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

create or replace function public.chowk_admin_set_user_role(target_user uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  current_target_role text;
begin
  select role into actor_role
  from public.profiles
  where id = (select auth.uid());
  if actor_role is null or actor_role not in ('admin', 'super_admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if new_role is null
      or new_role not in ('subscriber', 'reporter', 'moderator', 'editor', 'publisher', 'admin', 'super_admin') then
    raise exception 'Invalid account role' using errcode = '22023';
  end if;
  select role into current_target_role from public.profiles where id = target_user;
  if current_target_role is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if (current_target_role = 'super_admin' or new_role = 'super_admin')
      and actor_role <> 'super_admin' then
    raise exception 'Only a super admin can change super admin access' using errcode = '42501';
  end if;
  if current_target_role = 'super_admin'
      and new_role <> 'super_admin'
      and (select count(*) from public.profiles where role = 'super_admin') <= 1 then
    raise exception 'Cannot remove the last super admin' using errcode = '23514';
  end if;
  if new_role = 'reporter' and not exists (
    select 1 from public.reporter_applications
    where user_id = target_user and status = 'active'
  ) then
    raise exception 'Reporter access is granted only after the applicant completes reporter onboarding' using errcode = '23514';
  end if;
  if new_role in ('moderator', 'editor')
      and current_target_role is distinct from new_role
      and (
        not exists (
          select 1 from public.staff_onboarding
          where user_id = target_user
            and requested_role = new_role
            and status = 'active'
        )
        or not public.chowk_staff_role_agreement_is_accepted(target_user, new_role)
      ) then
    raise exception 'Moderator and editor access requires an approved profile and acceptance of the current role agreement'
      using errcode = '23514';
  end if;
  update public.profiles set role = new_role where id = target_user;
end;
$$;
revoke all on function public.chowk_admin_set_user_role(uuid, text) from public, anon;
grant execute on function public.chowk_admin_set_user_role(uuid, text) to authenticated;
