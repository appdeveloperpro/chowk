create table if not exists public.reporter_organization_profile (
  id boolean primary key default true check (id),
  legal_name text not null check (length(trim(legal_name)) between 2 and 160),
  trade_name text not null check (length(trim(trade_name)) between 2 and 160),
  entity_type text not null check (length(trim(entity_type)) between 2 and 100),
  registered_address text not null check (length(trim(registered_address)) between 5 and 500),
  registration_number text not null default '' check (length(registration_number) <= 100),
  official_email text not null check (official_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  official_phone text not null check (length(trim(official_phone)) between 7 and 40),
  website_url text not null default '' check (website_url = '' or website_url ~* '^https://'),
  is_verified boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    not is_verified
    or (
      legal_name not ilike 'DEMO ONLY%'
      and trade_name not ilike 'DEMO ONLY%'
      and entity_type not ilike 'DEMO ONLY%'
      and registered_address not ilike 'DEMO ONLY%'
      and official_email not like '%@example.invalid'
      and official_phone <> '+910000000000'
    )
  )
);

insert into public.reporter_organization_profile (
  id, legal_name, trade_name, entity_type, registered_address,
  registration_number, official_email, official_phone, website_url, is_verified
)
values (
  true,
  'DEMO ONLY - Replace with verified company legal name',
  'DEMO ONLY - Replace with verified trading name',
  'DEMO ONLY - Select registered entity type',
  'DEMO ONLY - Replace with the complete registered office address',
  '',
  'demo@example.invalid',
  '+910000000000',
  '',
  false
)
on conflict (id) do nothing;

alter table public.reporter_organization_profile enable row level security;
grant select, insert, update on public.reporter_organization_profile to authenticated;
create policy "Admins manage reporter organization profile"
  on public.reporter_organization_profile for all to authenticated
  using ((select public.chowk_has_any_role(array['admin', 'super_admin'])))
  with check ((select public.chowk_has_any_role(array['admin', 'super_admin'])));

drop trigger if exists chowk_reporter_organization_profile_set_updated_at
  on public.reporter_organization_profile;
create trigger chowk_reporter_organization_profile_set_updated_at
  before update on public.reporter_organization_profile
  for each row execute function public.chowk_set_updated_at();

create or replace function public.chowk_admin_publish_reporter_agreement(target_agreement bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
      or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.reporter_organization_profile
    where id and is_verified
  ) then
    raise exception 'Verify the organization legal profile before publishing reporter agreements'
      using errcode = '23514';
  end if;
  perform 1 from public.reporter_agreement_versions where id = target_agreement for update;
  if not found then raise exception 'Agreement version not found' using errcode = 'P0002'; end if;
  update public.reporter_agreement_versions
  set status = 'archived'
  where status = 'published' and id <> target_agreement;
  update public.reporter_agreement_versions
  set status = 'published', published_by = (select auth.uid()), published_at = now()
  where id = target_agreement;
end;
$$;
revoke all on function public.chowk_admin_publish_reporter_agreement(bigint) from public, anon;
grant execute on function public.chowk_admin_publish_reporter_agreement(bigint) to authenticated;

create or replace function public.chowk_admin_publish_reporter_service_agreement(target_agreement bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
      or not (select public.chowk_has_any_role(array['admin', 'super_admin'])) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.reporter_organization_profile
    where id and is_verified
  ) then
    raise exception 'Verify the organization legal profile before publishing reporter agreements'
      using errcode = '23514';
  end if;
  perform 1 from public.reporter_service_agreement_versions
  where id = target_agreement and status in ('draft', 'published') for update;
  if not found then raise exception 'Draft service agreement not found' using errcode = 'P0002'; end if;
  update public.reporter_service_agreement_versions
  set status = 'archived'
  where status = 'published' and id <> target_agreement;
  update public.reporter_service_agreement_versions
  set status = 'published', published_by = (select auth.uid()), published_at = now()
  where id = target_agreement;
end;
$$;
revoke all on function public.chowk_admin_publish_reporter_service_agreement(bigint) from public, anon;
grant execute on function public.chowk_admin_publish_reporter_service_agreement(bigint) to authenticated;
