begin;

alter table public.hr_employee_assignments
  drop constraint if exists hr_employee_assignments_employee_scope_fkey,
  drop constraint if exists hr_employee_assignments_manager_scope_fkey,
  add constraint hr_employee_assignments_employee_scope_fkey
    foreign key (employee_id, organization_id)
    references public.hr_employees(id, organization_id)
    on delete cascade,
  add constraint hr_employee_assignments_manager_scope_fkey
    foreign key (manager_employee_id, organization_id)
    references public.hr_employees(id, organization_id)
    on delete set null (manager_employee_id);

alter table public.hr_policy_acceptances
  drop constraint if exists hr_policy_acceptances_employee_scope_fkey,
  add constraint hr_policy_acceptances_employee_scope_fkey
    foreign key (employee_id, organization_id)
    references public.hr_employees(id, organization_id)
    on delete cascade;

alter table public.organization_people_access_events
  drop constraint if exists organization_people_access_events_relationship_scope_fkey,
  add constraint organization_people_access_events_relationship_scope_fkey
    foreign key (relationship_id, organization_id)
    references public.organization_people(id, organization_id)
    on delete set null (relationship_id);

commit;
