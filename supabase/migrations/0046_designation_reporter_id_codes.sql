alter table public.reporter_designations
  add column if not exists designation_code text;

update public.reporter_designations designation
set designation_code = reporter_type.type_code
from public.reporter_types reporter_type
where reporter_type.name = designation.name
  and designation.designation_code is null;

do $$
declare
  designation_row record;
  candidate text;
begin
  for designation_row in
    select id
    from public.reporter_designations
    where designation_code is null
    order by id
  loop
    select lpad(available.code::text, 2, '0')
    into candidate
    from generate_series(1, 99) as available(code)
    where not exists (
      select 1
      from public.reporter_designations existing
      where existing.designation_code = lpad(available.code::text, 2, '0')
    )
    order by available.code
    limit 1;
    if candidate is null then
      raise exception 'Could not generate a unique two-digit reporter designation code';
    end if;
    update public.reporter_designations
    set designation_code = candidate
    where id = designation_row.id;
  end loop;
end;
$$;

update public.reporter_designations
set designation_code = trim(designation_code);

alter table public.reporter_designations
  alter column designation_code set not null;
alter table public.reporter_designations
  add constraint reporter_designations_code_format
  check (designation_code ~ '^[0-9]{2}$');
create unique index if not exists reporter_designations_code_idx
  on public.reporter_designations(designation_code);

create table if not exists public.reporter_designation_code_counters (
  rto_office_id bigint not null references public.rto_offices(id) on delete restrict,
  designation_code text not null check (designation_code ~ '^[0-9]{2}$'),
  next_number integer not null default 1 check (next_number > 0),
  primary key (rto_office_id, designation_code)
);

insert into public.reporter_designation_code_counters(rto_office_id, designation_code, next_number)
select counter.rto_office_id, reporter_type.type_code, counter.next_number
from public.reporter_code_counters counter
join public.reporter_types reporter_type on reporter_type.id = counter.reporter_type_id
on conflict (rto_office_id, designation_code) do update
set next_number = greatest(
  public.reporter_designation_code_counters.next_number,
  excluded.next_number
);

alter table public.reporter_designation_code_counters enable row level security;

create or replace function public.chowk_admin_review_reporter_application_base_0034(
  target_application bigint,
  decision text,
  note text default '',
  signer_name text default '',
  signer_designation text default '',
  signature_accepted boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  application_row public.reporter_applications%rowtype;
  rto public.rto_offices%rowtype;
  state_row public.states%rowtype;
  reporter_type public.reporter_types%rowtype;
  reporter_designation public.reporter_designations%rowtype;
  issued_number integer;
  new_code text;
begin
  if actor is null or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if decision not in ('approved', 'rejected', 'needs_information') then
    raise exception 'Decision must be approved, rejected, or needs information' using errcode = '22023';
  end if;
  select * into application_row
  from public.reporter_applications
  where id = target_application
  for update;
  if not found or application_row.status not in ('pending', 'needs_information') then
    raise exception 'Only an application awaiting review can be reviewed' using errcode = '23514';
  end if;
  if decision in ('rejected', 'needs_information') and length(trim(coalesce(note, ''))) < 2 then
    raise exception 'A clear applicant-facing note is required for this decision' using errcode = '22023';
  end if;
  if decision = 'approved' then
    if length(trim(coalesce(signer_name, ''))) < 2
       or length(trim(coalesce(signer_designation, ''))) < 2
       or not coalesce(signature_accepted, false) then
      raise exception 'Company approver details and approval attestation are required' using errcode = '22023';
    end if;
    select * into rto
    from public.rto_offices
    where id = application_row.rto_office_id and is_active;
    select * into state_row
    from public.states
    where id = application_row.state_id and is_active;
    select * into reporter_type
    from public.reporter_types
    where id = application_row.reporter_type_id and is_active;
    select * into reporter_designation
    from public.reporter_designations
    where id = application_row.reporter_designation_id and is_active;
    if rto.id is null or state_row.id is null or reporter_type.id is null
       or reporter_designation.id is null or rto.state_id <> state_row.id then
      raise exception 'Application location, reporter type, or designation is no longer active'
        using errcode = '23514';
    end if;

    insert into public.reporter_designation_code_counters(rto_office_id, designation_code)
    values (rto.id, reporter_designation.designation_code)
    on conflict do nothing;
    update public.reporter_designation_code_counters
    set next_number = next_number + 1
    where rto_office_id = rto.id
      and designation_code = reporter_designation.designation_code
    returning next_number - 1 into issued_number;
    loop
      if issued_number > 9999 then
        raise exception 'Reporter ID sequence is exhausted for this RTO and designation code'
          using errcode = '22003';
      end if;
      new_code := lower(
        state_row.state_code || '-' || rto.rto_code || '-' ||
        reporter_designation.designation_code || '-' || lpad(issued_number::text, 4, '0')
      );
      perform pg_advisory_xact_lock(hashtext(new_code)::bigint);
      exit when not exists (
        select 1 from public.reporter_profiles where reporter_code = new_code
      );
      update public.reporter_designation_code_counters
      set next_number = next_number + 1
      where rto_office_id = rto.id
        and designation_code = reporter_designation.designation_code
      returning next_number - 1 into issued_number;
    end loop;
    insert into public.reporter_profiles(user_id, reporter_code)
    values (application_row.user_id, new_code)
    on conflict (user_id) do nothing;

    if not exists (
      select 1 from public.reporter_assignments
      where user_id = application_row.user_id and effective_to is null
    ) then
      insert into public.reporter_assignments(
        user_id, rto_office_id, reporter_type_id, reporter_designation_id, assigned_by
      )
      values (
        application_row.user_id, rto.id, reporter_type.id, reporter_designation.id, actor
      );
    end if;
  end if;
  update public.reporter_applications
  set status = decision,
      review_note = trim(coalesce(note, '')),
      reviewed_by = actor,
      reviewed_at = now(),
      company_signer_name = case when decision = 'approved' then nullif(trim(coalesce(signer_name, '')), '') else null end,
      company_signer_designation = case when decision = 'approved' then nullif(trim(coalesce(signer_designation, '')), '') else null end,
      company_signature_accepted = decision = 'approved' and coalesce(signature_accepted, false),
      company_signed_at = case when decision = 'approved' then now() else null end,
      company_signature_statement = case when decision = 'approved'
        then 'Authorized approver attests to this application decision; this record is not a cryptographic signature.'
        else null end
  where id = target_application;
end;
$$;

revoke all on function public.chowk_admin_review_reporter_application_base_0034(
  bigint,text,text,text,text,boolean
) from public, anon, authenticated;

create or replace function public.chowk_admin_assign_reporter(
  target_user uuid,
  target_rto bigint,
  target_type bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  rto public.rto_offices%rowtype;
  state_row public.states%rowtype;
  reporter_type public.reporter_types%rowtype;
  reporter_designation public.reporter_designations%rowtype;
  current_assignment public.reporter_assignments%rowtype;
  current_code text;
  sequence_number integer;
  generated_code text;
begin
  if actor is null or not (select public.chowk_has_any_role(array['admin','super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles where id = target_user and role = 'reporter'
  ) then
    raise exception 'Target user is not an approved reporter' using errcode = '23514';
  end if;
  select * into rto from public.rto_offices where id = target_rto and is_active;
  select * into state_row from public.states where id = rto.state_id and is_active;
  select * into reporter_type from public.reporter_types where id = target_type and is_active;
  if rto.id is null or state_row.id is null or reporter_type.id is null then
    raise exception 'Select an active state, RTO and reporter type' using errcode = '22023';
  end if;

  select * into current_assignment
  from public.reporter_assignments
  where user_id = target_user and effective_to is null
  order by effective_from desc
  limit 1
  for update;
  select designation.* into reporter_designation
  from public.reporter_applications application
  join public.reporter_designations designation
    on designation.id = application.reporter_designation_id
   and designation.is_active
  where application.user_id = target_user
    and application.status in ('approved', 'active')
  order by application.created_at desc
  limit 1;
  if reporter_designation.id is null and current_assignment.reporter_designation_id is not null then
    select * into reporter_designation
    from public.reporter_designations
    where id = current_assignment.reporter_designation_id and is_active;
  end if;
  if reporter_designation.id is null then
    select * into reporter_designation
    from public.reporter_designations
    where name = reporter_type.name and is_active;
  end if;
  if reporter_designation.id is null then
    raise exception 'Assign an active reporter designation before generating a reporter ID'
      using errcode = '23514';
  end if;

  select reporter_code into current_code
  from public.reporter_profiles
  where user_id = target_user
  for update;
  if current_code is null then
    insert into public.reporter_designation_code_counters(rto_office_id, designation_code)
    values (rto.id, reporter_designation.designation_code)
    on conflict do nothing;
    update public.reporter_designation_code_counters
    set next_number = next_number + 1
    where rto_office_id = rto.id
      and designation_code = reporter_designation.designation_code
    returning next_number - 1 into sequence_number;
    loop
      if sequence_number > 9999 then
        raise exception 'Reporter ID sequence is exhausted for this RTO and designation code'
          using errcode = '22003';
      end if;
      generated_code := lower(
        state_row.state_code || '-' || rto.rto_code || '-' ||
        reporter_designation.designation_code || '-' || lpad(sequence_number::text, 4, '0')
      );
      perform pg_advisory_xact_lock(hashtext(generated_code)::bigint);
      exit when not exists (
        select 1 from public.reporter_profiles where reporter_code = generated_code
      );
      update public.reporter_designation_code_counters
      set next_number = next_number + 1
      where rto_office_id = rto.id
        and designation_code = reporter_designation.designation_code
      returning next_number - 1 into sequence_number;
    end loop;
    insert into public.reporter_profiles(user_id, reporter_code)
    values (target_user, generated_code);
  end if;

  update public.reporter_assignments
  set effective_to = now()
  where user_id = target_user and effective_to is null;
  insert into public.reporter_assignments(
    user_id, rto_office_id, reporter_type_id, reporter_designation_id, assigned_by
  )
  values (
    target_user, rto.id, reporter_type.id, reporter_designation.id, actor
  );
end;
$$;

revoke all on function public.chowk_admin_assign_reporter(uuid,bigint,bigint) from public, anon;
grant execute on function public.chowk_admin_assign_reporter(uuid,bigint,bigint) to authenticated;
