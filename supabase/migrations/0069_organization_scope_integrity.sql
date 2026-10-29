begin;

alter table public.organization_setting_events
  add column if not exists organization_id uuid;
update public.organization_setting_events setting_event
set organization_id = organization.organization_id
from public.organization_settings organization
where organization.id = setting_event.setting_id
  and setting_event.organization_id is null;

alter table public.organization_module_configuration_versions
  add column if not exists organization_id uuid;
update public.organization_module_configuration_versions module_version
set organization_id = module.organization_id
from public.organization_modules module
where module.id = module_version.organization_module_id
  and module_version.organization_id is null;

do $$
begin
  if exists (
    select 1 from public.organization_setting_events
    where organization_id is null
  ) or exists (
    select 1 from public.organization_module_configuration_versions
    where organization_id is null
  ) then
    raise exception 'Could not derive organization scope for every configuration history row';
  end if;

  if exists (
    select 1 from public.organization_setting_events setting_event
    join public.organization_settings setting
      on setting.id = setting_event.setting_id
    where setting_event.organization_id <> setting.organization_id
  ) or exists (
    select 1 from public.organization_module_configuration_versions module_version
    join public.organization_modules module on module.id = module_version.organization_module_id
    where module_version.organization_id <> module.organization_id
  ) then
    raise exception 'Configuration history contains rows scoped to a different organization';
  end if;

  if exists (
    select 1 from public.hr_departments child
    join public.hr_departments parent on parent.id = child.parent_id
    where child.organization_id <> parent.organization_id
  ) or exists (
    select 1 from public.hr_positions hr_position
    join public.hr_departments department on department.id = hr_position.department_id
    where hr_position.organization_id <> department.organization_id
  ) or exists (
    select 1 from public.organization_people person
    join public.organization_access_roles access_role on access_role.id = person.access_role_id
    where person.organization_id <> access_role.organization_id
  ) or exists (
    select 1 from public.organization_people person
    join public.hr_departments department on department.id = person.department_id
    where person.organization_id <> department.organization_id
  ) or exists (
    select 1 from public.organization_access_role_permissions permission
    join public.organization_access_roles access_role on access_role.id = permission.role_id
    where permission.organization_id <> access_role.organization_id
  ) or exists (
    select 1 from public.hr_employee_assignments assignment
    join public.hr_employees employee on employee.id = assignment.employee_id
    where assignment.organization_id <> employee.organization_id
  ) or exists (
    select 1 from public.hr_employee_assignments assignment
    join public.hr_employees manager on manager.id = assignment.manager_employee_id
    where assignment.organization_id <> manager.organization_id
  ) or exists (
    select 1 from public.hr_employee_assignments assignment
    join public.hr_departments department on department.id = assignment.department_id
    where assignment.organization_id <> department.organization_id
  ) or exists (
    select 1 from public.hr_employee_assignments assignment
    join public.hr_positions hr_position on hr_position.id = assignment.position_id
    where assignment.organization_id <> hr_position.organization_id
  ) or exists (
    select 1 from public.hr_employee_assignments assignment
    join public.organization_access_roles access_role
      on access_role.id = assignment.access_role_id
    where assignment.organization_id <> access_role.organization_id
  ) or exists (
    select 1 from public.hr_policy_documents hr_policy
    join public.hr_departments department on department.id = hr_policy.department_id
    where hr_policy.organization_id <> department.organization_id
  ) or exists (
    select 1 from public.hr_policy_documents hr_policy
    join public.organization_access_roles access_role
      on access_role.id = hr_policy.access_role_id
    where hr_policy.organization_id <> access_role.organization_id
  ) or exists (
    select 1 from public.hr_policy_versions policy_version
    join public.hr_policy_documents hr_policy on hr_policy.id = policy_version.policy_id
    where policy_version.organization_id <> hr_policy.organization_id
  ) or exists (
    select 1 from public.hr_policy_acceptances acceptance
    join public.hr_employees employee on employee.id = acceptance.employee_id
    where acceptance.organization_id <> employee.organization_id
  ) or exists (
    select 1 from public.hr_policy_acceptances acceptance
    join public.hr_policy_versions policy_version
      on policy_version.id = acceptance.policy_version_id
    where acceptance.organization_id <> policy_version.organization_id
  ) or exists (
    select 1 from public.organization_model_fields field
    join public.organization_models model on model.id = field.model_id
    where field.organization_id <> model.organization_id
  ) or exists (
    select 1 from public.organization_model_transitions model_transition
    join public.organization_models model on model.id = model_transition.model_id
    where model_transition.organization_id <> model.organization_id
  ) or exists (
    select 1 from public.organization_model_permissions permission
    join public.organization_access_roles access_role on access_role.id = permission.role_id
    where permission.organization_id <> access_role.organization_id
  ) or exists (
    select 1 from public.organization_model_permissions permission
    join public.organization_models model on model.id = permission.model_id
    where permission.organization_id <> model.organization_id
  ) or exists (
    select 1 from public.organization_records model_record
    join public.organization_models model on model.id = model_record.model_id
    where model_record.organization_id <> model.organization_id
  ) or exists (
    select 1 from public.organization_records model_record
    join public.hr_departments department on department.id = model_record.department_id
    where model_record.organization_id <> department.organization_id
  ) or exists (
    select 1 from public.organization_record_events record_event
    join public.organization_records model_record on model_record.id = record_event.record_id
    where record_event.organization_id <> model_record.organization_id
  ) then
    raise exception 'Existing organization-owned references cross organization boundaries; reconcile them before migration 0069';
  end if;
end;
$$;

alter table public.organization_setting_events
  alter column organization_id set not null;
alter table public.organization_module_configuration_versions
  alter column organization_id set not null;

create unique index if not exists hr_positions_id_organization_uidx
  on public.hr_positions(id, organization_id);
create unique index if not exists hr_employees_id_organization_uidx
  on public.hr_employees(id, organization_id);
create unique index if not exists hr_policy_documents_id_organization_uidx
  on public.hr_policy_documents(id, organization_id);
create unique index if not exists hr_policy_versions_id_organization_uidx
  on public.hr_policy_versions(id, organization_id);
create unique index if not exists organization_models_id_organization_uidx
  on public.organization_models(id, organization_id);
create unique index if not exists organization_records_id_organization_uidx
  on public.organization_records(id, organization_id);
create unique index if not exists organization_settings_id_organization_uidx
  on public.organization_settings(id, organization_id);
create unique index if not exists organization_modules_id_organization_uidx
  on public.organization_modules(id, organization_id);

alter table public.hr_departments
  add constraint hr_departments_parent_scope_fkey
  foreign key (parent_id, organization_id)
  references public.hr_departments(id, organization_id);
alter table public.hr_positions
  add constraint hr_positions_department_scope_fkey
  foreign key (department_id, organization_id)
  references public.hr_departments(id, organization_id);
alter table public.organization_people
  add constraint organization_people_access_role_scope_fkey
  foreign key (access_role_id, organization_id)
  references public.organization_access_roles(id, organization_id),
  add constraint organization_people_department_scope_fkey
  foreign key (department_id, organization_id)
  references public.hr_departments(id, organization_id);
alter table public.organization_access_role_permissions
  add constraint organization_access_role_permissions_role_scope_fkey
  foreign key (role_id, organization_id)
  references public.organization_access_roles(id, organization_id);
alter table public.hr_employee_assignments
  add constraint hr_employee_assignments_employee_scope_fkey
  foreign key (employee_id, organization_id)
  references public.hr_employees(id, organization_id),
  add constraint hr_employee_assignments_manager_scope_fkey
  foreign key (manager_employee_id, organization_id)
  references public.hr_employees(id, organization_id),
  add constraint hr_employee_assignments_department_scope_fkey
  foreign key (department_id, organization_id)
  references public.hr_departments(id, organization_id),
  add constraint hr_employee_assignments_position_scope_fkey
  foreign key (position_id, organization_id)
  references public.hr_positions(id, organization_id),
  add constraint hr_employee_assignments_access_role_scope_fkey
  foreign key (access_role_id, organization_id)
  references public.organization_access_roles(id, organization_id);
alter table public.hr_policy_documents
  add constraint hr_policy_documents_department_scope_fkey
  foreign key (department_id, organization_id)
  references public.hr_departments(id, organization_id),
  add constraint hr_policy_documents_access_role_scope_fkey
  foreign key (access_role_id, organization_id)
  references public.organization_access_roles(id, organization_id);
alter table public.hr_policy_versions
  add constraint hr_policy_versions_policy_scope_fkey
  foreign key (policy_id, organization_id)
  references public.hr_policy_documents(id, organization_id);
alter table public.hr_policy_acceptances
  add constraint hr_policy_acceptances_employee_scope_fkey
  foreign key (employee_id, organization_id)
  references public.hr_employees(id, organization_id),
  add constraint hr_policy_acceptances_version_scope_fkey
  foreign key (policy_version_id, organization_id)
  references public.hr_policy_versions(id, organization_id);
alter table public.organization_model_fields
  add constraint organization_model_fields_model_scope_fkey
  foreign key (model_id, organization_id)
  references public.organization_models(id, organization_id);
alter table public.organization_model_transitions
  add constraint organization_model_transitions_model_scope_fkey
  foreign key (model_id, organization_id)
  references public.organization_models(id, organization_id);
alter table public.organization_model_permissions
  add constraint organization_model_permissions_role_scope_fkey
  foreign key (role_id, organization_id)
  references public.organization_access_roles(id, organization_id),
  add constraint organization_model_permissions_model_scope_fkey
  foreign key (model_id, organization_id)
  references public.organization_models(id, organization_id);
alter table public.organization_records
  add constraint organization_records_model_scope_fkey
  foreign key (model_id, organization_id)
  references public.organization_models(id, organization_id),
  add constraint organization_records_department_scope_fkey
  foreign key (department_id, organization_id)
  references public.hr_departments(id, organization_id);
alter table public.organization_record_events
  add constraint organization_record_events_record_scope_fkey
  foreign key (record_id, organization_id)
  references public.organization_records(id, organization_id);
alter table public.organization_setting_events
  add constraint organization_setting_events_setting_scope_fkey
  foreign key (setting_id, organization_id)
  references public.organization_settings(id, organization_id);
alter table public.organization_module_configuration_versions
  add constraint organization_module_configuration_versions_module_scope_fkey
  foreign key (organization_module_id, organization_id)
  references public.organization_modules(id, organization_id);

create index if not exists organization_setting_events_organization_idx
  on public.organization_setting_events(organization_id, setting_id, revision desc);
create index if not exists organization_module_configuration_versions_organization_idx
  on public.organization_module_configuration_versions(
    organization_id, organization_module_id, version desc
  );

create or replace function public.chowk_org_version_module_configuration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.is_enabled is not distinct from new.is_enabled
      and old.configuration is not distinct from new.configuration then
    return new;
  end if;
  update public.organization_module_configuration_versions
  set status = 'retired'
  where organization_module_id = new.id and status = 'published';
  insert into public.organization_module_configuration_versions(
    organization_module_id, organization_id, version, configuration, status,
    created_by, published_by, published_at
  ) values (
    new.id, new.organization_id, new.revision, new.configuration, 'published',
    new.updated_by, new.updated_by, now()
  )
  on conflict (organization_module_id, version) do nothing;
  return new;
end;
$$;

create or replace function public.chowk_org_write_configuration_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'organization_settings' then
    insert into public.organization_setting_events(
      setting_id, organization_id, actor_id, revision, before_value, after_value
    ) values (
      coalesce(new.id, old.id),
      coalesce(new.organization_id, old.organization_id),
      (select auth.uid()),
      coalesce(new.revision, old.revision),
      case when tg_op = 'INSERT' then null else old.value end,
      case when tg_op = 'DELETE' then null else new.value end
    );
  end if;
  return new;
end;
$$;

commit;
