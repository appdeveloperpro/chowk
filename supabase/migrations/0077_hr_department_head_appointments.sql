begin;

create table public.hr_department_head_appointments (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.hr_departments(id) on delete restrict,
  employee_id uuid not null references public.hr_employees(id) on delete restrict,
  appointment_type text not null check (appointment_type in ('permanent', 'acting')),
  valid_from timestamptz not null,
  valid_to timestamptz,
  ended_at timestamptz,
  cancelled_at timestamptz,
  appointment_reason text not null check (length(trim(appointment_reason)) between 2 and 1000),
  end_reason text not null default '' check (length(end_reason) <= 1000),
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  check (appointment_type <> 'acting' or valid_to is not null),
  check (ended_at is null or ended_at > valid_from),
  check (ended_at is null or length(trim(end_reason)) >= 2),
  check (cancelled_at is null or length(trim(end_reason)) >= 2),
  check (ended_at is null or cancelled_at is null)
);

create index hr_department_head_appointments_department_history_idx
  on public.hr_department_head_appointments(department_id, valid_from desc);
create index hr_department_head_appointments_employee_history_idx
  on public.hr_department_head_appointments(employee_id, valid_from desc);

create or replace function public.chowk_hr_validate_department_head_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.hr_departments department
      where department.id = new.department_id and department.is_active
    ) then
      raise exception 'Choose an active department' using errcode = '23514';
    end if;
    if not exists (
      select 1
      from public.hr_employees employee
      join public.hr_employee_assignments assignment
        on assignment.employee_id = employee.id
        and assignment.status = 'active'
        and assignment.starts_at <= statement_timestamp()
      where employee.id = new.employee_id
        and employee.employment_status = 'active'
    ) then
      raise exception 'Choose an active HR employee with a current active assignment'
        using errcode = '23514';
    end if;
  else
    if new.department_id is distinct from old.department_id
        or new.employee_id is distinct from old.employee_id
        or new.appointment_type is distinct from old.appointment_type
        or new.valid_from is distinct from old.valid_from
        or new.valid_to is distinct from old.valid_to
        or new.appointment_reason is distinct from old.appointment_reason
        or new.assigned_by is distinct from old.assigned_by
        or new.created_at is distinct from old.created_at then
      raise exception 'Department head appointment details are immutable; end it and create a new appointment'
        using errcode = '23514';
    end if;
    if old.ended_at is not null or old.cancelled_at is not null then
      raise exception 'Ended or cancelled department head appointments are immutable'
        using errcode = '23514';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'hr_department_head:' || new.department_id::text,
    0
  ));

  if new.cancelled_at is null and exists (
    select 1
    from public.hr_department_head_appointments other
    where other.department_id = new.department_id
      and other.id <> new.id
      and other.cancelled_at is null
      and tstzrange(
        other.valid_from,
        least(
          coalesce(other.valid_to, 'infinity'::timestamptz),
          coalesce(other.ended_at, 'infinity'::timestamptz)
        ),
        '[)'
      ) && tstzrange(
        new.valid_from,
        least(
          coalesce(new.valid_to, 'infinity'::timestamptz),
          coalesce(new.ended_at, 'infinity'::timestamptz)
        ),
        '[)'
      )
  ) then
    raise exception 'This department already has an overlapping head appointment; replace the current appointment or choose a non-overlapping date'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_hr_department_head_appointment
  on public.hr_department_head_appointments;
create trigger validate_hr_department_head_appointment
  before insert or update on public.hr_department_head_appointments
  for each row execute function public.chowk_hr_validate_department_head_appointment();

drop trigger if exists audit_hr_department_head_appointment
  on public.hr_department_head_appointments;
create trigger audit_hr_department_head_appointment
  after insert or update or delete on public.hr_department_head_appointments
  for each row execute function public.chowk_audit_row();

create or replace function public.chowk_hr_department_head_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_department uuid := (
    select assignment.department_id
    from public.hr_employee_assignments assignment
    where assignment.employee_id = (select auth.uid())
      and assignment.status = 'active'
    order by assignment.is_primary desc, assignment.created_at desc
    limit 1
  );
  can_configure boolean := public.chowk_user_has_permission('hr.configuration.manage');
  can_read boolean := public.chowk_user_has_permission(
      'hr.employee.read', (select auth.uid()), actor_department
    )
    or public.chowk_user_has_permission(
      'hr.employee.manage', (select auth.uid()), actor_department
    )
    or public.chowk_user_has_permission('hr.configuration.manage')
    or public.chowk_user_has_permission('hr.employee.read')
    or public.chowk_user_has_permission('hr.employee.manage');
  can_access_workspace boolean := can_read
    or public.chowk_user_has_permission('hr.policy.manage');
begin
  if not can_access_workspace then
    raise exception 'HR workspace access is required' using errcode = '42501';
  end if;
  if not can_read then
    return jsonb_build_object('department_head_appointments', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'department_head_appointments', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.valid_from desc)
      from (
        select appointment.id, appointment.department_id, appointment.employee_id,
          appointment.appointment_type, appointment.valid_from, appointment.valid_to,
          appointment.ended_at, appointment.cancelled_at,
          appointment.appointment_reason, appointment.end_reason,
          appointment.assigned_by, appointment.created_at,
          department.name as department_name,
          employee.employee_number, employee.employment_status,
          profile.full_name as employee_name, profile.email as employee_email,
          case
            when appointment.cancelled_at is not null then 'cancelled'
            when least(
              coalesce(appointment.valid_to, 'infinity'::timestamptz),
              coalesce(appointment.ended_at, 'infinity'::timestamptz)
            ) <= statement_timestamp() then 'ended'
            when appointment.valid_from > statement_timestamp() then 'scheduled'
            else 'active'
          end as appointment_state
        from public.hr_department_head_appointments appointment
        join public.hr_departments department on department.id = appointment.department_id
        join public.hr_employees employee on employee.id = appointment.employee_id
        join public.profiles profile on profile.id = appointment.employee_id
        where can_configure
          or public.chowk_user_has_permission(
            'hr.employee.read', appointment.employee_id, appointment.department_id
          )
          or public.chowk_user_has_permission(
            'hr.employee.manage', appointment.employee_id, appointment.department_id
          )
      ) row_data
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.chowk_hr_save_department_head_appointment(
  target_department_id uuid,
  target_employee_id uuid,
  target_appointment_type text,
  target_valid_from timestamptz,
  target_valid_to timestamptz,
  target_reason text,
  target_replace_appointment uuid default null,
  target_replace_reason text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  replaced public.hr_department_head_appointments%rowtype;
  saved_id uuid;
begin
  if not public.chowk_user_has_permission(
    'hr.employee.manage', target_employee_id, target_department_id
  ) then
    raise exception 'Permission to manage this department head appointment is required'
      using errcode = '42501';
  end if;
  if target_department_id is null or target_employee_id is null
      or target_appointment_type is null
      or target_appointment_type not in ('permanent', 'acting')
      or target_valid_from is null
      or (target_valid_to is not null and target_valid_to <= target_valid_from)
      or (target_appointment_type = 'acting' and target_valid_to is null)
      or length(trim(coalesce(target_reason, ''))) not between 2 and 1000 then
    raise exception 'Enter a valid department head, appointment type, date range, and reason'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'hr_department_head:' || target_department_id::text,
    0
  ));

  if target_replace_appointment is not null then
    select * into replaced
    from public.hr_department_head_appointments
    where id = target_replace_appointment
    for update;
    if not found or replaced.department_id <> target_department_id
        or replaced.ended_at is not null
        or replaced.cancelled_at is not null
        or least(
          coalesce(replaced.valid_to, 'infinity'::timestamptz),
          coalesce(replaced.ended_at, 'infinity'::timestamptz)
        ) <= target_valid_from
        or replaced.valid_from >= target_valid_from
        or length(trim(coalesce(target_replace_reason, ''))) not between 2 and 1000 then
      raise exception 'Choose the overlapping appointment to replace and provide a reason'
        using errcode = '22023';
    end if;
    if not public.chowk_user_has_permission(
      'hr.employee.manage', replaced.employee_id, target_department_id
    ) then
      raise exception 'Permission to replace the current department head appointment is required'
        using errcode = '42501';
    end if;
    update public.hr_department_head_appointments
    set ended_at = target_valid_from, end_reason = trim(target_replace_reason)
    where id = replaced.id;
  end if;

  insert into public.hr_department_head_appointments(
    department_id, employee_id, appointment_type, valid_from, valid_to,
    appointment_reason, assigned_by
  ) values (
    target_department_id, target_employee_id, target_appointment_type,
    target_valid_from, target_valid_to, trim(target_reason), (select auth.uid())
  ) returning id into saved_id;
  return saved_id;
end;
$$;

create or replace function public.chowk_hr_end_department_head_appointment(
  target_appointment uuid,
  target_end_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.hr_department_head_appointments%rowtype;
begin
  select * into existing
  from public.hr_department_head_appointments
  where id = target_appointment;
  if not found then
    raise exception 'Department head appointment not found' using errcode = 'P0002';
  end if;
  if not public.chowk_user_has_permission(
    'hr.employee.manage', existing.employee_id, existing.department_id
  ) then
    raise exception 'Permission to end this department head appointment is required'
      using errcode = '42501';
  end if;
  if length(trim(coalesce(target_end_reason, ''))) not between 2 and 1000 then
    raise exception 'Provide a reason for ending this appointment' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'hr_department_head:' || existing.department_id::text,
    0
  ));
  select * into existing
  from public.hr_department_head_appointments
  where id = target_appointment
  for update;
  if existing.ended_at is not null or existing.cancelled_at is not null
      or least(
        coalesce(existing.valid_to, 'infinity'::timestamptz),
        coalesce(existing.ended_at, 'infinity'::timestamptz)
      ) <= statement_timestamp() then
    raise exception 'This appointment is already ended or cancelled'
      using errcode = '23514';
  end if;

  if existing.valid_from > statement_timestamp() then
    update public.hr_department_head_appointments
    set cancelled_at = statement_timestamp(), end_reason = trim(target_end_reason)
    where id = target_appointment;
  else
    update public.hr_department_head_appointments
    set ended_at = statement_timestamp(), end_reason = trim(target_end_reason)
    where id = target_appointment;
  end if;
end;
$$;

alter table public.hr_department_head_appointments enable row level security;
revoke all on public.hr_department_head_appointments from anon, authenticated;
grant select on public.hr_department_head_appointments to authenticated;

drop policy if exists "HR users read scoped department head history"
  on public.hr_department_head_appointments;
create policy "HR users read scoped department head history"
  on public.hr_department_head_appointments for select to authenticated
  using (
    public.chowk_user_has_permission(
      'hr.employee.read', employee_id, department_id
    )
    or public.chowk_user_has_permission(
      'hr.employee.manage', employee_id, department_id
    )
    or public.chowk_user_has_permission('hr.configuration.manage')
  );

revoke all on function public.chowk_hr_validate_department_head_appointment()
  from public, anon, authenticated;
revoke all on function public.chowk_hr_department_head_snapshot()
  from public, anon;
revoke all on function public.chowk_hr_save_department_head_appointment(
  uuid, uuid, text, timestamptz, timestamptz, text, uuid, text
) from public, anon;
revoke all on function public.chowk_hr_end_department_head_appointment(uuid, text)
  from public, anon;
grant execute on function public.chowk_hr_department_head_snapshot()
  to authenticated;
grant execute on function public.chowk_hr_save_department_head_appointment(
  uuid, uuid, text, timestamptz, timestamptz, text, uuid, text
) to authenticated;
grant execute on function public.chowk_hr_end_department_head_appointment(uuid, text)
  to authenticated;

commit;
