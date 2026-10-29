alter table public.organization_workflow_states
  add column if not exists organization_id uuid;
update public.organization_workflow_states state
set organization_id = workflow.organization_id
from public.organization_workflows workflow
where workflow.id = state.workflow_id
  and state.organization_id is null;

alter table public.organization_workflow_transitions
  add column if not exists organization_id uuid;
update public.organization_workflow_transitions transition
set organization_id = workflow.organization_id
from public.organization_workflows workflow
where workflow.id = transition.workflow_id
  and transition.organization_id is null;

alter table public.organization_workflow_events
  add column if not exists organization_id uuid;
update public.organization_workflow_events event
set organization_id = instance.organization_id
from public.organization_workflow_instances instance
where instance.id = event.instance_id
  and event.organization_id is null;

alter table public.organization_people_access_events
  add column if not exists organization_id uuid;
update public.organization_people_access_events event
set organization_id = person.organization_id
from public.organization_people person
where person.id = event.relationship_id
  and event.organization_id is null;

do $$
begin
  if exists (
    select 1 from public.organization_workflow_states
    where organization_id is null
  ) or exists (
    select 1 from public.organization_workflow_transitions
    where organization_id is null
  ) or exists (
    select 1 from public.organization_workflow_events
    where organization_id is null
  ) or exists (
    select 1 from public.organization_people_access_events
    where organization_id is null
  ) then
    raise exception 'Could not derive organization scope for every workflow and access event';
  end if;
  if exists (
    select 1
    from public.organization_workflow_states state
    join public.organization_workflows workflow on workflow.id = state.workflow_id
    where state.organization_id <> workflow.organization_id
  ) or exists (
    select 1
    from public.organization_workflow_transitions transition
    join public.organization_workflows workflow on workflow.id = transition.workflow_id
    where transition.organization_id <> workflow.organization_id
  ) or exists (
    select 1
    from public.organization_workflow_events event
    join public.organization_workflow_instances instance on instance.id = event.instance_id
    where event.organization_id <> instance.organization_id
  ) or exists (
    select 1
    from public.organization_people_access_events event
    join public.organization_people person on person.id = event.relationship_id
    where event.organization_id <> person.organization_id
  ) then
    raise exception 'Existing workflow or access events cross organization boundaries; reconcile them before migration 0068';
  end if;
end;
$$;

alter table public.organization_workflow_states
  alter column organization_id set default '00000000-0000-4000-8000-000000000066',
  alter column organization_id set not null;
alter table public.organization_workflow_transitions
  alter column organization_id set default '00000000-0000-4000-8000-000000000066',
  alter column organization_id set not null;
alter table public.organization_workflow_events
  alter column organization_id set default '00000000-0000-4000-8000-000000000066',
  alter column organization_id set not null;
alter table public.organization_people_access_events
  alter column organization_id set default '00000000-0000-4000-8000-000000000066',
  alter column organization_id set not null;

create unique index if not exists organization_workflows_id_organization_uidx
  on public.organization_workflows(id, organization_id);
create unique index if not exists organization_people_id_organization_uidx
  on public.organization_people(id, organization_id);
create unique index if not exists organization_access_roles_id_organization_uidx
  on public.organization_access_roles(id, organization_id);
create unique index if not exists hr_departments_id_organization_uidx
  on public.hr_departments(id, organization_id);
create unique index if not exists organization_workflow_states_id_workflow_organization_uidx
  on public.organization_workflow_states(id, workflow_id, organization_id);
create unique index if not exists organization_workflow_states_id_organization_uidx
  on public.organization_workflow_states(id, organization_id);
create unique index if not exists organization_workflow_transitions_id_organization_uidx
  on public.organization_workflow_transitions(id, organization_id);
create unique index if not exists organization_workflow_instances_id_organization_uidx
  on public.organization_workflow_instances(id, organization_id);

alter table public.organization_workflow_states
  add constraint organization_workflow_states_organization_scope_fkey
  foreign key (workflow_id, organization_id)
  references public.organization_workflows(id, organization_id) on delete restrict;
alter table public.organization_workflow_transitions
  add constraint organization_workflow_transitions_organization_scope_fkey
  foreign key (workflow_id, organization_id)
  references public.organization_workflows(id, organization_id) on delete restrict,
  add constraint organization_workflow_transitions_from_state_scope_fkey
  foreign key (from_state_id, workflow_id, organization_id)
  references public.organization_workflow_states(id, workflow_id, organization_id) on delete restrict,
  add constraint organization_workflow_transitions_to_state_scope_fkey
  foreign key (to_state_id, workflow_id, organization_id)
  references public.organization_workflow_states(id, workflow_id, organization_id) on delete restrict;
alter table public.organization_workflow_instances
  add constraint organization_workflow_instances_organization_scope_fkey
  foreign key (workflow_id, organization_id)
  references public.organization_workflows(id, organization_id) on delete restrict,
  add constraint organization_workflow_instances_state_scope_fkey
  foreign key (state_id, workflow_id, organization_id)
  references public.organization_workflow_states(id, workflow_id, organization_id) on delete restrict;
alter table public.organization_workflow_events
  add constraint organization_workflow_events_instance_scope_fkey
  foreign key (instance_id, organization_id)
  references public.organization_workflow_instances(id, organization_id) on delete restrict,
  add constraint organization_workflow_events_transition_scope_fkey
  foreign key (transition_id, organization_id)
  references public.organization_workflow_transitions(id, organization_id) on delete restrict,
  add constraint organization_workflow_events_from_state_scope_fkey
  foreign key (from_state_id, organization_id)
  references public.organization_workflow_states(id, organization_id) on delete restrict,
  add constraint organization_workflow_events_to_state_scope_fkey
  foreign key (to_state_id, organization_id)
  references public.organization_workflow_states(id, organization_id) on delete restrict;
alter table public.organization_workflow_approvals
  add constraint organization_workflow_approvals_instance_scope_fkey
  foreign key (instance_id, organization_id)
  references public.organization_workflow_instances(id, organization_id) on delete restrict,
  add constraint organization_workflow_approvals_transition_scope_fkey
  foreign key (transition_id, organization_id)
  references public.organization_workflow_transitions(id, organization_id) on delete restrict;
alter table public.organization_people_access_events
  add constraint organization_people_access_events_relationship_scope_fkey
  foreign key (relationship_id, organization_id)
  references public.organization_people(id, organization_id) on delete restrict,
  add constraint organization_people_access_events_previous_role_scope_fkey
  foreign key (previous_role_id, organization_id)
  references public.organization_access_roles(id, organization_id) on delete restrict,
  add constraint organization_people_access_events_new_role_scope_fkey
  foreign key (new_role_id, organization_id)
  references public.organization_access_roles(id, organization_id) on delete restrict,
  add constraint organization_people_access_events_previous_department_scope_fkey
  foreign key (previous_department_id, organization_id)
  references public.hr_departments(id, organization_id) on delete restrict,
  add constraint organization_people_access_events_new_department_scope_fkey
  foreign key (new_department_id, organization_id)
  references public.hr_departments(id, organization_id) on delete restrict;

create index if not exists organization_workflow_states_organization_idx
  on public.organization_workflow_states(organization_id, workflow_id);
create index if not exists organization_workflow_transitions_organization_idx
  on public.organization_workflow_transitions(organization_id, workflow_id);
create index if not exists organization_workflow_events_organization_idx
  on public.organization_workflow_events(organization_id, instance_id, created_at desc);
create index if not exists organization_people_access_events_organization_idx
  on public.organization_people_access_events(organization_id, relationship_id, created_at desc);
