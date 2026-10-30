begin;

create or replace function public.chowk_org_configuration_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  primary_organization_id uuid;
begin
  if not public.chowk_org_is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;

  select organization.id
  into primary_organization_id
  from public.organizations organization
  where organization.is_primary;
  if primary_organization_id is null then
    raise exception 'Primary organization configuration is missing' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'organization', (
      select to_jsonb(organization) - 'created_by'
      from public.organizations organization
      where organization.id = primary_organization_id
    ),
    'settings', coalesce((
      select jsonb_agg(to_jsonb(setting) - 'updated_by' order by setting.setting_key)
      from public.organization_settings setting
      where setting.organization_id = primary_organization_id and setting.is_active
    ), '[]'::jsonb),
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'module_key', catalog.module_key,
        'name', catalog.name,
        'description', catalog.description,
        'module_type', catalog.module_type,
        'is_required', catalog.is_required,
        'is_enabled', coalesce(module.is_enabled, catalog.is_required),
        'configuration', coalesce(module.configuration, '{}'::jsonb),
        'revision', coalesce(module.revision, 0)
      ) order by catalog.sort_order, catalog.name)
      from public.organization_module_catalog catalog
      left join public.organization_modules module
        on module.module_key = catalog.module_key
       and module.organization_id = primary_organization_id
      where catalog.is_active
    ), '[]'::jsonb),
    'workflows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', workflow.id,
        'module_key', workflow.module_key,
        'workflow_key', workflow.workflow_key,
        'name', workflow.name,
        'description', workflow.description,
        'version', workflow.version,
        'is_active', workflow.is_active,
        'states', coalesce((
          select jsonb_agg(to_jsonb(state) - 'workflow_id'
            order by state.sort_order, state.label)
          from public.organization_workflow_states state
          where state.workflow_id = workflow.id
        ), '[]'::jsonb),
        'transitions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', transition.id,
            'from_state_id', transition.from_state_id,
            'to_state_id', transition.to_state_id,
            'transition_key', transition.transition_key,
            'label', transition.label,
            'required_permission', transition.required_permission,
            'requires_reason', transition.requires_reason,
            'requires_approval', transition.requires_approval,
            'sort_order', transition.sort_order,
            'is_active', transition.is_active
          ) order by transition.sort_order, transition.label)
          from public.organization_workflow_transitions transition
          where transition.workflow_id = workflow.id
        ), '[]'::jsonb)
      ) order by workflow.module_key, workflow.name)
      from public.organization_workflows workflow
      where workflow.organization_id = primary_organization_id
    ), '[]'::jsonb),
    'modules_catalog', coalesce((
      select jsonb_agg(to_jsonb(catalog) order by catalog.sort_order, catalog.name)
      from public.organization_module_catalog catalog
      where catalog.is_active
    ), '[]'::jsonb),
    'access_roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', role.id, 'role_key', role.role_key, 'name', role.name,
        'description', role.description
      ) order by role.name)
      from public.organization_access_roles role
      where role.is_active
    ), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', department.id, 'department_key', department.department_key,
        'name', department.name
      ) order by department.name)
      from public.hr_departments department
      where department.is_active
    ), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', person.id,
        'person_id', person.person_id,
        'full_name', profile.full_name,
        'email', profile.email,
        'relationship_type', person.relationship_type,
        'status', person.status,
        'source_type', person.source_type,
        'starts_at', person.starts_at,
        'ends_at', person.ends_at,
        'access_role_id', person.access_role_id,
        'access_role_name', role.name,
        'department_id', person.department_id,
        'department_name', department.name
      ) order by profile.full_name nulls last, profile.email, person.relationship_type)
      from public.organization_people person
      join public.profiles profile on profile.id = person.person_id
      left join public.organization_access_roles role on role.id = person.access_role_id
      left join public.hr_departments department on department.id = person.department_id
      where person.organization_id = primary_organization_id
    ), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'permission_key', permission.permission_key,
        'area', permission.area,
        'description', permission.description
      ) order by permission.area, permission.permission_key)
      from public.organization_permission_catalog permission
      where permission.is_active
    ), '[]'::jsonb)
  );
end;
$$;

commit;
