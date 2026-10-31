begin;

create table if not exists public.staff_role_change_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_staff_role_id uuid references public.staff_role_definitions(id) on delete set null,
  role_key_snapshot text not null,
  display_name_snapshot text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled')),
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  resulting_assignment_id uuid references public.staff_role_assignments(id) on delete set null,
  check ((status = 'accepted') = (accepted_at is not null))
);

create unique index if not exists staff_role_change_requests_one_pending_idx
  on public.staff_role_change_requests(user_id)
  where status = 'pending';

create index if not exists staff_role_change_requests_history_idx
  on public.staff_role_change_requests(user_id, requested_at desc);

alter table public.staff_role_change_requests enable row level security;
revoke all on public.staff_role_change_requests from anon, authenticated;
grant select on public.staff_role_change_requests to authenticated;

drop policy if exists "Staff and admins read staff role change requests"
  on public.staff_role_change_requests;
create policy "Staff and admins read staff role change requests"
  on public.staff_role_change_requests for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.chowk_has_any_role(array['admin', 'super_admin']))
    or (select public.chowk_org_user_has_capability('reporters.manage'))
    or (select public.chowk_org_user_has_capability('reporters.applications.review'))
    or (select public.chowk_org_user_has_capability('newsroom.people.manage'))
  );

drop policy if exists "Staff onboarding is visible to the member and admins"
  on public.staff_onboarding;
create policy "Staff onboarding is visible to the member and authorized reviewers"
  on public.staff_onboarding for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.chowk_has_any_role(array['admin', 'super_admin']))
    or (select public.chowk_org_user_has_capability('reporters.manage'))
    or (select public.chowk_org_user_has_capability('reporters.applications.review'))
    or (select public.chowk_org_user_has_capability('newsroom.people.manage'))
  );

drop policy if exists "Admins and assigned staff read staff role definitions"
  on public.staff_role_definitions;
create policy "Admins and authorized reviewers read staff role definitions"
  on public.staff_role_definitions for select to authenticated
  using (
    (select public.chowk_has_any_role(array['admin', 'super_admin']))
    or exists (
      select 1 from public.staff_onboarding onboarding
      where onboarding.user_id = (select auth.uid())
        and onboarding.staff_role_id = staff_role_definitions.id
    )
    or exists (
      select 1 from public.staff_role_change_requests request
      where request.user_id = (select auth.uid())
        and request.target_staff_role_id = staff_role_definitions.id
        and request.status = 'pending'
    )
    or (select public.chowk_org_user_has_capability('reporters.applications.review'))
    or (select public.chowk_org_user_has_capability('reporters.manage'))
    or (select public.chowk_org_user_has_capability('newsroom.people.manage'))
  );

drop policy if exists "Staff and admins read staff role assignments"
  on public.staff_role_assignments;
create policy "Staff and authorized reviewers read staff role assignments"
  on public.staff_role_assignments for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.chowk_has_any_role(array['admin', 'super_admin']))
    or (select public.chowk_org_user_has_capability('reporters.manage'))
    or (select public.chowk_org_user_has_capability('reporters.applications.review'))
    or (select public.chowk_org_user_has_capability('newsroom.people.manage'))
  );

drop policy if exists "Profiles are visible to their owner and staff"
  on public.profiles;
create policy "Profiles are visible to their owner, staff, and authorized reviewers"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.chowk_has_any_role(array['admin', 'super_admin']))
    or (select public.chowk_org_user_has_capability('reporters.manage'))
    or (select public.chowk_org_user_has_capability('reporters.applications.review'))
    or (select public.chowk_org_user_has_capability('newsroom.people.manage'))
  );

drop policy if exists "Admins read staff agreement terms"
  on public.staff_role_agreement_terms;
create policy "Admins and authorized people managers read staff agreement terms"
  on public.staff_role_agreement_terms for select to authenticated
  using (
    (select public.chowk_has_any_role(array['admin', 'super_admin']))
    or (select public.chowk_org_user_has_capability('reporters.manage'))
    or (select public.chowk_org_user_has_capability('newsroom.people.manage'))
  );

drop policy if exists "Members and admins read staff agreement acceptances"
  on public.staff_role_agreement_acceptances;
create policy "Members, admins, and authorized reviewers read staff agreement acceptances"
  on public.staff_role_agreement_acceptances for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.chowk_has_any_role(array['admin', 'super_admin']))
    or (select public.chowk_org_user_has_capability('reporters.manage'))
    or (select public.chowk_org_user_has_capability('newsroom.people.manage'))
  );

create or replace function public.chowk_block_staff_role_deactivation_with_assignments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_active and not new.is_active and (
    exists (
      select 1 from public.staff_role_assignments assignment
      where assignment.staff_role_id = old.id
        and assignment.status in ('pending', 'active')
    )
    or exists (
      select 1 from public.staff_role_change_requests request
      where request.target_staff_role_id = old.id
        and request.status = 'pending'
    )
  ) then
    raise exception 'Reassign or withdraw every pending and active staff assignment before deactivating this role'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.chowk_block_staff_role_deactivation_with_assignments()
  from public, anon, authenticated;

drop trigger if exists chowk_block_staff_role_deactivation_with_assignments
  on public.staff_role_definitions;
create trigger chowk_block_staff_role_deactivation_with_assignments
before update of is_active on public.staff_role_definitions
for each row
execute function public.chowk_block_staff_role_deactivation_with_assignments();

create or replace function public.chowk_block_staff_role_delete_with_pending_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.staff_role_change_requests request
    where request.target_staff_role_id = old.id
      and request.status = 'pending'
  ) then
    raise exception 'Cancel the pending staff role change before deleting this role'
      using errcode = '23514';
  end if;
  return old;
end;
$$;
revoke all on function public.chowk_block_staff_role_delete_with_pending_change()
  from public, anon, authenticated;

drop trigger if exists chowk_block_staff_role_delete_with_pending_change
  on public.staff_role_definitions;
create trigger chowk_block_staff_role_delete_with_pending_change
before delete on public.staff_role_definitions
for each row
execute function public.chowk_block_staff_role_delete_with_pending_change();

create or replace function public.chowk_admin_reassign_staff_job_role(
  target_user uuid,
  target_role_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  current_onboarding public.staff_onboarding%rowtype;
  current_assignment public.staff_role_assignments%rowtype;
  target_role public.staff_role_definitions%rowtype;
  request_id uuid;
begin
  if actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('chowk_staff_job_assignment:' || target_user::text, 0)
  );
  select * into current_onboarding
  from public.staff_onboarding
  where user_id = target_user and status = 'active'
  for update;
  if not found then
    raise exception 'Only active staff can be reassigned to a different job title' using errcode = '23514';
  end if;
  select * into current_assignment
  from public.staff_role_assignments
  where user_id = target_user and status = 'active'
  for update;
  if not found then
    raise exception 'The current active newsroom role assignment could not be verified' using errcode = '23514';
  end if;
  select * into target_role
  from public.staff_role_definitions
  where id = target_role_id and is_active
  for share;
  if not found then
    raise exception 'Choose an active staff role' using errcode = '22023';
  end if;
  if target_role.access_profile <> current_onboarding.requested_role then
    raise exception 'Changing the staff member access profile requires a new onboarding and agreement flow'
      using errcode = '23514';
  end if;
  if current_onboarding.staff_role_id = target_role.id then
    raise exception 'This staff member already has that job title' using errcode = '23514';
  end if;

  insert into public.staff_role_change_requests(
    user_id, target_staff_role_id, role_key_snapshot, display_name_snapshot, requested_by
  )
  values (
    target_user, target_role.id, target_role.role_key, target_role.display_name, actor
  )
  on conflict (user_id) where status = 'pending'
  do update set target_staff_role_id = excluded.target_staff_role_id,
                role_key_snapshot = excluded.role_key_snapshot,
                display_name_snapshot = excluded.display_name_snapshot,
                requested_by = excluded.requested_by,
                requested_at = now()
  returning id into request_id;
  return request_id;
end;
$$;

revoke all on function public.chowk_admin_reassign_staff_job_role(uuid,uuid)
  from public, anon;
grant execute on function public.chowk_admin_reassign_staff_job_role(uuid,uuid)
  to authenticated;

create or replace function public.chowk_admin_cancel_staff_role_change(target_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  request_id uuid;
begin
  if actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('chowk_staff_job_assignment:' || target_user::text, 0)
  );
  update public.staff_role_change_requests
  set status = 'cancelled'
  where user_id = target_user and status = 'pending'
  returning id into request_id;
  if not found then
    raise exception 'There is no pending newsroom role change to cancel' using errcode = 'P0002';
  end if;
  return request_id;
end;
$$;
revoke all on function public.chowk_admin_cancel_staff_role_change(uuid)
  from public, anon;
grant execute on function public.chowk_admin_cancel_staff_role_change(uuid)
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
  role_change public.staff_role_change_requests%rowtype;
  role_definition public.staff_role_definitions%rowtype;
  agreement public.staff_role_agreement_versions%rowtype;
  applicant_profile public.profiles%rowtype;
  resolved_copy text;
  rendered_hash text;
  has_role_change boolean := false;
  new_assignment_id uuid;
begin
  if applicant is null then
    raise exception 'Sign in to accept the staff agreement' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('chowk_staff_role_agreement_publish')::bigint
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('chowk_staff_job_assignment:' || applicant::text, 0)
  );
  select * into onboarding
  from public.staff_onboarding
  where user_id = applicant
    and status in ('submitted', 'approved_pending_agreement', 'active')
  for update;
  if not found then
    raise exception 'Submit your staff profile before accepting its personalized agreement'
      using errcode = '42501';
  end if;

  select * into role_change
  from public.staff_role_change_requests
  where user_id = applicant and status = 'pending'
  for update;
  has_role_change := found;
  if has_role_change then
    select * into role_definition
    from public.staff_role_definitions
    where id = role_change.target_staff_role_id
      and access_profile = onboarding.requested_role
      and is_active;
  else
    select * into role_definition
    from public.staff_role_definitions
    where id = onboarding.staff_role_id
      and access_profile = onboarding.requested_role
      and is_active;
  end if;
  if not found then
    raise exception 'The assigned staff job role could not be verified or is no longer active'
      using errcode = '23514';
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

  if has_role_change then
    update public.staff_role_assignments
    set status = 'ended',
        ended_at = now(),
        end_reason = 'Reassigned after accepting the new job role agreement'
    where user_id = applicant and status = 'active';
    if not found then
      raise exception 'The current staff role assignment could not be ended' using errcode = '23514';
    end if;
    update public.staff_onboarding
    set staff_role_id = role_definition.id, updated_at = now()
    where user_id = applicant and status = 'active';
    insert into public.staff_role_assignments(
      user_id, staff_role_id, role_key_snapshot, display_name_snapshot,
      status, duties_snapshot, assigned_by, starts_at
    )
    values (
      applicant, role_definition.id, role_definition.role_key, role_definition.display_name,
      'active', role_definition.duties, role_change.requested_by, now()
    )
    returning id into new_assignment_id;
    update public.staff_role_change_requests
    set status = 'accepted', accepted_at = now(), resulting_assignment_id = new_assignment_id
    where id = role_change.id and status = 'pending';
  elsif onboarding.status = 'approved_pending_agreement' then
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

create or replace function public.chowk_staff_must_review_current_agreement()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  applicant uuid := (select auth.uid());
  onboarding public.staff_onboarding%rowtype;
  role_definition public.staff_role_definitions%rowtype;
begin
  if applicant is null then return false; end if;
  select * into onboarding
  from public.staff_onboarding
  where user_id = applicant and status = 'active';
  if not found then return false; end if;
  if exists (
    select 1 from public.staff_role_change_requests
    where user_id = applicant and status = 'pending'
  ) then
    return true;
  end if;
  select * into role_definition
  from public.staff_role_definitions
  where id = onboarding.staff_role_id
    and access_profile = onboarding.requested_role;
  if not found then return true; end if;
  if not exists (
    select 1 from public.staff_role_agreement_versions
    where role = role_definition.role_key and status = 'published'
  ) then
    return false;
  end if;
  return not public.chowk_staff_role_agreement_is_accepted(
    applicant, role_definition.role_key
  );
end;
$$;
revoke all on function public.chowk_staff_must_review_current_agreement()
  from public, anon;
grant execute on function public.chowk_staff_must_review_current_agreement()
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
  role_definition public.staff_role_definitions%rowtype;
  note_value text := trim(coalesce(review_message, ''));
begin
  if actor is null
      or not (
        (select public.chowk_has_any_role(array['admin', 'super_admin']))
        or (select public.chowk_org_user_has_capability('reporters.manage'))
        or (select public.chowk_org_user_has_capability('reporters.applications.review'))
        or (select public.chowk_org_user_has_capability('newsroom.people.manage'))
      ) then
    raise exception 'Staff application review permission required' using errcode = '42501';
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
  where id = onboarding.staff_role_id
    and access_profile = onboarding.requested_role
    and is_active;
  if not found then
    raise exception 'The assigned staff job role could not be verified or is no longer active'
      using errcode = '23514';
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

create or replace function public.chowk_record_admin_event(
  event_action text,
  target_table text,
  target_record_id text,
  event_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor uuid := (select auth.uid());
  current_actor_name text;
  current_actor_email text;
  request_headers jsonb := coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb,
    '{}'::jsonb
  );
begin
  if current_actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if not coalesce(
    (event_action in ('USER_CREATED', 'PASSWORD_CHANGED') and target_table = 'profiles')
    or (
      event_action in (
        'STAFF_ONBOARDING_INVITED',
        'STAFF_ONBOARDING_APPROVED',
        'STAFF_ONBOARDING_CHANGES_REQUESTED',
        'STAFF_ONBOARDING_REJECTED',
        'STAFF_ONBOARDING_DELETED'
      ) and target_table = 'staff_onboarding'
    )
    or (event_action in ('STAFF_JOB_ROLE_CHANGE_REQUESTED', 'STAFF_JOB_ROLE_CHANGE_CANCELLED')
        and target_table = 'staff_role_change_requests')
    or (event_action in ('STAFF_JOB_ROLE_CREATED', 'STAFF_JOB_ROLE_UPDATED',
        'STAFF_JOB_ROLE_DELETED') and target_table = 'staff_role_definitions'),
    false
  ) then
    raise exception 'Unsupported admin audit event' using errcode = '22023';
  end if;
  select full_name, email
  into current_actor_name, current_actor_email
  from public.profiles
  where id = current_actor;

  insert into public.audit_logs (
    actor_id, actor_name, actor_email, actor_ip, request_id, user_agent,
    action, table_name, record_id, after_data, changed_fields, outcome
  )
  values (
    current_actor, current_actor_name, current_actor_email,
    nullif(request_headers ->> 'x-chowk-client-ip', ''),
    nullif(request_headers ->> 'x-chowk-request-id', ''),
    nullif(request_headers ->> 'x-chowk-user-agent', ''),
    event_action, target_table, target_record_id,
    coalesce(event_data, '{}'::jsonb),
    case
      when jsonb_typeof(event_data -> 'changed_fields') = 'array'
        then event_data -> 'changed_fields'
      else '[]'::jsonb
    end,
    'success'
  );
end;
$$;

commit;
