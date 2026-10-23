alter table public.profiles
  add column if not exists email text;

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('subscriber', 'reporter', 'moderator', 'editor', 'publisher', 'admin', 'super_admin'));

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id
  and p.email is distinct from u.email;

create unique index if not exists profiles_email_lower_idx
  on public.profiles (lower(email))
  where email is not null;

create or replace function public.chowk_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, phone, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    'subscriber'
  )
  on conflict (id) do update
  set email = excluded.email;
  return new;
end;
$$;

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
  if new_role not in ('subscriber', 'reporter', 'moderator', 'editor', 'publisher', 'admin', 'super_admin') then
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
  update public.profiles set role = new_role where id = target_user;
end;
$$;

revoke all on function public.chowk_admin_set_user_role(uuid, text) from public, anon;
grant execute on function public.chowk_admin_set_user_role(uuid, text) to authenticated;
