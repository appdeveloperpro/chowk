create table if not exists public.staff_onboarding (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  requested_role text not null check (requested_role in ('moderator', 'editor')),
  status text not null default 'invited'
    check (status in ('invited', 'submitted', 'changes_requested', 'active', 'rejected')),
  date_of_birth date,
  emergency_contact_name text not null default '',
  emergency_contact_relationship text not null default '',
  emergency_contact_phone text not null default '',
  permanent_address_line1 text not null default '',
  permanent_address_line2 text not null default '',
  permanent_address_city text not null default '',
  permanent_address_district text not null default '',
  permanent_address_state text not null default '',
  permanent_address_postal_code text not null default '',
  preferred_language text not null default '',
  experience_years numeric(4,1),
  experience_summary text not null default '',
  profile_photo_path text,
  review_note text not null default '',
  invited_by uuid references public.profiles(id) on delete set null,
  invited_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (experience_years is null or experience_years between 0 and 80),
  check (
    profile_photo_path is null
    or profile_photo_path ~ (
      '^staff/[0-9a-f-]{36}/profile/[0-9a-f-]{36}\.(jpg|png)$'
    )
  )
);

create index if not exists staff_onboarding_status_idx
  on public.staff_onboarding(status, invited_at desc);

alter table public.staff_onboarding enable row level security;

drop policy if exists "Staff onboarding is visible to the member and admins"
  on public.staff_onboarding;
create policy "Staff onboarding is visible to the member and admins"
  on public.staff_onboarding for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.chowk_has_any_role(array['admin', 'super_admin']))
  );

revoke all on public.staff_onboarding from anon, authenticated;
grant select on public.staff_onboarding to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'chowk-staff-profiles',
  'chowk-staff-profiles',
  false,
  5242880,
  array['image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Staff members upload their own profile photo" on storage.objects;
create policy "Staff members upload their own profile photo"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chowk-staff-profiles'
    and split_part(name, '/', 1) = 'staff'
    and split_part(name, '/', 2) = (select auth.uid())::text
    and name ~ (
      '^staff/' || (select auth.uid())::text || '/profile/[0-9a-f-]{36}\.(jpg|png)$'
    )
    and exists (
      select 1 from public.staff_onboarding onboarding
      where onboarding.user_id = (select auth.uid())
        and onboarding.status in ('invited', 'changes_requested')
    )
  );

drop policy if exists "Staff members and admins view staff profile photos" on storage.objects;
create policy "Staff members and admins view staff profile photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chowk-staff-profiles'
    and (
      split_part(name, '/', 2) = (select auth.uid())::text
      or (select public.chowk_has_any_role(array['admin', 'super_admin']))
    )
  );

drop policy if exists "Staff members remove their own unused profile photos" on storage.objects;
create policy "Staff members remove their own unused profile photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chowk-staff-profiles'
    and split_part(name, '/', 2) = (select auth.uid())::text
    and not exists (
      select 1 from public.staff_onboarding onboarding
      where onboarding.profile_photo_path = storage.objects.name
    )
  );

create or replace function public.chowk_admin_create_staff_onboarding_invitation(
  target_user uuid,
  target_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null
      or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if target_role not in ('moderator', 'editor') then
    raise exception 'Staff role must be moderator or editor' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = target_user and role = 'subscriber'
  ) then
    raise exception 'The invited account is missing or already has a newsroom role' using errcode = '23514';
  end if;
  insert into public.staff_onboarding(user_id, requested_role, invited_by)
  values (target_user, target_role, actor);
end;
$$;

revoke all on function public.chowk_admin_create_staff_onboarding_invitation(uuid, text)
  from public, anon;
grant execute on function public.chowk_admin_create_staff_onboarding_invitation(uuid, text)
  to authenticated;

create or replace function public.chow_submit_staff_onboarding(profile_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  applicant uuid := (select auth.uid());
  experience_value numeric;
  birth_date_value date;
  photo_path text := nullif(trim(coalesce(profile_data ->> 'profile_photo_path', '')), '');
begin
  if applicant is null then
    raise exception 'Sign in to complete staff onboarding' using errcode = '42501';
  end if;
  if jsonb_typeof(profile_data) is distinct from 'object' then
    raise exception 'Staff profile details are invalid' using errcode = '22023';
  end if;
  if profile_data ->> 'profile_confirmed' is distinct from 'true' then
    raise exception 'Confirm that your staff profile information is accurate before submitting' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.staff_onboarding
    where user_id = applicant and status in ('invited', 'changes_requested')
  ) then
    raise exception 'No editable staff invitation was found for this account' using errcode = '42501';
  end if;

  if nullif(trim(coalesce(profile_data ->> 'experience_years', '')), '') is not null then
    begin
      experience_value := (profile_data ->> 'experience_years')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Enter reporting experience as a number from 0 to 80' using errcode = '22023';
    end;
    if experience_value < 0 or experience_value > 80 then
      raise exception 'Enter reporting experience as a number from 0 to 80' using errcode = '22023';
    end if;
  end if;

  if nullif(trim(coalesce(profile_data ->> 'date_of_birth', '')), '') is not null then
    begin
      birth_date_value := (profile_data ->> 'date_of_birth')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Enter a valid date of birth' using errcode = '22023';
    end;
    if birth_date_value > current_date or birth_date_value < current_date - interval '100 years' then
      raise exception 'Enter a valid date of birth' using errcode = '22023';
    end if;
  end if;

  if length(trim(coalesce(profile_data ->> 'full_name', ''))) not between 2 and 120
      or length(trim(coalesce(profile_data ->> 'phone', ''))) not between 7 and 16
      or trim(profile_data ->> 'phone') !~ '^\+?[1-9][0-9]{6,14}$'
      or length(trim(coalesce(profile_data ->> 'emergency_contact_name', ''))) not between 2 and 120
      or length(trim(coalesce(profile_data ->> 'emergency_contact_relationship', ''))) not between 2 and 80
      or trim(coalesce(profile_data ->> 'emergency_contact_phone', '')) !~ '^\+?[1-9][0-9]{6,14}$'
      or length(trim(coalesce(profile_data ->> 'permanent_address_line1', ''))) not between 2 and 160
      or length(trim(coalesce(profile_data ->> 'permanent_address_city', ''))) not between 2 and 100
      or length(trim(coalesce(profile_data ->> 'permanent_address_district', ''))) not between 2 and 100
      or length(trim(coalesce(profile_data ->> 'permanent_address_state', ''))) not between 2 and 100
      or trim(coalesce(profile_data ->> 'permanent_address_postal_code', '')) !~ '^[0-9]{6}$'
      or length(trim(coalesce(profile_data ->> 'permanent_address_line2', ''))) > 160
      or length(trim(coalesce(profile_data ->> 'preferred_language', ''))) > 80
      or length(trim(coalesce(profile_data ->> 'experience_summary', ''))) > 2000 then
    raise exception 'Complete the required staff profile fields with valid values' using errcode = '22023';
  end if;

  if photo_path is null
      or photo_path !~ (
        '^staff/' || applicant::text || '/profile/[0-9a-f-]{36}\.(jpg|png)$'
      )
      or not exists (
        select 1 from storage.objects
        where bucket_id = 'chowk-staff-profiles' and name = photo_path
      ) then
    raise exception 'Upload a valid profile photo before submitting your staff profile' using errcode = '22023';
  end if;

  update public.profiles
  set full_name = trim(profile_data ->> 'full_name'),
      phone = trim(profile_data ->> 'phone')
  where id = applicant and role = 'subscriber';
  if not found then
    raise exception 'Staff onboarding account is not eligible for profile completion' using errcode = '42501';
  end if;

  update public.staff_onboarding
  set date_of_birth = birth_date_value,
      emergency_contact_name = trim(profile_data ->> 'emergency_contact_name'),
      emergency_contact_relationship = trim(profile_data ->> 'emergency_contact_relationship'),
      emergency_contact_phone = trim(profile_data ->> 'emergency_contact_phone'),
      permanent_address_line1 = trim(profile_data ->> 'permanent_address_line1'),
      permanent_address_line2 = trim(coalesce(profile_data ->> 'permanent_address_line2', '')),
      permanent_address_city = trim(profile_data ->> 'permanent_address_city'),
      permanent_address_district = trim(profile_data ->> 'permanent_address_district'),
      permanent_address_state = trim(profile_data ->> 'permanent_address_state'),
      permanent_address_postal_code = trim(profile_data ->> 'permanent_address_postal_code'),
      preferred_language = trim(coalesce(profile_data ->> 'preferred_language', '')),
      experience_years = experience_value,
      experience_summary = trim(coalesce(profile_data ->> 'experience_summary', '')),
      profile_photo_path = photo_path,
      status = 'submitted',
      review_note = '',
      submitted_at = now(),
      reviewed_by = null,
      reviewed_at = null,
      updated_at = now()
  where user_id = applicant and status in ('invited', 'changes_requested');
end;
$$;

revoke all on function public.chow_submit_staff_onboarding(jsonb) from public, anon;
grant execute on function public.chow_submit_staff_onboarding(jsonb) to authenticated;

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
    update public.profiles set role = onboarding.requested_role where id = target_user;
    update public.staff_onboarding
    set status = 'active', review_note = '', reviewed_by = actor, reviewed_at = now(), updated_at = now()
    where user_id = target_user;
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
  select role into current_target_role
  from public.profiles
  where id = target_user;
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
      and not exists (
        select 1 from public.staff_onboarding
        where user_id = target_user
          and requested_role = new_role
          and status = 'active'
      ) then
    raise exception 'Moderator and editor access requires an approved staff onboarding profile' using errcode = '23514';
  end if;
  update public.profiles set role = new_role where id = target_user;
end;
$$;
revoke all on function public.chowk_admin_set_user_role(uuid, text) from public, anon;
grant execute on function public.chowk_admin_set_user_role(uuid, text) to authenticated;

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
        'STAFF_ONBOARDING_REJECTED'
      ) and target_table = 'staff_onboarding'
    ),
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
revoke all on function public.chowk_record_admin_event(text, text, text, jsonb)
  from public, anon;
grant execute on function public.chowk_record_admin_event(text, text, text, jsonb)
  to authenticated;
